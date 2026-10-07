import { thisYm } from './core.js';
import { fmtIntCur, isForOthers, spendEntryFilter, spendFilterNote, tagRow } from './personal-ui.js';
import { ui } from './state.js';
import { DB } from './db.js';
import { el, $, toast, expRenderStale, appConfirm, _spendableDaysLeft, perDayLabel, perDayAllowance, TRACKER_START_YM } from './app.js';
import { _emergencyDrawIn, _repayEarmarkIn, _sharedFor, _kittyFor } from './expense-review-logic.js';
import { openSpendForm } from './spend-form.js';
import { explainRow } from './expense-review.js';
import { renderHomeExpense, round2, fmtSheetCur, _trkHeatmapGrid, isRefund, fmtSigned, catList, _spendGroupOf, SPEND_CATEGORIES, _spendGroupClass, _SPEND_MONS, _spendDayLabel, _mountMonthStrip, _attachMonthSwipe } from './expense-ui.js';

export async function renderSpendTracker(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  // Every month is loaded, not just the selected one: the insights below
  // compare against previous months, so they need the whole history anyway —
  // and a household's spend rows are a few hundred a year, not a scale where
  // one read per month would pay for itself.
  const [allocs, allSpends, cards, efLoans] = await Promise.all([
    DB.all('allocations').catch(() => []),
    DB.all('spends').catch(() => []),
    DB.all('creditCards').catch(() => []),
    DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
  ]);
  if (expRenderStale(token)) return;
  const cardName = new Map((cards || []).map((c) => [c.id, c.name || 'Card']));

  const byYm = new Map();
  (allSpends || []).forEach((r) => {
    const k = String(r.ym || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) return;
    if (!byYm.has(k)) byYm.set(k, []);
    byYm.get(k).push(r);
  });

  // Timeline spans the tracker's start month through this one, plus any month
  // that already has entries - a back-dated spend outside the range, and a
  // month AHEAD once something is logged in it (next month's rent paid early),
  // must not become unreachable. An empty future month still stays off the strip.
  const timelineYms = [...new Set(mod.monthRangeYm(TRACKER_START_YM, thisYm).concat([...byYm.keys()], [thisYm]))]
    .filter((k) => k <= thisYm || (byYm.get(k) || []).length > 0).sort();
  if (!timelineYms.length) timelineYms.push(thisYm);
  // Opens on the month in progress, not on a future month just because it sorts last.
  if (!ui._trkYm || !timelineYms.includes(ui._trkYm)) ui._trkYm = timelineYms.includes(thisYm) ? thisYm : timelineYms[timelineYms.length - 1];
  const ym = ui._trkYm;
  const year = Number(ym.slice(0, 4));
  const alloc = (allocs || []).find((a) => Number(a.year) === year) || null;

  // The kitty is the House Exp allocation, plus whatever others contribute to the house.
  const share = alloc ? Number(alloc.houseExp) || 0 : 0;
  // Through _kittyFor, so this agrees with the Expense sheet and the Review
  // tab. Computing it inline here is what let the repayment earmark go missing
  // from this one surface while the other two had it.
  const drawn = _emergencyDrawIn(ym, efLoans);
  const earmark = _repayEarmarkIn(ym, efLoans);
  const budget = _kittyFor(ym, allocs, efLoans);
  const sharedIn = _sharedFor(ym, allocs);
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const spends = (byYm.get(ym) || []).slice().sort((a, b2) => String(b2.date || '').localeCompare(String(a.date || '')) || (b2.id - a.id));
  const spent = totalOf(ym);
  const left = round2(budget - spent);
  // Only meaningful for the month in progress, and only while something is
  // left - dividing an overspend across the days ahead would read as an
  // allowance. Same divisor and same rounding as Home, via the one helper.
  const daysInMonth = new Date(year, Number(ym.slice(5, 7)), 0).getDate();
  const daysRemaining = _spendableDaysLeft(ym, now);
  const perDayLeft = daysRemaining > 0 && left > 0 ? perDayAllowance(left, daysRemaining) : null;

  // ---- Month timeline, same as the Credit Card tab ----
  // Fixed under the app header while the rest scrolls, so the month picker
  // stays reachable. Header height is measured, not hardcoded — it varies with
  // the safe-area inset on notched devices.
  const appHeader = document.querySelector('.app-header');
  const timelineWrap = el('div', {
    class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline',
    style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px',
  });
  // Newest first on screen. `timelineYms` itself stays ascending — the default
  // selection takes the last entry, and the insights compare against earlier
  // months — so only the render order is flipped.
  // The heatmap sits with the months but is not one of them - the same shape as
  // the Overall chip on the stocks Overview. While it is up no month is active,
  // and saying so is the point: the figures below are about all of them.
  const heatChip = el('button', {
    type: 'button', class: 'cc-timeline-chip trk-heat-chip' + (ui._trkHeatmap ? ' active' : ''),
    text: '▦ All months',
    onclick: () => { if (ui._trkHeatmap) return; ui._trkHeatmap = true; renderHomeExpense(); },
  });
  const timelineRow = el('div', { class: 'cc-timeline' }, [heatChip].concat(
    timelineYms.slice().reverse().map((k) => el('button', {
      type: 'button',
      class: 'cc-timeline-chip'
        + (!ui._trkHeatmap && k === ym ? ' active' : '')
        + (k === thisYm ? ' is-current' : '')
        + (totalOf(k) > 0 ? ' has-data' : ''),
      text: mod.monthLabel(k),
      onclick: () => {
        if (!ui._trkHeatmap && k === ym) return;
        ui._trkHeatmap = false; ui._trkYm = k; ui._trkTimelineClicked = true; renderHomeExpense();
      },
    }))));
  timelineWrap.appendChild(timelineRow);
  host.appendChild(timelineWrap);
  _mountMonthStrip('tracker', timelineWrap, ui._trkTimelineClicked);
  ui._trkTimelineClicked = false;
  // Same swipe as the Review tab. The two share this month, so leaving one
  // swipeable and the other not would read as broken rather than deliberate.
  _attachMonthSwipe(host, timelineYms, ym, (k) => {
    // Swiping to a month is a way out of the heatmap, not a thing that happens
    // underneath it.
    ui._trkHeatmap = false; ui._trkYm = k; ui._trkTimelineClicked = true; renderHomeExpense();
  });

  if (ui._trkHeatmap) {
    _trkHeatmapGrid(host, timelineYms, byYm, allocs, efLoans, thisYm, mod, now);
    return;
  }

  // ---- Kitty / spent / left ----
  host.appendChild(el('div', { class: 'trk-summary' }, [
    el('div', { class: 'trk-sum-cell' }, [
      // The draw rides on the LABEL line as a badge. It has to be declared —
      // without it the basis below understates the figure above and reads as a
      // bug — but this cell is a third of the width, and spelling it out on the
      // basis line forced a wrap. Beside "Kitty" there is room, and the siren
      // is what the Emergency Fund is marked with everywhere else.
      el('div', { class: 'trk-sum-label trk-label-row' }, [
        el('span', { text: 'Household budget' }),
        drawn > 0
          ? el('span', { class: 'trk-draw-badge', title: 'Emergency draw added this month', text: '🚨' + fmtSheetCur(drawn) })
          : (earmark > 0
            ? el('span', { class: 'trk-draw-badge is-repay', title: 'Emergency loan repayment due this month', text: '↩' + fmtSheetCur(earmark) })
            : document.createTextNode('')),
      ]),
      el('div', { class: 'trk-sum-val', text: fmtSheetCur(budget) }),
      el('div', { class: 'trk-sum-note', text: share > 0 || sharedIn > 0
        ? (share > 0 ? fmtSheetCur(share) + ' house exp' : '') + (sharedIn > 0 ? (share > 0 ? ' + ' : '') + fmtSheetCur(sharedIn) + ' shared by others' : '') + (drawn > 0 && earmark > 0 ? ' − ' + fmtSheetCur(earmark) : '')
        : 'set House Exp for ' + year }),
    ]),
    el('div', { class: 'trk-sum-cell' }, [
      el('div', { class: 'trk-sum-label', text: 'Spent' }),
      el('div', { class: 'trk-sum-val', text: fmtSheetCur(spent) }),
      el('div', { class: 'trk-sum-note', text: spends.length + (spends.length === 1 ? ' entry' : ' entries') }),
    ]),
    el('div', { class: 'trk-sum-cell trk-left' + (left < 0 ? ' is-neg' : '') }, [
      el('div', { class: 'trk-sum-label', text: 'Left' }),
      el('div', { class: 'trk-sum-val', text: fmtSheetCur(left) }),
      // For the CURRENT month, what's left per remaining day is the figure that
      // actually guides a decision today; the percentage used is already drawn
      // as the bar underneath. Whole rupees on purpose — a daily allowance
      // quoted to the paisa is precision nobody spends to.
      el('div', { class: 'trk-sum-note', title: perDayLeft != null
        ? fmtSheetCur(left) + ' across ' + perDayLabel(daysRemaining) : '',
        text: perDayLeft != null
          ? fmtIntCur(perDayLeft) + '/day × ' + daysRemaining
          : (budget > 0 ? Math.round((spent / budget) * 100) + '% used' : '—') }),
    ]),
  ]));

  if (budget > 0) {
    const pct = Math.min(100, Math.max(0, (spent / budget) * 100));
    host.appendChild(el('div', { class: 'trk-bar' }, [
      el('div', { class: 'trk-bar-fill' + (spent > budget ? ' is-over' : ''), style: 'width:' + pct.toFixed(1) + '%' }),
    ]));
  }

  if (!spends.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '📍' }),
      el('p', { text: 'Nothing logged for ' + mod.monthLabel(ym) + ' yet.' }),
      el('p', { class: 'hint', text: share > 0 ? 'Tap "+ Add spend" each time money leaves the household budget.' : 'Set House Exp on the Yearly plan tab first — the household budget is that figure, plus anything others contribute.' }),
    ]));
    return;
  }

  // ---- Rolled up by category, biggest first ----
  const byCat = new Map();
  spends.forEach((r) => {
    const k = r.category || 'Prev Bill Bal / Misc';
    const cur = byCat.get(k) || { total: 0, count: 0 };
    cur.total = round2(cur.total + (Number(r.amount) || 0));
    cur.count++;
    byCat.set(k, cur);
  });
  const cats = [...byCat.entries()].sort((a, b2) => b2[1].total - a[1].total);

  // Category roll-up and the raw entries are two views of the same month, not
  // two things to read together — and the entry list grows all month, so
  // stacking them buried the roll-up further every day. Segmented, defaulting
  // to the roll-up: "where did it go" is the question being asked most.
  const views = [['category', '📊 By category'], ['entries', '🧾 Entries (' + spends.length + ')']];
  host.appendChild(el('div', { class: 'seg trk-seg' }, views.map(([v, label]) =>
    el('button', {
      type: 'button', class: ui._trkView === v ? 'active' : '', text: label,
      onclick: () => { if (ui._trkView === v) return; ui._trkView = v; renderHomeExpense(); },
    }))));

  // Grouped the same way the spend form groups them, so the roll-up reads in
  // the same shape the categories were picked in. Each group carries a colour,
  // which is what makes a long list scannable — the eye finds "that's all
  // grocery" without reading a single label.
  //
  // Groups keep the picker's own order — Fixed, Home, Grocery, Lifestyle,
  // Other — rather than being ranked by spend. A fixed order means the same
  // group sits in the same place every month, so the list can be read from
  // memory; ranking by size moved everything around whenever one month
  // happened to differ. Categories WITHIN a group still lead with the biggest,
  // where the ordering is the useful part.
  const grouped = new Map();
  cats.forEach(([name, c]) => {
    const g = _spendGroupOf(name);
    if (!grouped.has(g)) grouped.set(g, { total: 0, rows: [] });
    const bucket = grouped.get(g);
    bucket.total = round2(bucket.total + c.total);
    bucket.rows.push([name, c]);
  });
  // A share is a share of money that WENT OUT, so it is measured against the
  // gross rather than against `spent`, which is net of refunds. Measured
  // against the net, a month with a refund in it had Grocery at 109% of
  // itself and the refund group at -9%, which is not a share of anything.
  const grossSpent = round2(cats.reduce((a, [, c]) => a + Math.max(0, c.total), 0));
  // Only groups that actually have entries this month. Ordered by their
  // position in SPEND_CATEGORIES, so the order can never drift from the
  // picker's; anything unrecognised sorts last.
  const groupOrder = catList('spend').map((g) => g.group);
  const rank = (name) => { const i = groupOrder.indexOf(name); return i === -1 ? groupOrder.length : i; };
  const groupList = [...grouped.entries()].sort((a, b2) => rank(a[0]) - rank(b2[0]));

  const catWrap = el('div', { class: 'trk-groups' });
  groupList.forEach(([gname, g]) => {
    const gback = g.total < 0;
    const gpct = !gback && grossSpent > 0 ? (g.total / grossSpent) * 100 : 0;
    const rows = el('div', { class: 'trk-cats' });
    g.rows.forEach(([name, c]) => {
      // A share of the month is meaningless for a line that came off it, so a
      // refund says what it is instead of quoting a negative percentage.
      const back = c.total < 0;
      const pct = !back && grossSpent > 0 ? (c.total / grossSpent) * 100 : 0;
      rows.appendChild(el('div', { class: 'trk-cat' + (back ? ' is-refund' : '') }, [
        el('div', { class: 'trk-cat-top' }, [
          el('span', { class: 'trk-cat-name' }, [
            el('span', { class: 'trk-cat-dot' }),
            el('span', { text: name }),
          ]),
          el('span', { class: 'trk-cat-amt', text: fmtSigned(c.total) }),
        ]),
        el('div', { class: 'trk-cat-bottom' }, [
          // Share of the WHOLE month, not of its group — a bar that filled up
          // inside its group would make a small group's top row look like the
          // month's biggest expense.
          el('span', { class: 'trk-cat-track' }, [
            el('span', { class: 'trk-cat-fill', style: 'width:' + Math.max(2, pct).toFixed(1) + '%' }),
          ]),
          el('span', { class: 'trk-cat-meta', text: c.count + '× · ' + (back ? 'came back' : pct.toFixed(0) + '%') }),
        ]),
      ]));
    });
    catWrap.appendChild(el('section', { class: 'trk-group ' + _spendGroupClass(gname) }, [
      el('div', { class: 'trk-group-head' + (gback ? ' is-refund' : '') }, [
        el('span', { class: 'trk-group-name', text: gname }),
        el('span', { class: 'trk-group-total', text: fmtSigned(g.total) }),
        el('span', { class: 'trk-group-pct', text: gback ? 'came back' : gpct.toFixed(0) + '%' }),
      ]),
      rows,
    ]));
  });
  // ---- Every entry, newest first ----
  // Filtered by how it was paid, and by which card. Built whether or not the
  // entries view is showing, since which one is on screen is decided below -
  // the filter row goes in the same wrapper so it travels with the list.
  const entriesWrap = el('div', {});
  const trkFilter = spendEntryFilter(spends, cards, ui._trkFilter, (v) => { ui._trkFilter = v; renderHomeExpense(); });
  ui._trkFilter = trkFilter.current;
  if (trkFilter.node) entriesWrap.appendChild(trkFilter.node);
  const shownSpends = spends.filter(trkFilter.matches);
  const trkNote = spendFilterNote(trkFilter, shownSpends);
  if (trkNote) entriesWrap.appendChild(trkNote);
  const list = el('div', { class: 'msheet' });
  shownSpends.forEach((r) => {
    list.appendChild(el('div', { class: 'msheet-row trk-entry is-tappable'
      + (isRefund(r) ? ' is-refund' : ''), onclick: () => openSpendForm(budget, r) }, [
      el('div', { class: 'msheet-label' }, [
        el('span', { text: r.category || '—' }),
        el('span', { class: 'msheet-note', text: _spendDayLabel(r.date) + ' · '
          + (r.method || 'UPI') + (r.cardId != null && cardName.has(r.cardId) ? ' (' + cardName.get(r.cardId) + ')' : '')
          + (r.note ? ' · ' + r.note : '') }),
        tagRow(r) || document.createTextNode(''),
      ]),
      el('div', { class: 'trk-entry-right' }, [
        el('span', { class: 'msheet-val', text: fmtSigned(r.amount) }),
        el('button', {
          class: 'icon-btn trk-del', type: 'button', text: '×', 'aria-label': 'Delete this spend',
          onclick: async (e) => {
            e.stopPropagation(); // the row opens the editor; the × must not
            // Every card spend is part of a month's reimbursement now, not
            // just this month's, so the warning is about the method alone.
            const billed = r.method === 'Card';
            if (!(await appConfirm('Delete ' + fmtSigned(r.amount) + ' on ' + (r.category || '—') + '?'
              + (billed ? '\n\nIt will also come off that month\'s card reimbursement.' : '')))) return;
            await DB.del('spends', r.id);
            toast('Deleted');
            renderHomeExpense();
          },
        }),
      ]),
    ]));
  });
  if (!shownSpends.length) {
    list.appendChild(el('p', { class: 'hint', style: 'text-align:center;padding:14px 0;margin:0',
      text: 'Nothing on this filter for ' + mod.monthLabel(ym) + '.' }));
  }
  entriesWrap.appendChild(list);
  host.appendChild(ui._trkView === 'entries' ? entriesWrap : catWrap);

  // ---- Insights: this month read against the ones before it ----
  // Only under the category view — they're commentary on that roll-up, and the
  // entries list is already long.
  // Wrapped: the insights are commentary, and a failure computing them must not
  // take the rest of the tab down with it. When this threw, everything after it
  // — including the footer — silently vanished, and the only visible symptom
  // was a missing panel.
  try {
    const insights = ui._trkView === 'category' ? _trackerInsights(ym, timelineYms, byYm, byCat, spent, totalOf) : [];
    if (insights.length) {
      host.appendChild(el('h3', { class: 'div-group-head', text: '💡 Insights' }));
      host.appendChild(el('div', { class: 'trk-insights' }, insights.map((it) =>
        el('div', { class: 'trk-insight' + (it.tone ? ' is-' + it.tone : '') }, [
          el('span', { class: 'trk-insight-ico', text: it.icon }),
          el('div', { class: 'trk-insight-body' }, [
            el('div', { class: 'trk-insight-head', text: it.head }),
            el('div', { class: 'trk-insight-sub', text: it.sub }),
          ]),
        ]))));
    }
  } catch (_) { /* commentary only — the month's figures above stand on their own */ }

  host.appendChild(explainRow('About the household budget', 'The household budget is the Yearly plan tab\'s House Exp, plus what someone else contributes to the house if you turned that on there. Every spend logged here comes off it. This tab always shows the current month; earlier months stay in the backup.', 'Where the household budget comes from'));
}

// 'YYYY-MM' -> "Sep '26", for form copy that has no credit.js import to hand.
export const _spendMonthLabel = (k) => {
  const m = /^(\d{4})-(\d{2})/.exec(k || '');
  return m ? _SPEND_MONS[+m[2] - 1] + " '" + m[1].slice(2) : k;
};

// This month, as 'YYYY-MM'. Card statements are only touched for the CURRENT
// month: an earlier month's bill has already been issued and very likely paid,
// so back-filling a spend into it would rewrite a statement that is closed.
export const _thisSpendYm = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

// ---------- The month's card reimbursement ----------
//
// Two kinds of spend land on a card and then come back to you:
//
//   * a HOUSEHOLD spend put on the card - the kitty covers it;
//   * a PERSONAL spend marked FOR OTHERS put on the card - the person covers it.
//
// Both are money the bank billed you that is not yours to carry, which is
// exactly what credit.js means by reimbursement. Together they ARE the month's
// figure, so it is summed from the entries rather than nudged by a delta as
// each one is saved.
//
// Nudging drifted, and could only ever drift: it fired for the current month
// only, only once a card had been picked, clamped at zero so a stray reversal
// was permanent, and never saw the personal half at all. A sum cannot drift
// from the rows it is a sum of.
//
// Which month a card spend belongs to is statementYmFor, as everywhere else -
// the bill being reimbursed is the one the spend lands on, not the calendar
// month it happened in. A card spend with no card named has no cycle to sit
// in, so it falls back to its own month rather than disappearing.
export function _reimbParts(cards, houseSpends, personalSpends, mod) {
  const byId = new Map((cards || []).map((c) => [c.id, c]));
  const parts = new Map();
  const at = (k) => {
    let p = parts.get(k);
    if (!p) { p = { house: 0, others: 0, derived: 0 }; parts.set(k, p); }
    return p;
  };
  const add = (rows, key, keep) => (rows || []).forEach((r) => {
    if (r.method !== 'Card' || !keep(r)) return;
    const card = r.cardId != null ? byId.get(r.cardId) : null;
    const ym = card ? mod.statementYmFor(r.date, card) : String(r.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    const p = at(ym);
    p[key] = round2(p[key] + (Number(r.amount) || 0));
  });
  add(houseSpends, 'house', () => true);
  // Personal spends made for others are NOT part of the reimbursement any more: they are on the Balance sheet's
  // Virtual Bal list (what somebody owes you back), so counting them here as well would take them off twice.
  // `others` stays in the shape (always 0) for the screens that still read it.
  parts.forEach((p) => { p.derived = round2(p.house + p.others); });
  return parts;
}

// The figure each month actually uses, and why it is that figure.
//
// Three rules, in order:
//   1. a figure the user TYPED wins - it is a correction, and a correction that
//      a recount quietly undid would be worthless;
//   2. otherwise a month with card spends logged against it uses their sum;
//   3. otherwise the stored figure stands. A month with nothing logged has
//      nothing to say about itself, and months from before the Tracker existed
//      carry hand-entered figures that are the only record there is.
export function _reimbMap(parts, reimbRows) {
  const stored = new Map((reimbRows || []).map((r) => [r.ym, r]));
  const map = {};
  const detail = new Map();
  new Set([...parts.keys(), ...stored.keys()]).forEach((ym) => {
    const p = parts.get(ym) || { house: 0, others: 0, derived: 0 };
    const row = stored.get(ym) || null;
    const manual = !!(row && row.manual);
    const auto = !manual && p.derived > 0;
    const amount = auto ? p.derived : round2(Number(row && row.amount) || 0);
    map[ym] = amount;
    detail.set(ym, { house: p.house, others: p.others, derived: p.derived, amount, auto, manual });
  });
  return { map, detail };
}

// What has actually been SETTLED in each statement month: the bills marked
// paid. Money that has left the account, which is why the monthly sheet
// subtracts it - and it is read off the cards rather than stored a second
// time, so unmarking a bill takes it straight back off.
function _ccPaidByYm(cards) {
  const out = {};
  (cards || []).forEach((c) => (c.months || []).forEach((r) => {
    const ym = String((r && r.ym) || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    if (r.status !== 'ontime' && r.status !== 'late') return;
    out[ym] = round2((out[ym] || 0) + (Number(r.billed) || 0));
  }));
  return out;
}

// Both readers - the Credit Card tab and the monthly sheet's Next Month Due -
// go through here, so the two can never disagree about the same month.
export async function ccReimbursements() {
  const mod = await import('./credit.js');
  const [cards, rows, house, personal] = await Promise.all([
    DB.all('creditCards').catch(() => []),
    DB.all('ccReimbursements').catch(() => []),
    DB.all('spends').catch(() => []),
    DB.all('personalSpends').catch(() => []),
  ]);
  return Object.assign(_reimbMap(_reimbParts(cards, house, personal, mod), rows),
    { paid: _ccPaidByYm(cards) });
}

// What this month's spending says when read against the months before it.
// Returns only the observations that actually have data behind them — an
// insight panel that pads itself out with "no change" lines stops being read.
//
// Deliberately plain arithmetic on months already in memory: no projection
// models, no thresholds tuned to one household. Each line states a number the
// user could verify by hand, which is the only kind worth trusting here.
function _trackerInsights(ym, timelineYms, byYm, byCat, spent, totalOf) {
  const out = [];
  const fmtDelta = (n) => (n >= 0 ? '+' : '−') + fmtSheetCur(Math.abs(n)).replace('₹', '₹');
  const monLabel = (k) => {
    const m = /^(\d{4})-(\d{2})/.exec(k || '');
    return m ? _SPEND_MONS[+m[2] - 1] : k;
  };

  // Calendar previous month, whether or not it has entries — "nothing last
  // month" is itself worth knowing, so it isn't skipped over silently.
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYm = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const prevTotal = totalOf(prevYm);
  const prevRows = byYm.get(prevYm) || [];

  // ---- 1. Against last month ----
  if (prevTotal > 0) {
    const diff = round2(spent - prevTotal);
    const pct = Math.abs(Math.round((diff / prevTotal) * 100));
    out.push({
      icon: diff > 0 ? '📈' : diff < 0 ? '📉' : '➖',
      tone: diff > 0 ? 'warn' : diff < 0 ? 'good' : '',
      head: diff === 0
        ? 'Same as ' + monLabel(prevYm)
        : fmtDelta(diff) + ' vs ' + monLabel(prevYm) + ' (' + pct + '%)',
      sub: monLabel(prevYm) + ' came to ' + fmtSheetCur(prevTotal) + '; this month is ' + fmtSheetCur(spent) + '.',
    });
  }

  // ---- 2. Against the running average of earlier months ----
  const earlier = timelineYms.filter((k) => k < ym).map((k) => totalOf(k)).filter((t) => t > 0);
  if (earlier.length >= 2) {
    const avg = round2(earlier.reduce((s, t) => s + t, 0) / earlier.length);
    const diff = round2(spent - avg);
    out.push({
      icon: '⚖️',
      tone: diff > 0 ? 'warn' : 'good',
      head: fmtDelta(diff) + ' vs your ' + earlier.length + '-month average',
      sub: 'You normally spend about ' + fmtSheetCur(avg) + ' a month.',
    });
  }

  // ---- 3. Categories that moved most against last month ----
  if (prevRows.length) {
    const prevCat = new Map();
    prevRows.forEach((r) => {
      const k = r.category || 'Prev Bill Bal / Misc';
      prevCat.set(k, round2((prevCat.get(k) || 0) + (Number(r.amount) || 0)));
    });
    const names = new Set([...byCat.keys(), ...prevCat.keys()]);
    const moves = [...names].map((n) => ({
      name: n,
      now: (byCat.get(n) || { total: 0 }).total,
      was: prevCat.get(n) || 0,
    })).map((m) => Object.assign(m, { diff: round2(m.now - m.was) }));

    const up = moves.filter((m) => m.diff > 0).sort((a, b2) => b2.diff - a.diff)[0];
    const down = moves.filter((m) => m.diff < 0).sort((a, b2) => a.diff - b2.diff)[0];
    if (up) {
      out.push({
        icon: '🔺', tone: 'warn',
        head: up.name + ' up ' + fmtSheetCur(up.diff),
        sub: fmtSheetCur(up.was) + ' in ' + monLabel(prevYm) + ' → ' + fmtSheetCur(up.now) + ' now.',
      });
    }
    if (down) {
      out.push({
        icon: '🔻', tone: 'good',
        head: down.name + ' down ' + fmtSheetCur(Math.abs(down.diff)),
        sub: fmtSheetCur(down.was) + ' in ' + monLabel(prevYm) + ' → ' + fmtSheetCur(down.now) + ' now.',
      });
    }
    // Something being spent on for the first time is worth surfacing on its
    // own — it won't top the "moved most" list while it's still small.
    const fresh = moves.filter((m) => m.was === 0 && m.now > 0).sort((a, b2) => b2.now - a.now)[0];
    if (fresh && (!up || fresh.name !== up.name)) {
      out.push({
        icon: '🆕', tone: '',
        head: 'New this month: ' + fresh.name,
        sub: fmtSheetCur(fresh.now) + ', with nothing in ' + monLabel(prevYm) + '.',
      });
    }
  }

  // ---- 4. Where the money actually goes ----
  //
  // Against the gross, not against `spent`, which is net of refunds - the
  // roll-up above this panel measures shares the same way, and one page
  // calling the same category 49% in one place and 54% in another is a page
  // nobody trusts twice.
  const grossOut = round2([...byCat.values()].reduce((a, c) => a + Math.max(0, c.total), 0));
  const top = [...byCat.entries()].sort((a, b2) => b2[1].total - a[1].total)[0];
  if (top && grossOut > 0 && top[1].total > 0) {
    const pct = Math.round((top[1].total / grossOut) * 100);
    if (pct >= 30) {
      out.push({
        icon: '🎯', tone: '',
        head: top[0] + ' is ' + pct + '% of the month',
        sub: fmtSheetCur(top[1].total) + ' of ' + fmtSheetCur(grossOut) + ' went there.',
      });
    }
  }

  return out;
}
