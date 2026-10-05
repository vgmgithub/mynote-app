import { DB } from './db.js';
import { thisYm } from './core.js';
import { ui } from './state.js';
import { el, round2, fmtSheetCur, b, pfRenderStale, _mountMonthStrip, _attachMonthSwipe, _spendDayLabel, perDayLabel, _pfGroupClass, _reviewAnalysis, _pfGroupOf, _rvwScopeLine, rvwBudgetBadge, rvwBudgetRow, rvwKeepList, REVIEW_MIN_HISTORY, _reviewCycle, _reviewForecast, _reviewSavings, _reviewSmallTickets, _smallTicketUsual, rvwSection, _reviewCurve, _rvwCurveChart, _ordinalSuffix, explainRow, _rvwMonthBars, _catMonthHistory, _rvwCreepingSection, _reviewCreeping, _rvwMethodsSection, _reviewMethods, _rvwFitSection, _reviewKittyFit, modOn, _modsCache } from './app.js';
import { openModal, closeModal } from './app.js';
import { openPfSpendForm, tagsOf } from './personal-ui.js';
import { openSpendForm } from './spend-form.js';
import { renderPersonal, pfSpendsOnly, pfOwnMap, pfLoad, pfMonths, pfTotals, fmtIntCur } from './personal-ui.js';

// ---------- Review tab ----------
// Reuses the household Review's engine - the forecast, the shape of a month,
// the median comparison - because none of it knows or cares whose money it is.
// The only thing passed differently is the group resolver, so a personal
// category is coloured and grouped by the personal list.
export async function renderPfReview(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const { byYm, byYmCal, allocs, upiLimit } = await pfLoad();
  if (pfRenderStale(token)) return;

  // The whole tab is about own spending: what is unusual for you, where your
  // month lands, where you could keep money. A spend that is coming back is
  // none of those, so it is out of every figure here.
  // Spending only: refunds are left out of every Analysis figure, the same as the Household tab.
  const ownByYm = pfSpendsOnly(pfOwnMap(byYm));
  const ownByYmCal = pfSpendsOnly(pfOwnMap(byYmCal));

  // THIS MONTH, always, and no strip - the same reasoning as the household
  // Review: this tab is for a month that can still be changed. History is what
  // the comparisons are made against, not something to page through.
  const ym = thisYm;
  const t = pfTotals(ym, byYm, allocs, upiLimit);

  const a = _reviewAnalysis(ym, ownByYm, thisYm, t.limit, now, _pfGroupOf);

  _rvwScopeLine(host, mod, ym, a, ownByYm);

  if (!a.spent) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\ud83d\udd0d' }),
      el('p', { text: 'Nothing logged this month yet.' }),
      el('p', { class: 'hint', text: 'This tab reads your own Spends and only ever looks at the month you are in — '
        + 'log some and it will forecast where the month lands and tell you which of them are unusual for you.' }),
    ]));
    return;
  }

  host.appendChild(el('div', { class: 'rvw-head' }, [
    el('div', { class: 'rvw-head-fig' + (a.overKitty > 0 ? ' is-over' : '') },
      [fmtSheetCur(a.spent) + (t.limit > 0 ? ' of ' + fmtSheetCur(t.limit) : '')]),
    // Over or left as a small badge, the days-left line beside it; the same as the Household tab.
    (t.limit > 0 || a.isCurrent) ? rvwBudgetRow(t.limit > 0 ? rvwBudgetBadge(a.overKitty, 'personal') : null, a.isCurrent ? perDayLabel(a.daysLeft + 1) : null) : null,
    // Spent for others: its own small line, the amount in bold.
    t.othersCount ? el('div', { class: 'rvw-head-others' }, [el('b', { text: fmtSheetCur(t.othersTotal) }), document.createTextNode(' for others, not counted')]) : null,
  ].filter(Boolean)));

  if (a.historyMonths < REVIEW_MIN_HISTORY) {
    host.appendChild(el('div', { class: 'rvw-thin' }, [
      el('div', { class: 'rvw-thin-head', text: 'Not enough history yet' }),
      el('div', { class: 'rvw-thin-sub', text: 'There ' + (a.historyMonths === 1 ? 'is 1 earlier month' : 'are ' + a.historyMonths + ' earlier months')
        + ' on record. Comparing a category against its own normal needs at least ' + REVIEW_MIN_HISTORY
        + ', so this holds off rather than calling something unusual on one data point.' }),
    ]));
    return;
  }

  // Totals and per-category comparisons run on the COUNTED months above, so
  // they agree with the Spends and Limits tabs.
  //
  // The forecast and the spending cycle run on calendar days instead, and say
  // so on screen. A day-of-month curve is only defined on a calendar month:
  // inside one counted month a 21-20 card is 15 days into its own window while
  // the calendar is on the 4th, and there is no single "today" across two
  // cards on different cycles. Reading those two sections on calendar days
  // keeps every figure in them computable and honest.
  const cycle = _reviewCycle(ym, ownByYmCal, now, a.isCurrent);
  const forecast = a.isCurrent ? _reviewForecast(ym, ownByYmCal, now, 0, t.limit) : null;
  const savings = _reviewSavings(a, cycle, _reviewSmallTickets(ym, ownByYm), _smallTicketUsual(ym, ownByYm));

  if (forecast) {
    const f = forecast;
    const grade = el('span', { class: 'rvw-grade is-' + f.grade,
      text: f.errPct != null ? f.grade + ' · \u00b1' + f.errPct + '%' : f.grade });
    rvwSection(host, 'pf-forecast', '\ud83d\udd2e', 'Where this month lands', grade, (body) => {
      const curve = _reviewCurve(ym, ownByYmCal, f.day);
      body.appendChild(el('div', { class: 'rvw-fc' }, [
        el('div', { class: 'rvw-fc-top' }, [
          el('div', {}, [
            el('div', { class: 'rvw-fc-big' + (f.overKitty > 0 ? ' is-over' : ''), text: fmtSheetCur(f.forecast) }),
            el('div', { class: 'rvw-fc-lbl', text: 'forecast for ' + mod.monthLabel(ym) }),
          ]),
          el('div', { class: 'rvw-fc-range' }, [
            el('div', { class: 'rvw-fc-range-lbl', text: 'likely between' }),
            el('div', { class: 'rvw-fc-range-val', text: fmtSheetCur(f.lo) + ' – ' + fmtSheetCur(f.hi) }),
          ]),
        ]),
        curve ? el('div', { class: 'rvw-chart' }, [_rvwCurveChart(curve, { kitty: t.limit, forecast: f.forecast, limitLabel: 'allowance' })]) : document.createTextNode(''),
        el('div', { class: 'rvw-fc-split' }, [
          el('span', {}, [el('i', { class: 'rvw-dot is-spent' }), fmtSheetCur(f.spent) + ' spent']),
          el('span', {}, [el('i', { class: 'rvw-dot is-proj' }), fmtSheetCur(f.rest) + ' to come']),
          el('span', {}, [el('i', { class: 'rvw-dot is-usual' }), 'a usual month']),
        ]),
      ]));
      const lines = [];
      if (f.restPerDay != null) lines.push(['-', 'The rest of your month usually costs ' + fmtIntCur(f.restPerDay) + ' a day · the ' + f.daysLeft + (f.daysLeft === 1 ? ' day' : ' days') + ' after today']);
      if (f.fitPerDay != null) {
        lines.push(f.fitPerDay > 0
          ? ['OK', fmtIntCur(f.fitPerDay) + ' a day for the ' + perDayLabel(f.fitDays)
              + ', to stay inside the ' + fmtSheetCur(t.limit) + ' allowance']
          : ['NO', 'The allowance is already spent · anything from here is over it']);
      }
      if (f.overKitty != null && f.overKitty > 0) lines.push(['NO', 'On this estimate the month ends ' + fmtSheetCur(f.overKitty) + ' over']);
      else if (f.overKitty != null) lines.push(['OK', 'On this estimate the month ends ' + fmtSheetCur(-f.overKitty) + ' inside the allowance']);
      if (f.usualByNow > 0) {
        lines.push([f.vsUsualByNow > 0 ? 'UP' : 'DOWN', 'By the ' + f.day + _ordinalSuffix(f.day)
          + ' a usual month is at ' + fmtIntCur(f.usualByNow) + ' · you are ' + fmtIntCur(Math.abs(f.vsUsualByNow))
          + (f.vsUsualByNow > 0 ? ' above that' : ' below that')]);
      }
      body.appendChild(el('div', { class: 'rvw-lines' }, lines.map(([kind, text]) => el('div', { class: 'rvw-line is-' + kind.toLowerCase() }, [
        el('span', { class: 'rvw-line-mark', text: kind === 'OK' ? '✓' : kind === 'NO' ? '!' : kind === 'UP' ? '\u2191' : kind === 'DOWN' ? '\u2193' : '\u2022' }),
        el('span', { text }),
      ]))));
      body.appendChild(explainRow('How the forecast works', (f.errPct != null
        ? 'Only the remainder is estimated, priced from what the same days cost in your last ' + f.months
          + ' months. Tested against those months at the same point, it came out a median ' + f.errPct + '% out.'
        : 'Only the remainder is estimated, priced from what the same days cost in your last ' + f.months
          + ' months. Too few months to have tested it yet.')
        + ' Counted on CALENDAR days, unlike the totals above — a day-of-month curve needs one month with one '
        + 'set of days in it, and two cards on different cycles do not share one.', 'About this estimate'));
    });
  }

  if (savings.rows.length) {
    rvwSection(host, 'pf-savings', '\ud83d\udca1', 'Where you could keep money',
      savings.rows.length + (savings.rows.length === 1 ? ' place' : ' places'), (body) => {
        body.appendChild(rvwKeepList(savings.rows, { scope: 'personal', rowsFor: () => ownByYm.get(ym) || [], groupClass: (g) => _pfGroupClass(g) }));
      });
  }

  rvwSection(host, 'pf-look', '\u26a0\ufe0f', 'Worth a look',
    a.actionable.length ? fmtSheetCur(a.recoverable) : 'nothing unusual', (body) => {
      if (!a.actionable.length) {
        body.appendChild(el('div', { class: 'rvw-clear' }, [
          el('span', { text: '\u2705' }),
          el('div', {}, [
            el('div', { class: 'rvw-clear-head', text: 'Nothing unusual this month' }),
            el('div', { class: 'rvw-clear-sub', text: 'Every category is at or below its own normal.' }),
          ]),
        ]));
        return;
      }
      const wrap = el('div', { class: 'rvw-list' });
      a.actionable.forEach((r) => {
        const detail = el('div', { class: 'rvw-item-detail hidden' });
        let built = false;
        const bits = [r.count + '× this month'];
        if (r.usualCount) bits.push('usually ' + r.usualCount + '×');
        if (r.driver) bits.push(r.driver);
        const item = el('div', { class: 'rvw-item is-tappable ' + _pfGroupClass(r.group) }, [
          el('div', { class: 'rvw-item-top' }, [
            el('span', { class: 'rvw-item-name' }, [el('span', { class: 'rvw-item-dot' }), el('span', { text: r.name })]),
            el('span', { class: 'rvw-item-amt', text: fmtSheetCur(r.now) }),
          ]),
          el('div', { class: 'rvw-item-mid', text: 'Usually ' + fmtSheetCur(r.usual) + ' a month · ' + bits.join(' · ') }),
          el('div', { class: 'rvw-item-save' }, [
            el('span', { class: 'rvw-save-amt', text: fmtSheetCur(r.over) }),
            el('span', { class: 'rvw-save-txt', text: 'above a normal month' }),
          ]),
          detail,
        ]);
        item.addEventListener('click', () => {
          if (!built) { detail.appendChild(_rvwMonthBars(_catMonthHistory(r.name, ym, ownByYm, 6), r.usual)); built = true; }
          const closed = detail.classList.toggle('hidden');
          item.classList.toggle('is-open', !closed);
        });
        wrap.appendChild(item);
      });
      body.appendChild(wrap);
      body.appendChild(el('div', { class: 'rvw-total' }, [
        el('span', { class: 'rvw-total-label', text: 'Recoverable this month' }),
        el('span', { class: 'rvw-total-val', text: fmtSheetCur(a.recoverable) }),
      ]));
    });

  if (cycle) {
    rvwSection(host, 'pf-cycle', '\ud83d\udd01', 'Your spending cycle',
      cycle.halfBy ? 'half gone by the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy) : null, (body) => {
        if (cycle.perDow && cycle.perDow.some((d) => d.perDay > 0)) {
          const peak = cycle.perDow.reduce((m, d) => Math.max(m, d.perDay), 1);
          body.appendChild(el('div', { class: 'rvw-dow' }, cycle.perDow.map((d) => el('div', {
            class: 'rvw-dow-cell' + (d.i === 0 || d.i === 6 ? ' is-weekend' : ''),
          }, [
            el('span', { class: 'rvw-dow-amt', text: d.perDay > 0 ? fmtIntCur(d.perDay) : '\u2014' }),
            el('span', { class: 'rvw-dow-track' }, [
              el('span', { class: 'rvw-dow-fill', style: 'height:' + Math.max(2, (d.perDay / peak) * 100).toFixed(1) + '%' }),
            ]),
            el('span', { class: 'rvw-dow-lbl', text: d.name.slice(0, 3) }),
          ]))));
        }
        const rows = [];
        if (cycle.halfBy) rows.push(['Half a month is gone by', 'the ' + cycle.halfBy + _ordinalSuffix(cycle.halfBy)]);
        if (cycle.weekendPerDay > 0) rows.push(['Weekend vs weekday, per day', fmtIntCur(cycle.weekendPerDay) + ' vs ' + fmtIntCur(cycle.weekdayPerDay)]);
        if (cycle.weekendShare != null) rows.push(['Lands on a Saturday or Sunday', cycle.weekendShare + '% of a month']);
        rows.push(['Days with nothing spent', a.isCurrent
          ? cycle.noSpendSoFar + ' of the first ' + cycle.daysSoFar + ' · usually ' + cycle.noSpendTypical + ' in a month'
          : 'usually ' + cycle.noSpendTypical + ' in a month']);
        body.appendChild(el('div', { class: 'rvw-flat' }, rows.map(([k, v]) =>
          el('div', { class: 'rvw-flat-row' }, [el('span', { text: k }), el('span', { class: 'rvw-flat-meta', text: v })]))));
        body.appendChild(explainRow('Your spending cycle', 'Counted on calendar days, for the same reason '
          + 'as the forecast: which day of the month you spend on is a question about the calendar, not '
          + 'about a card\u2019s billing cycle.', 'How this is measured'));
      });
  }

  // The same three the household tab draws, on personal money: what is
  // drifting upward, how it was paid, and whether the allowance is the right
  // size to begin with. Together with the forecast above, that is the whole
  // question this tab exists to answer - am I going to land inside my limit,
  // and if not, what is doing it.
  const prevD = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYm = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
  _rvwCreepingSection(host, _reviewCreeping(ym, ownByYm, _pfGroupOf), _pfGroupClass);
  _rvwMethodsSection(host, _reviewMethods(ym, ownByYm, prevYm),
    ' Card spends are counted on the statement they land on, so a late-month swipe '
    + 'is next month\u2019s allowance rather than this one\u2019s.');
  _rvwFitSection(host, _reviewKittyFit(ym, ownByYm, (k) => pfTotals(k, byYm, allocs, upiLimit).limit, thisYm), {
    word: 'allowance',
    each: () => ' — the card half of that is set on Expense’s Yearly plan tab, the UPI half on Limits',
  });

  host.appendChild(explainRow('How this tab reads your months', 'Each category is compared with its own median month from your own entries — not a target, and not an average, which one unusual month would skew. Month totals count UPI over the calendar month and card spends over the bill they land on, matching the Spends and Limits tabs.', 'About these figures'));
}

// ---------- Card check tab ----------
// The reason this section exists: a card statement contains household spending
// AND personal spending, so neither tracker on its own can say whether the bill
// adds up. This puts both against the statement and names the gap.
//
// Nothing here writes to a card. The billed figure IS the statement, and a
// logged spend is already inside it by the time the statement arrives - adding
// it again would charge the same swipe twice. So the two are compared, not
// summed into each other.
// o.rerender / o.stale let another screen (Credit Cards) host it; Personal passes nothing.
export async function renderPfCardCheck(host, token, o) {
  const rerender = (o && o.rerender) || renderPersonal, stale = (o && o.stale) || pfRenderStale;
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const [{ rows: pRows, byYm, cards }, houseRows] = await Promise.all([pfLoad(), DB.all('spends').catch(() => [])]);
  if (stale(token)) return;

  // One month PAST the current one, unlike the other tabs. A cycle that closes
  // on the 7th means a swipe today is on next month's bill, and the statement
  // being accumulated right now has to be reachable or the newest spends look
  // as though they went nowhere.
  const nd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextYm = nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0');
  // Deduped, because pfMonths ALREADY reaches past this month whenever a spend
  // lands on a statement that closes next month - which is exactly the case
  // this tab adds nextYm for. Appending it blindly then listed it twice, and a
  // repeated month also breaks the strip's swipe, which steps by indexOf.
  const months = [...new Set(pfMonths(byYm, thisYm, mod).concat([nextYm]))].sort();
  if (!ui._pfYm || !months.includes(ui._pfYm)) ui._pfYm = thisYm;
  const ym = ui._pfYm;

  // Same month strip as the other tabs. It matters more here than anywhere:
  // each card's statement window is derived from the month picked, so without
  // it there is no way to look at anything but the latest bill.
  const appHeader = document.querySelector('.app-header');
  const timelineWrap = el('div', {
    class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline',
    style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px',
  });
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((a, r) => a + (Number(r.amount) || 0), 0));
  timelineWrap.appendChild(el('div', { class: 'cc-timeline' }, months.slice().reverse().map((k) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip' + (k === ym ? ' active' : '') + (k === thisYm ? ' is-current' : '')
      + (k > thisYm ? ' is-ahead' : '') + (totalOf(k) > 0 ? ' has-data' : ''),
    text: mod.monthLabel(k),
    onclick: () => { if (k === ym) return; ui._pfYm = k; ui._pfTimelineClicked = true; rerender(); },
  }))));
  host.appendChild(timelineWrap);
  _mountMonthStrip('pfcards', timelineWrap, ui._pfTimelineClicked);
  ui._pfTimelineClicked = false;
  _attachMonthSwipe(host, months, ym, (k) => { ui._pfYm = k; ui._pfTimelineClicked = true; rerender(); });

  host.appendChild(el('h3', { class: 'div-group-head', text: '\ud83e\uddfe ' + mod.monthLabel(ym) + ' against your statements' }));

  if (!cards.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\ud83d\udcb3' }),
      el('p', { text: 'No credit cards yet.' }),
      el('p', { class: 'hint', text: 'Add one on the Credit Cards \u2192 Credit Card tab and its statement can be checked against what you have logged.' }),
    ]));
    return;
  }

  // Attributed by each card's OWN billing cycle, not by calendar month. A card
  // on 5 – 4 puts a swipe on the 2nd onto last month's bill, so matching
  // logged spends to a statement by calendar month compares two different sets
  // of days and can never agree however carefully the spends were entered.
  // Membership is decided by statementYmFor and nothing else. cycleWindow is
  // for SHOWING the period; using it to filter as well meant two functions
  // could disagree, and on a cycle whose days clamp in a short month (a card
  // entered as 31 to 30) a single date could fall inside two windows and be
  // counted on both bills.
  const sumIn = (rows, cardRec, ym2) => round2((rows || [])
    .filter((r) => r.method === 'Card' && r.cardId === cardRec.id
      && mod.statementYmFor(r.date, cardRec) === ym2)
    .reduce((a, r) => a + (Number(r.amount) || 0), 0));

  let anyBilled = false, anyCycle = false;
  cards.forEach((c) => {
    const m = (c.months || []).find((x) => String(x.ym) === ym) || null;
    const billed = m ? round2(Number(m.billed) || 0) : 0;
    if (billed > 0) anyBilled = true;
    const win = mod.cycleWindow(ym, c);
    if (win && win.isCycle) anyCycle = true;
    const house = sumIn(houseRows, c, ym), personal = sumIn(pRows, c, ym);
    const logged = round2(house + personal);
    const gap = round2(billed - logged);
    const pct = billed > 0 ? Math.min(100, (logged / billed) * 100) : 0;
    host.appendChild(el('div', { class: 'pf-card-check is-tappable', role: 'button', tabindex: '0', title: 'See this bill’s entries',
      onclick: () => openCardEntries(c, ym, mod, houseRows, pRows, rerender) }, [
      el('div', { class: 'pf-cc-top' }, [
        el('span', { class: 'pf-cc-name', text: c.name || 'Card' }),
        el('span', { class: 'pf-cc-billed', text: billed > 0 ? fmtSheetCur(billed) + ' billed' : 'no statement yet' }),
      ]),
      // The window is stated, not implied: it is the whole reason these
      // figures differ from the ones on the Spends tab.
      el('div', { class: 'pf-cc-win' + (win && win.isCycle ? '' : ' is-nocycle'), text: win
        ? (win.isCycle
          ? _spendDayLabel(win.from) + ' – ' + _spendDayLabel(win.to) + ' · cycle ' + win.startDay + '–' + win.endDay
          : _spendDayLabel(win.from) + ' – ' + _spendDayLabel(win.to) + ' · no cycle set on this card')
        : '' }),
      el('div', { class: 'pf-cc-track' }, [
        el('span', { class: 'pf-cc-fill is-house', style: 'width:' + (billed > 0 ? Math.min(100, (house / billed) * 100) : 0).toFixed(1) + '%' }),
        el('span', { class: 'pf-cc-fill is-personal', style: 'width:' + (billed > 0 ? Math.min(100, (personal / billed) * 100) : 0).toFixed(1) + '%' }),
      ]),
      el('div', { class: 'pf-cc-legend' }, [
        el('span', {}, [el('i', { class: 'rvw-dot is-house' }), 'house ' + fmtSheetCur(house)]),
        el('span', {}, [el('i', { class: 'rvw-dot is-personal' }), 'personal ' + fmtSheetCur(personal)]),
      ]),
      billed > 0
        ? el('div', { class: 'pf-cc-gap' + (gap > 0.5 ? ' is-gap' : gap < -0.5 ? ' is-overlogged' : ' is-ok') },
            [gap > 0.5
              ? fmtSheetCur(gap) + ' of this bill is not logged anywhere · ' + Math.round(pct) + '% accounted for'
              : gap < -0.5
                ? fmtSheetCur(-gap) + ' more logged than billed · check for a duplicate, or a spend dated into the wrong month'
                : 'Every rupee of this bill is accounted for'])
        : el('div', { class: 'pf-cc-gap' }, [fmtSheetCur(logged) + ' logged so far this month']),
    ]));
  });

  host.appendChild(explainRow('About this check', anyBilled
    ? 'Each card is read over its OWN billing cycle, shown under its name, and a statement is named for the month it CLOSES in — the month you pay it. So a swipe early in the month is usually on that month\u2019s bill, while one later in it is already on next month\u2019s. That is also why these card figures differ from the Spends tab, which measures a calendar month because the allowance is monthly. Logged is what the two trackers hold for that card in the window: household spends from the Tracker, personal ones from here. Nothing is written back to the card — the statement already contains every swipe, so adding a logged spend to it would count the same one twice. The gap is what was swiped and never written down.'
    : 'Enter the month\u2019s billed figure on a card (Credit Cards \u2192 tap a card \u2192 Months) and this will tell you how much of that bill your two trackers actually explain, read over the card\u2019s own billing cycle.', 'How a card is matched to its bill'));
  if (!anyCycle) {
    host.appendChild(el('p', { class: 'hint warn rvw-note', text: 'None of these cards has a billing cycle set, so each is being read as a calendar month. Add the cycle days on the card (Credit Cards \u2192 tap a card) and the comparison lines up with what the bank actually bills.' }));
  }
}

// What was spent on one card for one bill: household and personal together, each marked, each one tap from its
// own edit form. The saved form calls onSaved, which repaints Card Check and reopens this list with the new figures.
function openCardEntries(card, ym, mod, houseRows, pRows, rerender) {
  const inBill = (r) => r.method === 'Card' && r.cardId === card.id && mod.statementYmFor(r.date, card) === ym;
  const entries = []
    .concat((houseRows || []).filter(inBill).map((r) => ({ r, kind: 'house' })))
    .concat((pRows || []).filter(inBill).map((r) => ({ r, kind: 'personal' })))
    .sort((a, b) => String(b.r.date).localeCompare(String(a.r.date)) || (Number(b.r.id) || 0) - (Number(a.r.id) || 0));
  const total = round2(entries.reduce((s, x) => s + (Number(x.r.amount) || 0), 0));
  const win = mod.cycleWindow(ym, card);
  const reopenAfter = async () => {
    await rerender();
    const [h, p] = await Promise.all([DB.all('spends').catch(() => []), DB.all('personalSpends').catch(() => [])]);
    openCardEntries(card, ym, mod, h, p, rerender);
  };
  const edit = (x) => {
    closeModal();
    const opts = { onSaved: reopenAfter };
    if (x.kind === 'house') openSpendForm(0, x.r, null, opts); else openPfSpendForm(x.r, null, opts);
  };
  const rows = entries.map((x) => el('div', { class: 'cc-entry', role: 'button', tabindex: '0', onclick: () => edit(x) }, [
    el('div', { class: 'cc-entry-main' }, [
      el('span', { class: 'cc-entry-cat', text: x.r.category || 'Uncategorised' }),
      el('span', { class: 'cc-entry-amt', text: fmtSheetCur(Number(x.r.amount) || 0) }),
    ]),
    el('div', { class: 'cc-entry-sub' }, [
      el('span', { class: 'cc-kind is-' + x.kind, text: x.kind === 'house' ? 'House' : 'Personal' }),
      el('span', { text: _spendDayLabel(x.r.date) + (tagsOf(x.r).length ? ' · ' + tagsOf(x.r).join(', ') : '') }),
      el('span', { class: 'cc-entry-edit', text: 'Edit ✎' }),
    ]),
  ]));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: (card.name || 'Card') + ' · ' + mod.monthLabel(ym) + ' bill' }),
      el('p', { class: 'hint', text: (win ? _spendDayLabel(win.from) + ' – ' + _spendDayLabel(win.to) + ' · ' : '') + entries.length + (entries.length === 1 ? ' entry' : ' entries') + ' · ' + fmtSheetCur(total) }),
    ].concat(rows.length ? rows : [el('p', { class: 'hint', text: 'Nothing logged on this card for this bill.' })])),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })])]),
  ]));
}

// Bottom nav for Personal Finance. Spends is where the entries go in; the
// others read them back - against the limits, by category, against the card
// statements they turn up on, and by tag. Review moved to Analysis.
// Card Check compares a card's bill with the spends on it, household ones included, so it needs Expenses too - the
// same rule, and the same lock, as Credit Cards -> Card Check.
export const pfCardCheckOpen = () => modOn(_modsCache, 'expense') && modOn(_modsCache, 'personal');
export const PF_TABS = [['spends', '\ud83d\uded2', 'Spends'], ['limits', '\ud83c\udfaf', 'Limits'], ['cat', '\u{1F4CA}', 'Category Spend'],
  ['cards', '\u{1F9FE}', 'Card Check'], ['tags', '\ud83c\udff7\ufe0f', 'Tags']];
// Card Check's icon, one for everywhere it appears (Credit Cards, Personal Finance, Analysis → Combined): the
// bill with a magnifying glass over its corner - checking the bill.
export function cardCheckIcon(cls) {
  return el('span', { class: 'cc-check-ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, [
    el('span', { class: 'cc-check-bill', text: '\u{1F9FE}' }),
    el('span', { class: 'cc-check-lens', text: '\u{1F50D}' }),
  ]);
}
