import { DB } from './db.js';
import { thisYm } from './core.js';
import { ui } from './state.js';
import { sortCardsByCycle } from './credit.js';
import { el, round2, fmtSheetCur, _mountMonthStrip, _attachMonthSwipe, _spendDayLabel, explainRow } from './app.js';
import { openPfSpendForm, tagsOf } from './personal-ui.js';
import { openSpendForm } from './spend-form.js';

// ---------- Credit Cards -> Payments ----------
// Every payment made on every card, one by one, for the statement month picked - the page to cross-check a bill
// line by line and correct an entry without leaving it. Nothing here has storage of its own: it reads the
// household (spends) and personal (personalSpends) trackers, and a tap opens the same edit form they use.
//
// A payment belongs to the bill its OWN card's cycle puts it on (statementYmFor) - never the calendar month - so a
// card on 8th - 7th shows the swipes of 8 Sep to 7 Oct under October, the month that bill is paid.

export async function renderCcPayments(host, token, o) {
  const rerender = o.rerender, stale = o.stale;
  const mod = await import('./credit.js');
  const [cards, house, personal] = await Promise.all([
    DB.all('creditCards').then((r) => sortCardsByCycle(r || [])),
    DB.all('spends').catch(() => []),
    DB.all('personalSpends').catch(() => []),
  ]);
  if (stale(token)) return;

  if (!cards.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\u{1F4B3}' }),
      el('p', { text: 'No credit cards yet.' }),
      el('p', { class: 'hint', text: 'Add a card on the Credit Card tab, then log spends against it.' }),
    ]));
    return;
  }

  const cardById = new Map(cards.map((c) => [c.id, c]));
  // Each card payment with the statement month its own card files it under.
  const all = [];
  const take = (rows, kind) => (rows || []).forEach((r) => {
    if (r.method !== 'Card') return;
    const card = cardById.get(r.cardId);
    if (!card) return;
    all.push({ r, kind, card, ym: mod.statementYmFor(r.date, card) });
  });
  take(house, 'house');
  take(personal, 'personal');

  // Months with payments, this month, and the one after: a swipe today is often on next month's bill.
  const now = thisYm();
  const nd = new Date(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 1);
  const nextYm = nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0');
  const months = [...new Set(all.map((x) => x.ym).filter(Boolean).concat([now, nextYm]))].sort();
  if (!ui._ccPayYm || !months.includes(ui._ccPayYm)) ui._ccPayYm = now;
  const ym = ui._ccPayYm;

  // The month timeline on top, the same strip the other card tabs use.
  const appHeader = document.querySelector('.app-header');
  const timelineWrap = el('div', {
    class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline',
    style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px',
  });
  const hasData = new Set(all.map((x) => x.ym));
  timelineWrap.appendChild(el('div', { class: 'cc-timeline' }, months.slice().reverse().map((k) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip' + (k === ym ? ' active' : '') + (k === now ? ' is-current' : '') + (k > now ? ' is-ahead' : '') + (hasData.has(k) ? ' has-data' : ''),
    text: mod.monthLabel(k),
    onclick: () => { if (k === ym) return; ui._ccPayYm = k; ui._ccPayTimelineClicked = true; rerender(); },
  }))));
  host.appendChild(timelineWrap);
  _mountMonthStrip('ccpay', timelineWrap, ui._ccPayTimelineClicked);
  ui._ccPayTimelineClicked = false;
  _attachMonthSwipe(host, months, ym, (k) => { ui._ccPayYm = k; ui._ccPayTimelineClicked = true; rerender(); });

  const inMonth = all.filter((x) => x.ym === ym);
  const grand = round2(inMonth.reduce((s, x) => s + (Number(x.r.amount) || 0), 0));
  host.appendChild(el('h3', { class: 'div-group-head', text: '\u{1F5C2}️ ' + mod.monthLabel(ym) + ' payments · ' + inMonth.length + (inMonth.length === 1 ? ' entry' : ' entries') + ' · ' + fmtSheetCur(grand) }));

  // The edit forms repaint the page themselves through onSaved; a deleted or moved entry simply drops out.
  const edit = (x) => {
    const opts = { onSaved: rerender };
    if (x.kind === 'house') openSpendForm(0, x.r, null, opts); else openPfSpendForm(x.r, null, opts);
  };

  cards.forEach((card) => {
    const list = inMonth.filter((x) => x.card.id === card.id)
      .sort((a, b) => String(b.r.date).localeCompare(String(a.r.date)) || (Number(b.r.id) || 0) - (Number(a.r.id) || 0));
    const total = round2(list.reduce((s, x) => s + (Number(x.r.amount) || 0), 0));
    const win = mod.cycleWindow(ym, card);
    const box = el('div', { class: 'pf-card-check cc-pay-card' }, [
      el('div', { class: 'pf-cc-top' }, [
        el('span', { class: 'pf-cc-name', text: card.name || 'Card' }),
        el('span', { class: 'pf-cc-billed', text: list.length ? fmtSheetCur(total) + ' · ' + list.length : 'no payments' }),
      ]),
      el('div', { class: 'pf-cc-win' + (win && win.isCycle ? '' : ' is-nocycle'), text: win
        ? (win.isCycle
          ? _spendDayLabel(win.from) + ' – ' + _spendDayLabel(win.to) + ' · cycle ' + win.startDay + '–' + win.endDay
          : _spendDayLabel(win.from) + ' – ' + _spendDayLabel(win.to) + ' · no cycle set on this card')
        : '' }),
    ]);
    list.forEach((x) => {
      const tags = tagsOf(x.r);
      box.appendChild(el('div', { class: 'cc-entry', role: 'button', tabindex: '0', onclick: () => edit(x) }, [
        el('div', { class: 'cc-entry-main' }, [
          el('span', { class: 'cc-entry-cat', text: x.r.category || 'Uncategorised' }),
          el('span', { class: 'cc-entry-amt', text: fmtSheetCur(Number(x.r.amount) || 0) }),
        ]),
        el('div', { class: 'cc-entry-sub' }, [
          el('span', { class: 'cc-kind is-' + x.kind, text: x.kind === 'house' ? 'House' : 'Personal' }),
          el('span', { text: _spendDayLabel(x.r.date) }),
          el('span', { class: 'cc-entry-edit', text: 'Edit ✎' }),
        ]),
        tags.length ? el('div', { class: 'cc-pay-tags' }, tags.map((t) => el('span', { class: 'cc-pay-tag', text: t }))) : null,
      ].filter(Boolean)));
    });
    host.appendChild(box);
  });

  host.appendChild(explainRow('About this page', 'Each card is read over its OWN billing cycle, shown under its name, and a bill is named for the month it closes in. Tap any payment to correct it - category, amount, date, tags, or whether it is House or Personal - and it moves to the right month and card at once.', 'How the payments are grouped'));
}
