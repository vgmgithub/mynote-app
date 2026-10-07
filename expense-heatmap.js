import { thisYm } from './core.js';
import { fmtIntCur } from './personal-ui.js';
import { ui } from './state.js';
import { el, b, closeModal, openModal, _spendableDaysLeft, perDayLabel, perDayAllowance } from './app.js';
import { _emergencyDrawIn, _kittyNoEarmark } from './expense-review-logic.js';
import { explainRow } from './expense-review.js';
import { round2, fmtSheetCur, fmtSigned, catList, _spendDayLabel } from './expense-ui.js';

// ---------- The heatmap: every month at once ----------
//
// The spreadsheet this app replaced was read this way and nothing else came
// close: one row per category, one column per month, and the colour doing the
// work. A number tells you what a month cost; a row of colour tells you which
// months were unlike the others, which is the only way an eye finds the one
// that went wrong.
//
// Each row is scaled against ITS OWN figures rather than one shared across the
// grid. Rent would otherwise be red in every column simply for being the
// biggest line in the house, and the milk would never be anything but green -
// neither of which says a thing about whether a month was unusual.
//
// Each cell is judged against the nearest EARLIER month that has an entry for
// that same category (see the call site below) - a plain month-over-month
// comparison, not the row's median. Green = down from last time, red = up.
// This was a median-vs-the-row comparison originally ("usually costs X"), but
// that reads a month as "normal" (grey) whenever it lands close to the middle
// of its own history even if it swung hard against the one month right next
// to it - which is exactly the comparison a reader's eye is actually making
// when it scans left to right. Changed 2026-09-15.
//
// Grey is reserved for the ONE case with nothing to compare against at all
// (no earlier entry for that category). Everything else gets a real verdict -
// a small dip is still green, a small rise still red, just a lighter shade of
// one than a month that doubled. Five fixed bands couldn't say that: two
// swings landing in the same band (say +20% and +48%, both "over") painted
// identically, so a genuinely bigger jump didn't read as any bigger. A
// continuous intensity (this month's % change from last, capped) fixes both
// complaints at once - no more grey-when-it-should-be-coloured, and a run of
// reds or greens now visibly varies with how far each one actually moved.
const HEAT_GREEN_RGB = '52,211,153';   // same green as --good / the old h-low2
const HEAT_RED_RGB = '248,113,113';    // same red as --bad / the old h-hi2
// A change at or beyond this magnitude is already "as coloured as it gets" -
// capping keeps one huge outlier from being the only cell with real colour
// and washing out every smaller-but-real swing sitting next to it.
const HEAT_CAP_PCT = 0.5;
// {cls} for the fixed cases (refund / no data / nothing to compare against),
// {style} for everything else - a continuously-scaled inline background, the
// same technique health.js's calendar chips already use for their own
// continuous month-colour sweep, rather than inventing a dozen more classes
// for what is genuinely a smooth scale.
export const _heatCell = (amount, prev) => {
  if (amount < 0) return { cls: 'h-refund' };   // money came back - a different fact than "spent little"
  if (!(amount > 0)) return { cls: 'h-none' };
  if (!(prev > 0)) return { cls: 'h-mid' };      // nothing earlier to compare against - neutral, not a verdict
  const change = (amount - prev) / prev;
  const intensity = Math.min(1, Math.abs(change) / HEAT_CAP_PCT);
  // Floors so even a small real change still shows SOME colour (the whole
  // point of dropping the flat "normal" band), rising to a near-solid fill
  // at the cap.
  const alpha = (0.14 + intensity * 0.5).toFixed(2);
  const rgb = change <= 0 ? HEAT_GREEN_RGB : HEAT_RED_RGB;
  const strong = intensity > 0.55;
  return { style: 'background: rgba(' + rgb + ',' + alpha + ');' + (strong ? ' color: var(--text); font-weight: 700;' : '') };
};


// ---- Heatmap month click: show category popup ----
// Category breakdown for one heatmap month - the same shape a tap-open sheet
// uses everywhere else in the app (.sheet / .msheet-row), so this needed no
// CSS of its own.
function _openHeatmapMonthModal(ym, byCat, mod) {
  // In the picker's own order, matching how the grid's rows read top to
  // bottom. Only categories with an entry that month appear - a cell with
  // nothing in it has nothing to open, so it is not offered as if it did.
  const ordered = [];
  catList('spend').forEach((g) => g.items.forEach((n) => { if (byCat.has(n)) ordered.push(n); }));
  [...byCat.keys()].forEach((n) => { if (ordered.indexOf(n) < 0) ordered.push(n); });

  const monthLabel = mod.monthLabel(ym);
  const list = el('div', { class: 'msheet' });
  ordered.forEach((cat) => {
    const recs = byCat.get(cat);
    const total = round2(recs.reduce((a, r) => a + (Number(r.amount) || 0), 0));
    list.appendChild(el('div', { class: 'msheet-row trk-entry is-tappable', onclick: () => {
      _openHeatmapCatModal(cat, monthLabel, recs, ym, byCat, mod);
    } }, [
      el('div', { class: 'msheet-label' }, [
        el('span', { text: cat }),
        el('span', { class: 'msheet-note', text: recs.length + (recs.length === 1 ? ' entry' : ' entries') }),
      ]),
      el('span', { class: 'msheet-val', text: fmtSigned(total) }),
    ]));
  });
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: monthLabel }),
      list,
    ]),
    el('div', { class: 'sheet-footer' }, [
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

// One category's own entries for that month - displays date/time, tags, and
// payment method as a badge. No category repeat (all entries are the same).
// Payment method badge in top-right corner (green), amount below it.
// "First Installment Repaid" for an Emergency Fund repayment entry, whether it is linked to its loan or an older one
// recognised by its note; null for anything else.
const _ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
function _installmentLabel(r) {
  const m = /emergency fund (\d+)(?:st|nd|rd|th) installment/i.exec(r.note || '');
  if (m) return (_ORD[Number(m[1]) - 1] || (m[1] + 'th')) + ' Installment Repaid';
  return r.efLoanId != null ? 'Installment Repaid' : null;
}
function _openHeatmapCatModal(cat, monthLabel, recs, ym, byCat, mod) {
  const sorted = recs.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const list = el('div', { class: 'msheet' });
  sorted.forEach((r) => {
    const repaid = _installmentLabel(r);
    const label = el('div', { class: 'msheet-label' }, [
      el('div', {}, [
        el('div', { style: 'font-weight: 500; margin-bottom: 4px;', text: _spendDayLabel(r.date) + (r.time ? ' · ' + r.time : '') }),
        el('div', { style: 'display: flex; gap: 4px; flex-wrap: wrap;' }, [
          ...(r.tags || []).map(t => el('span', { class: 'tag-pill', style: 'font-size: 0.75rem;', text: t })),
        ]),
        // An Emergency Fund repayment: its note ("Emergency fund 1st installment - ₹1,470 repaid") becomes one small
        // badge, "🚨 First Installment Repaid", at the same size as the tags.
        repaid ? el('div', { style: 'margin-top: 4px;' }, [el('span', { class: 'tag-pill trk-ef-repay', style: 'font-size: 0.75rem;', text: '🚨 ' + repaid })])
          : r.note ? el('div', { class: 'hint', style: 'margin: 4px 0 0; font-size: 0.72rem;', text: r.note }) : null,
      ].filter(Boolean)),
    ]);
    const rightSide = el('div', { style: 'display: flex; flex-direction: column; align-items: flex-end; gap: 6px;' }, [
      r.method ? el('span', { class: 'tag-pill hm-payment-badge', style: 'font-size: 0.75rem; font-weight: 600;', text: r.method }) : document.createTextNode(''),
      // A spend marked "Paid on emergency": just a siren beside the amount, at the amount's own size.
      el('span', { class: 'msheet-val', text: (r.fromEmergency ? '🚨 ' : '') + fmtSigned(r.amount) }),
    ]);
    const row = el('div', { class: 'msheet-row trk-entry', style: 'align-items: flex-start;' }, [
      label,
      rightSide,
    ]);
    list.appendChild(row);
  });
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: cat + ' · ' + monthLabel }),
      list,
    ]),
    el('div', { class: 'sheet-footer' }, [
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

// One month's raw records, grouped by category - shared by the month header
// (every category that month) and a single cell (this cell's category only,
// but still needs the full map so its own Back button can reopen the header
// view rather than crash on a missing map).
function _groupByCategory(recs) {
  const byCat = new Map();
  (recs || []).forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    if (!byCat.has(n)) byCat.set(n, []);
    byCat.get(n).push(r);
  });
  return byCat;
}

export function _trkHeatmapGrid(host, yms, byYm, allocs, efLoans, thisYm, mod, now) {
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // Only months that actually hold something, plus the one in progress. A
  // column of blanks for a month before the tracker existed is noise in a view
  // whose whole job is making the non-blank cells stand out.
  const cols = yms.filter((k) => totalOf(k) > 0 || k === thisYm);
  if (cols.length < 2) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '▦' }),
      el('p', { text: 'Not enough months yet.' }),
      el('p', { class: 'hint', text: 'The heatmap compares months against each other, so it needs a '
        + 'second one before it can say anything. Tap a month above to log spends meanwhile.' }),
    ]));
    return;
  }

  // category -> ym -> amount
  const catByYm = new Map();
  cols.forEach((k) => (byYm.get(k) || []).forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    if (!catByYm.has(n)) catByYm.set(n, new Map());
    const m = catByYm.get(n);
    m.set(k, round2((m.get(k) || 0) + (Number(r.amount) || 0)));
  }));

  // In the picker's own order, so the grid reads like the form does. Anything
  // retired from the list but still sitting in an old month is kept, at the
  // end, rather than dropped along with its money.
  const ordered = [];
  catList('spend').forEach((g) => g.items.forEach((n) => { if (catByYm.has(n)) ordered.push(n); }));
  [...catByYm.keys()].forEach((n) => { if (ordered.indexOf(n) < 0) ordered.push(n); });

  const table = el('table', { class: 'heatmap cc-grid trk-heat' });
  const head = el('tr', {}, [el('th', { class: 'corner', text: 'Month' })]
    .concat(cols.map((k) => {
    const th = el('th', { class: (k === thisYm ? 'is-now' : '') + ' is-clickable hm-ym', text: mod.monthLabel(k) });
    // That month's own raw records, grouped by category - NOT catByYm, which
    // maps category -> Map(ym -> summed amount) for the heat cells above.
    // Calling .map() on one of those Maps is what crashed every render of
    // this grid: Map has no .map, so building this header threw before the
    // table ever finished, and the whole Tracker view went blank with it.
    th.onclick = () => _openHeatmapMonthModal(k, _groupByCategory(byYm.get(k)), mod);
    return th;
  })));
  const tbody = el('tbody');

  // A refund's total for the month is negative, and it is real data - not
  // the absence of any. Only an exact zero (nothing logged that cell at all)
  // gets the dash; a negative total prints signed, the same "+" convention
  // fmtSigned uses everywhere else money can come back rather than go out.
  const money = (v) => (v > 0 ? fmtIntCur(v) : v < 0 ? '+' + fmtIntCur(Math.abs(v)) : '—');
  const row = (label, cls, cells) => {
    const tr = el('tr', { class: cls || '' }, [el('th', { class: 'rowhead', text: label })]);
    cells.forEach((c) => {
      // `style`, when given, is a continuously-scaled inline background (see
      // _heatCell) - not something a fixed class list can express.
      const td = el('td', { class: (c.cls || '') + (c.onclick ? ' is-clickable' : ''), style: c.style || '', title: c.title || '', text: c.text });
      if (c.onclick) td.onclick = c.onclick;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  };

  // What went IN, first - every other row is read against it.
  // All months reads an emergency draw the way it happened: the month it was taken gets the money on top of its
  // household budget, and each repayment shows up as spending in its own category in the month it was PAID
  // (the Tracker entry the loan writes when a repayment is recorded) - so later months' budgets are not also
  // cut by the schedule. A planned repayment that is not paid yet shows nowhere here.
  const kittyOf = (k) => _kittyNoEarmark(k, allocs, efLoans);
  row('Household budget', 'trk-heat-household budget', cols.map((k) => {
    const d = _emergencyDrawIn(k, efLoans);
    return { text: money(kittyOf(k)), title: d > 0 ? 'Includes ' + fmtSheetCur(d) + ' emergency draw taken this month' : '' };
  }));

  ordered.forEach((name) => {
    const per = catByYm.get(name);
    row(name, '', cols.map((k, i) => {
      const v = per.get(k) || 0;
      // Compared against the nearest EARLIER month that actually has an
      // entry, not the row's overall median and not strictly the column
      // right before it - a gap month (nothing bought that category) would
      // otherwise either wash out a real comparison or read as a spike/drop
      // that never happened. Same "skip the gap" rule the Credit Card tab's
      // own "vs last month" already uses.
      let prevVal = 0;
      for (let j = i - 1; j >= 0; j--) {
        const pv = per.get(cols[j]) || 0;
        if (pv > 0) { prevVal = pv; break; }
      }
      // Only a cell that actually holds something opens - an empty cell
      // ("—") has nothing to show, so it stays inert rather than
      // offering a tap that lands on nothing.
      const recs = v !== 0 ? (byYm.get(k) || []).filter((r) => (r.category || 'Prev Bill Bal / Misc') === name) : null;
      const heat = _heatCell(v, prevVal);
      return {
        text: money(v),
        cls: heat.cls,
        style: heat.style,
        title: v > 0 && prevVal > 0
          ? name + ' ' + mod.monthLabel(k) + ': ' + fmtSheetCur(v) + ' · was ' + fmtIntCur(prevVal) + ' before'
          : '',
        onclick: recs && recs.length
          ? () => _openHeatmapCatModal(name, mod.monthLabel(k), recs, k, _groupByCategory(byYm.get(k)), mod)
          : null,
      };
    }));
  });

  // ---- The four summary rows ----
  //
  // Marked as a block, not styled like the categories above them. The
  // categories say where the money went; these four say whether the month
  // worked, which is a different question and the one most often being asked
  // of this grid.
  //
  // `trk-sum-top` rather than leaning on `tr.cc-sum:first-of-type`: that
  // selector means "the first TR that also has cc-sum", and the first TR in
  // this table is Kitty, so the separator it was meant to draw never appeared.
  row('Spent', 'cc-sum trk-sum-top', cols.map((k) => {
    const t = totalOf(k), b = kittyOf(k);
    return { text: money(t), cls: b > 0 ? (t > b ? 'h-hi2' : 'h-low1') : '',
      title: b > 0 ? fmtSheetCur(t) + ' of a ' + fmtSheetCur(b) + ' household budget' : '' };
  }));
  row('Left', 'cc-sum', cols.map((k) => {
    const b = kittyOf(k);
    if (!(b > 0)) return { text: '—' };
    const lf = round2(b - totalOf(k));
    return { text: fmtIntCur(lf), cls: lf < 0 ? 'h-hi2' : 'h-low2' };
  }));
  // Only the month in progress has days still to come. A closed month has none,
  // and printing 1 for it - as the sheet did - invites dividing by it.
  row('Days left', 'cc-sum trk-heat-quiet', cols.map((k) => {
    const d = _spendableDaysLeft(k, now);
    return { text: d > 0 ? String(d) : '—', title: d > 0 ? perDayLabel(d) : 'Month closed' };
  }));
  row('Per day', 'cc-sum', cols.map((k) => {
    const d = _spendableDaysLeft(k, now);
    const lf = round2(kittyOf(k) - totalOf(k));
    if (!(d > 0) || !(kittyOf(k) > 0)) return { text: '—' };
    if (lf <= 0) return { text: fmtIntCur(0), cls: 'h-hi2', title: 'Nothing left to spread' };
    return { text: fmtIntCur(perDayAllowance(lf, d)), cls: 'h-low2',
      title: fmtSheetCur(lf) + ' across ' + perDayLabel(d) };
  }));

  table.appendChild(el('thead', {}, [head]));
  table.appendChild(tbody);

  const scroll = el('div', { class: 'heatmap-scroll cc-scroll' }, [table]);
  // Opens on the newest month, and stays where it is put after that - the same
  // rule as the Credit Card grid, for the same reason.
  const gridEnd = () => Math.max(0, scroll.scrollWidth - scroll.clientWidth);
  scroll.addEventListener('scroll', () => {
    ui._trkHeatScroll = Math.abs(scroll.scrollLeft - gridEnd()) < 4 ? null : scroll.scrollLeft;
  }, { passive: true });
  host.appendChild(scroll);
  const park = () => { scroll.scrollLeft = ui._trkHeatScroll == null ? gridEnd() : Math.min(ui._trkHeatScroll, gridEnd()); };
  park();
  requestAnimationFrame(park);

  // Rent is fixed and doesn't move the way the rest of the kitty does, so
  // lumping it into "average spend" answers a different question than the one
  // usually asked: what does the household actually get through in a normal
  // month. This is a single lifetime figure - the same across every month on
  // screen - which is why it lives once below the whole table rather than
  // repeated into the per-month Insights panel on each individual month.
  //
  // Computed as the average of (month total − that month's Rent), not as
  // (average total) − (average Rent): the two only agree if both sides divide
  // by the same number of months, and a month with nothing under Rent - before
  // it was tracked, or paid in cash that month - would otherwise drop out of
  // the Rent average's denominator and quietly inflate it. Reuses the Rent
  // row's own per-month map (catByYm) rather than re-scanning byYm.
  const rentAvgCols = cols.filter((k) => totalOf(k) > 0);
  if (rentAvgCols.length >= 2) {
    const rentByYm = catByYm.get('Rent') || new Map();
    const nonRentAvg = round2(rentAvgCols.reduce((s, k) => s + (totalOf(k) - (rentByYm.get(k) || 0)), 0) / rentAvgCols.length);
    host.appendChild(el('div', { class: 'trk-heat-avg' }, [
      el('span', { class: 'trk-heat-avg-lbl', text: '🏠 House Average Expense' }),
      el('span', { class: 'trk-heat-avg-val', text: '~' + fmtSheetCur(nonRentAvg) + ' / month' }),
      el('span', { class: 'trk-heat-avg-note', text: 'avg of ' + rentAvgCols.length + ' months' }),
    ]));
  }

  host.appendChild(el('div', { class: 'trk-heat-key' }, [
    el('span', { class: 'trk-heat-key-lbl', text: 'vs the month before' }),
    el('span', { class: 'trk-heat-swatch h-mid', text: 'no earlier month' }),
    // A gradient bar, not fixed steps - the actual cells scale continuously
    // (a bigger change = a deeper shade), so a handful of discrete swatches
    // would misrepresent the very thing this legend is explaining.
    el('span', { class: 'trk-heat-swatch trk-heat-swatch-grad',
      style: 'background: linear-gradient(90deg, rgba(' + HEAT_GREEN_RGB + ',0.14), rgba(' + HEAT_GREEN_RGB + ',0.7));',
      text: 'down · less → more' }),
    el('span', { class: 'trk-heat-swatch trk-heat-swatch-grad',
      style: 'background: linear-gradient(90deg, rgba(' + HEAT_RED_RGB + ',0.14), rgba(' + HEAT_RED_RGB + ',0.7));',
      text: 'up · less → more' }),
  ]));
  host.appendChild(explainRow('About the heatmap', [
    'One row per category, one column per month. Every row is coloured against '
      + 'ITS OWN history, not against the other rows - otherwise rent would be red in every '
      + 'column for being the biggest line in the house, and milk green in every column for being '
      + 'the smallest, and neither would tell you anything.',
    'Each cell is compared against the NEAREST EARLIER month that actually has an entry for that '
      + 'category - a gap month with nothing bought is skipped over rather than counted as a drop to '
      + 'zero. A month with nothing earlier to compare against (the first one logged) reads neutral, '
      + 'not red or green - there is nothing yet to call it against.',
    'The shade scales with how big the change actually was, not a handful of fixed steps - a small '
      + 'dip is a pale green, a month that doubled is a deep red, and two different-sized jumps no '
      + 'longer paint identically just for landing in the same rough band.',
    'Household budget is what went in that month. Spent, Left and Per day are read against it. Days left and '
      + 'Per day only apply to the month in progress - a closed month has no days still to spend.',
  ], 'How the colours are worked out'));
}
