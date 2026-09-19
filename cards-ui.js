import { todayISO, thisYm, fmtCur, num } from './core.js';
import { DB } from './db.js';
import { closeModal, toast, fmtSheetCur, renderHomeExpense, openModal, el, _spendDayLabel, expRenderStale, round2, _reimbMap, _reimbParts, _mountMonthStrip, fmtIntCur, _mfCell, b, explainRow, refresh, appConfirm, field } from './app.js';

// ---------- Credit Cards (Credit Cards) ----------
// Reproduces the source sheet's wide credit grid: one row per card, one column
// per month, with Total / Last Month Difference / to be PAID / Average summary
// rows underneath. The grid scrolls horizontally inside its own container with a
// sticky first column (same technique as the Heatmap tab) — 27 months will never
// fit a phone screen, and squeezing them would make the figures unreadable.
// Logic lives in credit.js; app.js does the `creditCards`-store CRUD.
const CC_BANKS = ['HDFC', 'ICICI', 'Axis', 'SBI', 'Kotak', 'IndusInd', 'IDFC FIRST', 'AmEx', 'Standard Chartered', 'Yes Bank', 'RBL', 'AU Small Finance'];

// Timeline lower bound — fixed, not derived from data, so every month is
// navigable from launch even before any bill is logged for it.
const CC_TIMELINE_START_YM = '2024-07';

// Which month the timeline/card-list/reimburse-box are currently showing.
// null = default to the latest month with data (or this month, if none).
let _ccSelectedYm = null;
// Set right before a timeline click triggers its re-render, so the render
// that follows knows to animate the scroll into place — a plain page-open
// (or any other re-render, e.g. after saving a card) should land on the
// right position instantly, not visibly slide there.
let _ccTimelineClicked = false;
// Where the month-by-month grid was left. null means "not scrolled yet", which
// is what sends it to the newest month the first time.
let _ccGridScroll = null;

// Settling a bill from the card list. On time or late is a real distinction the
// record already carries - it drives how the month reads afterwards - so it is
// asked rather than assumed, which a plain yes/no confirm could not do.
function openCcPayForm(card, ym, billed, mod, cyc) {
  const label = mod.monthLabel(ym);
  const overdue = !!(cyc && cyc.overdue);
  const mark = async (status) => {
    const months = (card.months || []).map((r) => (String(r.ym || '').slice(0, 7) === ym
      ? Object.assign({}, r, { status, paidOn: todayISO() })
      : r));
    await DB.put('creditCards', Object.assign({}, card, { months, updatedAt: new Date().toISOString() }));
    closeModal();
    toast(label + ' bill paid · ' + fmtSheetCur(billed) + (status === 'late' ? ' · marked late' : ''));
    renderHomeExpense();
  };
  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: 'Pay ' + (card.name || 'card') + ' · ' + label }),
      el('p', { class: 'hint', text: 'Marks the ' + fmtSheetCur(billed) + ' statement as settled. '
        + 'It then comes off In Hand on ' + label + '’s Expense sheet, as money that has actually '
        + 'left the account.'
        + (cyc && cyc.dueOn ? ' Due ' + _spendDayLabel(cyc.dueOn) + (overdue ? ', so this is a late payment.' : '.') : '') }),
      // Ordered by which one is true today rather than always the same way
      // round: past the due date, "on time" is the unlikely answer.
      el('div', { class: 'btn-row cc-pay-row' }, overdue
        // Not `ghost` for the second one: that is Cancel's look on every other
        // sheet, and a "Paid on time" button dressed as Cancel is a misclick
        // waiting to happen on a row about money.
        ? [el('button', { class: 'btn warn', text: 'Paid late', onclick: () => mark('late') }),
           el('button', { class: 'btn primary', text: 'Paid on time', onclick: () => mark('ontime') })]
        : [el('button', { class: 'btn primary', text: 'Paid on time', onclick: () => mark('ontime') }),
           el('button', { class: 'btn warn', text: 'Paid late', onclick: () => mark('late') })]),
      el('button', { class: 'btn ghost cc-pay-cancel', text: 'Cancel', onclick: closeModal }),
    ]),
  ]));
}

function renderCcGrid(host, g, mod) {
  if (g.yms.length) {
    // Chronological, left to right, like the sheet this grew out of and like
    // anybody reads a run of months. That puts the newest at the RIGHT end,
    // which is where the grid opens - the month you are actually paying should be
    // on screen without a swipe, and history is a scroll leftwards.
    const displayYms = g.yms.slice();
    const displayMonthly = g.monthly.slice();

    const wrapCard = el('div', { class: 'chart-card' }, [el('h3', { text: 'Month by month' })]);
    const head = el('tr', {}, [el('th', { class: 'corner', text: 'Month' })]);
    displayYms.forEach((ym) => head.appendChild(el('th', { text: mod.monthLabel(ym) })));
    const tbody = el('tbody');
    g.rows.forEach(({ card, cell }) => {
      const tr = el('tr', {}, [el('th', { class: 'rowhead', text: card.name || 'Card' })]);
      displayYms.forEach((ym) => {
        const v = cell(ym);
        // Struck through once settled, per card per month. The grid is read to
        // find what is still owed, and a figure that has been paid answering
        // that question the same way as one that has not is the whole problem.
        const paid = !!(v && v.status);
        tr.appendChild(el('td', {
          class: (v && v.billed ? '' : 'flat') + (paid ? ' is-paid' : '') + (v && v.status === 'late' ? ' is-late' : ''),
          title: paid ? (v.status === 'late' ? 'Paid late' : 'Paid') + (v.paidOn ? ' · ' + _spendDayLabel(String(v.paidOn).slice(0, 10)) : '') : '',
          text: v && v.billed ? fmtIntCur(v.billed) : '—',
        }));
      });
      tbody.appendChild(tr);
    });
    const sumRow = (label, pick, cls) => {
      const tr = el('tr', { class: 'cc-sum' }, [el('th', { class: 'rowhead', text: label })]);
      displayMonthly.forEach((m) => {
        const out = pick(m);
        tr.appendChild(el('td', { class: out.cls || cls || '', text: out.text }));
      });
      tbody.appendChild(tr);
    };
    sumRow('Total', (m) => ({ text: fmtIntCur(m.billed) }));
    sumRow('Reimbursed', (m) => ({ text: m.reimbursed ? fmtIntCur(m.reimbursed) : '—', cls: m.reimbursed ? 'pos' : 'flat' }));
    sumRow('To be paid', (m) => {
      // Heatmap background: greener the more toBePaid IMPROVED vs the
      // previous month (m.diff < 0), redder the more it worsened — on top
      // of (not instead of) the existing bold treatment once every card
      // for that month is marked paid.
      let heatCls = 'cc-heat-flat';
      if (m.diff != null) heatCls = m.diff < 0 ? 'cc-heat-better' : m.diff > 0 ? 'cc-heat-worse' : 'cc-heat-flat';
      return {
        text: m.toBePaid ? fmtIntCur(m.toBePaid) : '—',
        cls: [heatCls, m.fullyPaid ? 'cc-fully-paid' : (m.toBePaid ? 'warn' : 'flat')].join(' '),
      };
    });
    sumRow('vs last month', (m) => m.diff == null
      ? { text: '—', cls: 'flat' }
      // A credit-card bill going DOWN is the good direction, so the colours are
      // deliberately inverted vs. every other surface in the app.
      : { text: (m.diff > 0 ? '+' : '') + fmtIntCur(m.diff), cls: m.diff > 0 ? 'neg' : m.diff < 0 ? 'pos' : 'flat' });

    const gridScroll = el('div', { class: 'heatmap-scroll cc-scroll' }, [
      el('table', { class: 'heatmap cc-grid' }, [el('thead', {}, [head]), tbody]),
    ]);
    // Parked at the newest month. Remembered after that, because this whole tab
    // re-renders on every timeline tap and on every bill paid, and snapping a
    // grid somebody had scrolled into history back to the far right each time
    // is worse than not scrolling it at all.
    //
    // What is remembered is an offset UNLESS the grid is sitting at the end, in
    // which case it stays null - "keep me on the newest". Storing the offset
    // there would strand the view one column short the month a new one appears.
    const gridEnd = () => Math.max(0, gridScroll.scrollWidth - gridScroll.clientWidth);
    gridScroll.addEventListener('scroll', () => {
      _ccGridScroll = Math.abs(gridScroll.scrollLeft - gridEnd()) < 4 ? null : gridScroll.scrollLeft;
    }, { passive: true });
    const parkGrid = () => { gridScroll.scrollLeft = _ccGridScroll == null ? gridEnd() : Math.min(_ccGridScroll, gridEnd()); };
    wrapCard.appendChild(gridScroll);
    wrapCard.appendChild(explainRow('About this grid', 'Oldest month first, so the newest is on the right — where this opens. Scroll left for history. "vs last month" compares the to-be-paid figure against the previous month that has data.', 'How to read it'));
    host.appendChild(wrapCard);
    // Once, synchronously - reading scrollWidth on an attached element settles
    // layout, so this needs no frame to wait for. Again on the next frame in
    // case a late webfont reflows the columns under it.
    parkGrid();
    requestAnimationFrame(parkGrid);
  }
}

// part 'heat' renders only the Month by month grid (the Heatmap tab); anything else is the Credit Card tab.
export async function renderCreditCards(host, token, part) {
  // Called again on every timeline click (via renderHomeExpense, which
  // clears first) — but also defensively cleared here, the same lesson the
  // Yearly plan tab's duplication bug taught: never trust the caller alone.
  host.innerHTML = '';
  const mod = await import('./credit.js');
  const [cards, reimbRows, houseSpends, personalSpends] = await Promise.all([
    DB.all('creditCards').then((r) => r || []),
    DB.all('ccReimbursements').then((r) => r || []).catch(() => []),
    DB.all('spends').catch(() => []),
    DB.all('personalSpends').catch(() => []),
  ]);
  if (expRenderStale(token)) return;

  // What each card actually has against it: household spends from the Tracker
  // plus personal ones from Personal Finance, over THAT CARD'S billing cycle
  // for the selected month. Derived on every render rather than written onto
  // the card, so it cannot drift from the entries it is a sum of, and cannot
  // double up with the statement figure typed in beside it.
  const loggedOn = (cardRec, ym) => {
    // statementYmFor decides which bill a spend is on, here as everywhere.
    const sum = (rows) => round2((rows || [])
      .filter((r) => r.method === 'Card' && r.cardId === cardRec.id
        && mod.statementYmFor(r.date, cardRec) === ym)
      .reduce((a, r) => a + (Number(r.amount) || 0), 0));
    const house = sum(houseSpends), personal = sum(personalSpends);
    return { win: mod.cycleWindow(ym, cardRec), house, personal, total: round2(house + personal) };
  };

  if (!cards.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '💳' }),
      el('p', { text: 'No credit cards yet.' }),
      el('p', { class: 'hint', text: 'Tap + to add a card — name, bank and credit limit. Then log each month\'s statement amount.' }),
    ]));
    return;
  }

  // Asked and answered in one place (see _reimbParts): the tab renders the
  // figure, it does not decide it.
  const { map: reimbMap, detail: reimbDetail } = _reimbMap(
    _reimbParts(cards, houseSpends, personalSpends, mod), reimbRows);
  const g = mod.computeCredit(cards, reimbMap);
  if (part === 'heat') {
    if (g.yms.length) renderCcGrid(host, g, mod);
    else host.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '\u{1F525}' }), el('p', { text: 'No statements logged yet.' }), el('p', { class: 'hint', text: 'Log a card\'s billed amount on the Credit Card tab and the month by month view fills in here.' })]));
    return;
  }

  const thisYm = todayISO().slice(0, 7);
  const timelineEndYm = g.latestYm && g.latestYm > thisYm ? g.latestYm : thisYm;
  // Latest month first — monthRangeYm builds ascending (oldest→newest, since
  // that's the natural order for a fixed range), reversed here purely for
  // display so the timeline reads latest-to-old left to right.
  const timelineYms = mod.monthRangeYm(CC_TIMELINE_START_YM, timelineEndYm).reverse();
  const selYm = _ccSelectedYm && timelineYms.includes(_ccSelectedYm) ? _ccSelectedYm : (g.latestYm || thisYm);
  const selMonthly = g.monthly.find((m) => m.ym === selYm) || { ym: selYm, billed: 0, reimbursed: 0, toBePaid: 0, fullyPaid: false };
  const fullyPaidByYm = new Map(g.monthly.map((m) => [m.ym, m.fullyPaid]));

  // ---- Month timeline — tap a month to view/edit that specific bill ----
  // Fixed under the app header while the rest of the page scrolls, so the
  // month picker is always reachable without scrolling back up. The header's
  // own height varies (safe-area inset on notched devices), so it's measured
  // rather than hardcoded.
  const appHeader = document.querySelector('.app-header');
  const timelineWrap = el('div', {
    class: 'cc-timeline-scroll cc-timeline-sticky',
    style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px',
  });
  const timelineRow = el('div', { class: 'cc-timeline' }, timelineYms.map((ym) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip'
      + (ym === selYm ? ' active' : '')
      + (ym === thisYm ? ' is-current' : '')
      + (fullyPaidByYm.get(ym) ? ' is-paid' : ''),
    text: mod.monthLabel(ym),
    onclick: () => { if (ym === selYm) return; _ccSelectedYm = ym; _ccTimelineClicked = true; renderHomeExpense(); },
  })));
  timelineWrap.appendChild(timelineRow);
  host.appendChild(timelineWrap);
  _mountMonthStrip('cc', timelineWrap, _ccTimelineClicked);
  _ccTimelineClicked = false;

  // Summary: the SELECTED month's figures (not always "latest"), so the
  // summary and timeline never disagree about which month is on screen.
  host.appendChild(el('section', { class: 'summary' }, [
    el('div', { class: 'row-between summary-top' }, [
      el('div', {}, [
        el('div', { class: 'label', text: 'Billed in ' + mod.monthLabel(selYm) }),
        el('div', { class: 'big', text: fmtCur(selMonthly.billed, 'INR') }),
      ]),
      el('div', { class: 'summary-earned' }, [
        el('div', { class: 'label', text: 'To be paid' }),
        el('div', { class: 'v ' + (selMonthly.toBePaid > 0 ? 'warn' : 'pos'), text: fmtIntCur(selMonthly.toBePaid) }),
      ]),
    ]),
    el('div', { class: 'grid' }, [
      _mfCell('Cards', String(g.cardCount)),
      _mfCell('Avg / month', fmtIntCur(g.averagePerMonth)),
      _mfCell('Total billed', fmtIntCur(g.grandBilled)),
      _mfCell('Total reimbursed', fmtIntCur(g.grandReimbursed), g.grandReimbursed > 0 ? 'pos' : ''),
    ]),
  ]));

  // Per-card cards for the SELECTED month — tap a card to edit it (bank,
  // limit, and its full month-by-month ledger with the status dropdown).
  // .stock-list's shared padding-bottom leaves room for the FAB when the
  // list is the last thing on a page - it isn't here (the reimbursement box
  // and grid follow it), so cc-card-list overrides that gap to nothing.
  const list = el('section', { class: 'stock-list cc-card-list' });
  g.rows.slice().sort((a, b2) => b2.c.averageUse - a.c.averageUse).forEach(({ card, c, cell }) => {
    // This card's bill for the month currently selected on the timeline —
    // computed early since both the catLine badge and the status below key
    // off it.
    const monthCell = cell(selYm);

    const catBits = [card.bank || 'Bank'];
    if (c.limit > 0) catBits.push('limit ' + fmtIntCur(c.limit));
    if (card.cycleStartDay && card.cycleEndDay) catBits.push('cycle ' + card.cycleStartDay + '–' + card.cycleEndDay);
    catBits.push(c.monthCount + (c.monthCount === 1 ? ' month' : ' months'));
    const catLine = el('div', { class: 'cat mf-catline', text: catBits.join(' · ') });
    // THIS MONTH's usage against the limit (not always-latest any more —
    // it tracks whichever month is selected on the timeline above). Sits
    // next to the card name (top row), not in catLine below — it's the
    // figure that changes as the timeline selection changes, so it reads
    // better up with the name than buried among the static bank/limit info.
    const monthUtilPct = c.limit > 0 && monthCell ? (monthCell.billed / c.limit) * 100 : null;
    const monthUtilBadge = monthUtilPct != null
      ? el('span', { class: 'badge mf-beat ' + (monthUtilPct >= 30 ? 'warn' : 'good'), text: monthUtilPct.toFixed(0) + '% used' })
      : document.createTextNode('');
    // Average usage against the limit, across every month logged — a
    // steady long-term figure, so it's always green rather than
    // warn-at-a-threshold like the month-specific badge above.
    const avgUtilPct = c.limit > 0 && c.averageUse > 0 ? (c.averageUse / c.limit) * 100 : null;

    // Where this month stands, in the order the states actually happen:
    //
    //   ONGOING  the cycle is still open, so the figure is not final and there
    //            is nothing to settle yet.
    //   DUE      the cycle has closed and the bill is unpaid. The only state
    //            that wants an action, so it IS the action - a button.
    //   PAID     settled, with the day it was marked.
    //
    // Paying is offered here rather than only inside Details > Months because
    // this is the one thing on this page that has to happen every month, and
    // burying a monthly chore two taps into a form is how it stops happening.
    const cyc = mod.cycleState(selYm, card, todayISO());
    const billed = monthCell ? monthCell.billed : 0;
    let statusEl;
    if (monthCell && monthCell.status) {
      const late = monthCell.status === 'late';
      const on = monthCell.paidOn ? String(monthCell.paidOn).slice(0, 10) : null;
      statusEl = el('span', { class: 'badge ' + (late ? 'warn' : 'good') + ' cc-status-badge',
        text: (late ? '✓ Paid late' : '✓ Paid') + (on ? ' · ' + _spendDayLabel(on) : '') });
    } else if (!cyc.closed) {
      statusEl = el('span', { class: 'badge cc-status-ongoing',
        text: '● Ongoing · ' + (cyc.daysLeft === 0 ? 'closes today'
          : cyc.daysLeft === 1 ? 'closes tomorrow' : cyc.daysLeft + ' days left') });
    } else if (billed > 0) {
      // Payable from the moment the cycle closes - paying early is normal - but
      // the date that matters is the DUE date, so it is on screen next to the
      // button rather than left to be remembered.
      statusEl = el('div', { class: 'cc-due-wrap' }, [
        el('span', { class: 'cc-due-when' + (cyc.overdue ? ' is-overdue' : ''),
          text: cyc.overdue ? 'Overdue · was due ' + _spendDayLabel(cyc.dueOn)
            : cyc.dueInDays === 0 ? 'Due today'
              : 'Due ' + _spendDayLabel(cyc.dueOn) + ' · ' + cyc.dueInDays + 'd' }),
        el('button', {
          class: 'cc-pay-btn' + (cyc.overdue ? ' is-overdue' : ''), type: 'button',
          text: 'Pay ' + fmtIntCur(billed),
          title: 'Mark this bill as paid',
          onclick: (e) => { e.stopPropagation(); openCcPayForm(card, selYm, billed, mod, cyc); },
        }),
      ]);
    } else {
      statusEl = el('span', { class: 'value-emphasis flat', text: 'No bill this month' });
    }

    // What is logged against this card in the selected month's cycle. Shown
    // whenever there is anything, since the useful reading is house + personal
    // against the statement rather than either half alone.
    const lg = loggedOn(card, selYm);
    const loggedRow = lg.total > 0
      ? el('div', { class: 'cc-logged' }, [
          el('span', { class: 'cc-logged-label', text: 'Logged' }),
          el('span', { class: 'cc-logged-split' }, [
            el('i', { class: 'rvw-dot is-house' }),
            el('span', { text: 'house ' + fmtIntCur(lg.house) }),
            el('i', { class: 'rvw-dot is-personal' }),
            el('span', { text: 'own ' + fmtIntCur(lg.personal) }),
          ]),
          el('span', { class: 'cc-logged-total', text: fmtIntCur(lg.total) }),
        ])
      : document.createTextNode('');
    list.appendChild(el('div', { class: 'card', onclick: () => openCreditCardForm(card) }, [
      el('div', { class: 'top' }, [
        el('div', { class: 'card-left' }, [
          el('div', { class: 'cc-name-row' }, [
            el('div', { class: 'name', text: card.name || 'Card' }),
            monthUtilBadge,
          ]),
          catLine,
        ]),
        el('div', { class: 'card-right' }, [
          el('div', { class: 'pct', text: fmtIntCur(monthCell ? monthCell.billed : 0) }),
          el('div', { class: 'meta-line', text: mod.monthLabel(selYm) }),
        ]),
      ]),
      el('div', { class: 'sub mf-sub2' }, [
        el('span', {}, [el('div', {}, [
          'Avg use ', b(fmtIntCur(c.averageUse)),
          avgUtilPct != null ? el('span', { class: 'badge good cc-avg-util-badge', text: avgUtilPct.toFixed(0) + '% used' }) : document.createTextNode(''),
        ])]),
        statusEl,
      ]),
      loggedRow,
    ]));
  });
  host.appendChild(list);

  // ---- Common reimbursement — ONE figure for the selected month, shared
  // across every card (see credit.js header comment for why this isn't
  // per-card any more). Saved on blur so typing doesn't thrash the DB. ----
  const rb = reimbDetail.get(selYm) || { house: 0, others: 0, derived: 0, amount: 0, auto: false, manual: false };
  const reimbInput = el('input', {
    type: 'number', inputmode: 'decimal', step: 'any',
    value: rb.amount ? rb.amount : '',
    placeholder: '₹ reimbursed this month',
    'aria-label': 'Reimbursed this month',
  });
  const setReimb = async (amount, manual) => {
    await DB.put('ccReimbursements', { ym: selYm, amount: round2(amount || 0), manual: !!manual,
      updatedAt: new Date().toISOString() });
    renderHomeExpense();
  };
  reimbInput.addEventListener('blur', () => {
    const typed = round2(num(reimbInput.value) || 0);
    if (typed === rb.amount) return;                 // nothing said, nothing written
    // Typing the counted figure back in is not an override, it is agreement -
    // so the month keeps following the entries instead of freezing on today's
    // total and going stale the next time one is logged.
    setReimb(typed, !(rb.derived > 0 && typed === rb.derived));
  });

  // Where the number came from. An auto month names its two halves, so the
  // figure is never a total the user has to take on trust.
  const rbBadge = rb.auto
    ? el('span', { class: 'msheet-follow', text: 'auto' })
    : (rb.manual
        ? el('button', {
            class: 'msheet-follow is-override', type: 'button',
            title: rb.derived > 0
              ? 'Set by you \u2014 tap to follow the ' + fmtSheetCur(rb.derived) + ' logged again'
              : 'Set by you',
            text: 'set \u21bb',
            onclick: () => setReimb(rb.derived, false),
          })
        : document.createTextNode(''));
  const rbSplit = rb.derived > 0
    ? el('p', { class: 'hint cc-reimb-split' }, [
        el('i', { class: 'rvw-dot is-house' }),
        el('span', { text: 'house ' + fmtIntCur(rb.house) }),
        el('i', { class: 'rvw-dot is-personal' }),
        el('span', { text: 'for others ' + fmtIntCur(rb.others) }),
        el('b', { text: fmtIntCur(rb.derived) + ' logged' }),
      ])
    : document.createTextNode('');
  host.appendChild(el('div', { class: 'chart-card cc-reimb-card' }, [
    el('h3', {}, ['Reimbursed \u2014 ' + mod.monthLabel(selYm), rbBadge]),
    reimbInput,
    rbSplit,
    explainRow('Reimbursed', 'One combined figure for this month, covering every card above. '
      + 'Counted from what is logged: household spends put on a card, plus personal spends marked for '
      + 'others. Type over it to set your own figure.', 'Where this figure comes from'),
  ]));

  host.appendChild(explainRow('About this tab', 'Credit card bills are money going out, so nothing here counts toward Home\'s Total Invested. Log each card\'s statement as "Billed", set the combined monthly reimbursement below the card list, and mark each card Ontime/Late on its own Details > Months tab once paid.', 'What this does and does not count'));

  // Swipe gestures on card list only (not the month-by-month table): left swipe
  // → next month (forward in time), right swipe → previous month. Prevents
  // horizontal scrolling in the table from accidentally triggering month changes.
  let touchStartX = 0;
  let swiping = false;
  const swipeThreshold = 50;
  list.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, false);
  list.addEventListener('touchend', (e) => {
    if (swiping) return; // prevent double-swipe during render
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX - touchEndX;
    if (Math.abs(diff) < swipeThreshold) return; // too small, ignore
    // Swipe left (diff > 0) → next month (forward), swipe right (diff < 0) → previous month (backward)
    const nextIdx = diff > 0 ? timelineYms.indexOf(selYm) + 1 : timelineYms.indexOf(selYm) - 1;
    if (nextIdx < 0 || nextIdx >= timelineYms.length) return; // out of bounds
    swiping = true;
    _ccSelectedYm = timelineYms[nextIdx];
    _ccTimelineClicked = true;
    renderHomeExpense();
    // After render completes, reset flag (this is synchronous, flag resets right away)
    swiping = false;
  }, false);
}

// Per-card month ledger: one row per statement month, holding what was billed
// and how it was settled. Same shape and behaviour as buildPayoutEditor (bonds)
// and buildEfRepayEditor (loans) — a month input rather than a date, because a
// card statement belongs to a month, not a day. Reimbursement is NOT entered
// here any more — it's one combined figure per month set below the card list
// on the main Credit Card page (see credit.js's file header for why).
function buildCcMonthEditor(months, onChange) {
  const rowsWrap = el('div', { class: 'hist-rows mf-txn-rows' });
  const summary = el('div', { class: 'mf-txn-summary' });
  const emptyEl = el('div', { class: 'mf-txn-empty', text: 'No months logged yet.' });
  const refs = [];

  const refreshSummary = () => {
    const rows = refs.filter((r) => !r.removed);
    const has = rows.length > 0;
    rowsWrap.classList.toggle('hidden', !has);
    summary.classList.toggle('hidden', !has);
    emptyEl.classList.toggle('hidden', has);
    if (has) {
      const bTotal = rows.reduce((s, r) => s + (num(r.billed.value) || 0), 0);
      const paidCount = rows.filter((r) => r.status.value).length;
      summary.innerHTML = '';
      summary.appendChild(el('span', { text: rows.length + (rows.length === 1 ? ' month' : ' months') }));
      summary.appendChild(el('span', { text: 'Billed ' + fmtIntCur(bTotal) }));
      summary.appendChild(el('span', { text: paidCount + ' / ' + rows.length + ' settled' }));
    }
    // Deferred for the same reason as buildPayoutEditor: this can fire while the
    // caller's own `refresh` const is still being declared.
    if (typeof onChange === 'function') setTimeout(onChange, 0);
  };

  const addRow = (ym, billed, status, paidOn, opts) => {
    const m = el('input', { class: 'txn-date', type: 'month', value: ym || todayISO().slice(0, 7) });
    const bIn = el('input', { class: 'txn-amt', type: 'number', inputmode: 'decimal', step: 'any', value: billed != null ? billed : '', placeholder: 'Billed ₹' });
    const statusSel = el('select', { class: 'cc-status-select' }, [
      el('option', { value: '', text: 'Unpaid' }),
      el('option', { value: 'ontime', text: 'Ontime' }),
      el('option', { value: 'late', text: 'Late Payment' }),
    ]);
    statusSel.value = status || '';
    const del = el('button', { class: 'icon-btn', type: 'button', text: '×' });
    const ref = { m, billed: bIn, status: statusSel, paidOn: paidOn || null, removed: false };
    bIn.addEventListener('blur', refreshSummary);
    m.addEventListener('change', refreshSummary);
    // Stamp paidOn the moment status moves away from Unpaid (kept if it's
    // changed between Ontime/Late without going back through Unpaid first);
    // clear it if set back to Unpaid.
    statusSel.addEventListener('change', () => {
      ref.paidOn = statusSel.value ? (ref.paidOn || new Date().toISOString()) : null;
      refreshSummary();
    });
    const row = el('div', { class: 'mf-txn-row' }, [el('div', { class: 'txn-line' }, [m, bIn, statusSel, del])]);
    del.addEventListener('click', () => { row.remove(); ref.removed = true; refreshSummary(); });
    refs.push(ref);
    // Rows load newest-first (see the initial sort below), so a freshly added
    // month - almost always the newest one there is - goes to the top with
    // them instead of the bottom, where it would read as the oldest.
    if (opts && opts.toTop) rowsWrap.prepend(row); else rowsWrap.appendChild(row);
    refreshSummary();
  };

  // Newest first — the month you're about to edit is almost always the latest.
  (months || []).slice().sort((a, b2) => (b2.ym || '').localeCompare(a.ym || '')).forEach((r) => addRow(r.ym, r.billed, r.status, r.paidOn));
  refreshSummary();

  // "+ Add month" pre-fills the month AFTER the newest one already logged, so
  // filling a card in month by month needs no date typing at all. A fresh row
  // always starts Unpaid.
  const nextYm = () => {
    const latest = refs.reduce((max, r) => (!r.removed && r.m.value && r.m.value > (max || '')) ? r.m.value : max, null);
    if (!latest) return todayISO().slice(0, 7);
    const mm = /^(\d{4})-(\d{2})/.exec(latest);
    if (!mm) return todayISO().slice(0, 7);
    const d = new Date(Date.UTC(+mm[1], +mm[2], 1));   // +mm[2] is already next month (0-based)
    return d.toISOString().slice(0, 7);
  };
  const addBtn = el('button', { class: 'btn ghost small', type: 'button', text: '+ Add month', onclick: () => addRow(nextYm(), null, null, null, { toTop: true }) });

  const node = el('div', {}, [emptyEl, rowsWrap, summary, el('div', { class: 'btn-row' }, [addBtn])]);
  const collect = () => refs
    .filter((r) => !r.removed && r.m.value)
    .map((r) => ({ ym: String(r.m.value).slice(0, 7), billed: num(r.billed.value) || 0, status: r.status.value || null, paidOn: r.paidOn }))
    // Drop fully-empty rows: an added-then-ignored row shouldn't create a month.
    .filter((r) => r.billed > 0 || r.status);
  return { node, collect };
}

export async function openCreditCardForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const mod = await import('./credit.js');
  const r = Object.assign({}, existing || {});

  const bankList = el('datalist', { id: 'ccbanklist' }, CC_BANKS.map((x) => el('option', { value: x })));
  const name = el('input', { type: 'text', value: r.name || '', placeholder: 'e.g. Swiggy HDFC CC' });
  const bank = el('input', { type: 'text', value: r.bank || '', list: 'ccbanklist', placeholder: 'Issuing bank' });
  const creditLimit = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: r.creditLimit != null && r.creditLimit !== '' ? r.creditLimit : '', placeholder: '₹ sanctioned limit (optional)' });
  // Billing cycle (day-of-month range, e.g. 5 -> 4) instead of a free-text
  // notes field — this is what the card list's "cycle 5–4" hint reflects.
  const cycleStartDay = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '1', max: '31', value: r.cycleStartDay != null && r.cycleStartDay !== '' ? r.cycleStartDay : '', placeholder: 'e.g. 5' });
  const cycleEndDay = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '1', max: '31', value: r.cycleEndDay != null && r.cycleEndDay !== '' ? r.cycleEndDay : '', placeholder: 'e.g. 4' });

  const monthEditor = buildCcMonthEditor(r.months, () => refresh());

  const buildRec = () => ({
    name: name.value.trim(),
    bank: bank.value.trim(),
    creditLimit: creditLimit.value !== '' ? (num(creditLimit.value) || 0) : null,
    cycleStartDay: cycleStartDay.value !== '' ? (num(cycleStartDay.value) || null) : null,
    cycleEndDay: cycleEndDay.value !== '' ? (num(cycleEndDay.value) || null) : null,
    months: mod.normaliseMonths(monthEditor.collect()),
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const readout = el('div', { class: 'mf-bench-readout' });
  const refresh = () => {
    readout.innerHTML = '';
    const c = mod.computeCard(buildRec());
    readout.appendChild(el('div', { class: 'mf-bench-now' }, [
      el('span', {}, ['Avg use ', b(fmtIntCur(c.averageUse))]),
      el('span', {}, ['Latest ', b(c.latestYm ? fmtIntCur(c.latestBilled) : '—')]),
      el('span', {}, ['Latest status ', b(c.latestStatus === 'ontime' ? 'Ontime' : c.latestStatus === 'late' ? 'Late' : c.latestYm ? 'Unpaid' : '—')]),
    ]));
    if (c.utilisationPct != null) {
      readout.appendChild(el('p', { class: 'hint' + (c.utilisationPct >= 30 ? ' warn' : ''), style: 'margin-top:6px', text:
        `Latest statement is ${c.utilisationPct.toFixed(1)}% of the ${fmtIntCur(c.limit)} limit` +
        (c.utilisationPct >= 30 ? ' — above 30% starts to weigh on your credit score.' : '.') }));
    }
  };
  [name, bank, creditLimit].forEach((inp) => inp.addEventListener('input', refresh));
  refresh();

  const del = async () => {
    if (!(await appConfirm('Delete this card and all its logged months? This cannot be undone.'))) return;
    await DB.del('creditCards', r.id); closeModal(); toast('Card deleted'); renderHomeExpense();
  };
  const save = async () => {
    if (!name.value.trim()) { toast('Enter the card name'); return; }
    const rec = buildRec();
    if (isEdit) rec.id = r.id;
    await DB.put('creditCards', rec); closeModal(); toast(isEdit ? 'Card updated' : 'Card added'); renderHomeExpense();
  };

  // ---- Tabs: Details (the card itself) | Months (its statement ledger) ----
  const detailsContent = el('div', {}, [
    field('Card name', name),
    el('div', { class: 'field-row' }, [field('Bank', bank), field('Credit limit (₹)', creditLimit)]),
    el('div', { class: 'field-row' }, [field('Cycle start day', cycleStartDay), field('Cycle end day', cycleEndDay)]),
    el('p', { class: 'hint', style: 'margin:-6px 0 0', text: 'Day of month the billing cycle runs, e.g. 8 to 7. A statement is named for the month it CLOSES in — the month you pay it — so September’s bill runs 8 Aug to 7 Sep. Personal Finance → Card check reads this to work out which bill each spend lands on.' }),
    readout,
  ]);
  const monthsContent = el('div', { class: 'hidden' }, [
    el('p', { class: 'hint', text: 'One row per statement month. "Billed" is the statement total. Set the status once you\'ve actually paid it — Ontime or Late Payment — which is what marks it settled everywhere else in the app. The combined monthly reimbursement across all cards is entered on the main Credit Card page, not here.' }),
    monthEditor.node,
  ]);
  const detailsTabBtn = el('button', { class: 'active', type: 'button', text: 'Details' });
  const monthsTabBtn = el('button', { type: 'button', text: 'Months' });
  const tabs = [{ btn: detailsTabBtn, content: detailsContent }, { btn: monthsTabBtn, content: monthsContent }];
  const showTab = (which) => tabs.forEach((t) => {
    const on = t === which;
    t.btn.classList.toggle('active', on);
    t.content.classList.toggle('hidden', !on);
  });
  detailsTabBtn.addEventListener('click', () => showTab(tabs[0]));
  monthsTabBtn.addEventListener('click', () => showTab(tabs[1]));

  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: isEdit ? (r.name || 'Edit card') : 'Add credit card' }),
      el('div', { class: 'seg' }, [detailsTabBtn, monthsTabBtn]),
      bankList,
      detailsContent,
      monthsContent,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}
