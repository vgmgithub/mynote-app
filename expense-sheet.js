import { thisYm, todayISO, num } from './core.js';
import { tagsOf } from './personal-ui.js';
import { ui } from './state.js';
import { DB } from './db.js';
import { efLoad } from './ef.js';
import { _vaultCopyBtn } from './vault-ui.js';
import { el, state, $, toast, closeModal, openModal, EXPENSE_START_YM, expRenderStale, appConfirm, _historyIcon, field } from './app.js';
import { _kittyFor } from './expense-review-logic.js';
import { explainRow } from './expense-review.js';
import { ccReimbursements } from './expense-tracker.js';
import { renderHomeExpense, round2, fmtSheetCur, sumExpr, exprTerm, normaliseExpr, _spendDayLabel } from './expense-ui.js';

// ---------- Sheet rows that are really a LIST ----------
//
// Two rows on the monthly sheet are not one figure but several, and a single
// box cannot say what they are:
//
//   * VIRTUAL BALANCE - money other people are holding. Lent, fronted, owed.
//     It stops being virtual the moment somebody hands it over, when it moves
//     into In Hand. One number cannot be settled a piece at a time and cannot
//     say who is holding what.
//   * OTHER EXPENSE - the month's unrelated one-offs. A repair, a gift, a fee.
//     It used to be a running total typed as "2000+5000", which recorded the
//     amounts and nothing about what they were, so a month later the figure
//     could not be explained.
//
// In both the headline is the total and the useful record is the parts. Same
// machinery for both, described by this table: where the list is stored, what
// the old single figure was called, and the words the form needs.
const SHEET_LISTS = {
  virtual: {
    key: 'virtualItems', legacy: 'virtualBalance', title: 'Virtual balance',
    rowLabel: 'Virtual Bal', totalLabel: 'Virtual balance',
    itemPlaceholder: 'Who has it', itemAria: 'Who has it',
    blurb: 'Money somebody else is holding — lent out, fronted, or owed to you. '
      + 'It counts towards this month like cash does. When it is actually paid back, remove the row: '
      + 'the amount is in your hand from then on, so it belongs in In Hand instead.',
    empty: 'Nobody owes you anything this month.',
    totalCls: 'is-credit',
    rowEmpty: 'tap + to add who owes you',
    btnTitle: 'Who owes you this month',
    savedNone: 'Virtual balance cleared',
  },
  other: {
    key: 'otherItems', legacy: 'otherExpense', title: 'Other expense',
    rowLabel: 'Other Expense', totalLabel: 'Other expense',
    itemPlaceholder: 'What for', itemAria: 'What for',
    blurb: 'The one-offs that belong to none of the rows above — a repair, a gift, a fee, a fine. '
      + 'The figure on the sheet is the total of what is listed here, so a month can still be '
      + 'explained line by line long after it has closed.',
    empty: 'Nothing else this month.',
    totalCls: 'is-debit',
    rowEmpty: 'tap + to itemise',
    btnTitle: 'What else went out this month',
    savedNone: 'Other expense cleared',
  },
  // Loans the person already has (home, car, personal). One entry per loan, with a Paid button on each. Paid means the
  // loan is settled: it drops below as a struck-through previous loan with the date it was paid, is no longer counted
  // in the month's loan total, and does not carry into the next month.
  // Separate from the Emergency Fund's loans, which are for money the fund lends out in future.
  loan: {
    key: 'loanItems', legacy: 'loan', title: 'Existing loans',
    rowLabel: 'Loan', totalLabel: 'Loan repayments',
    itemPlaceholder: 'Which loan', itemAria: 'Which loan', amountAria: 'Amount owed',
    blurb: 'Loans you already have: home, car, personal. Add each one with the amount still owed, then log every repayment as you make it. '
      + 'The sheet counts what is left, and once a loan is fully repaid it moves below as a previous loan with its date. '
      + 'The Emergency Fund\u2019s loans are separate: those are for future needs.',
    empty: 'No existing loans this month.',
    totalCls: 'is-debit',
    rowEmpty: 'tap + to add your loans',
    btnTitle: 'Your existing loans this month',
    savedNone: 'Loans cleared',
    paidToggle: true,
  },
};

// Kept on the month's own sheet row like every other figure there, so a past
// month keeps the picture as it stood.
function sheetItemsOf(sheet, cfg) {
  const raw = sheet && sheet[cfg.key];
  if (Array.isArray(raw)) {
    return raw
      .map((it) => ({
        label: String((it && it.label) || '').trim(),
        amount: round2(Number(it && it.amount) || 0),
        // Which spend put this row here, when one did. Carried through every
        // read and write of the list so that editing that spend can move its
        // own row and leave every hand-written one alone.
        srcId: it && it.srcId != null ? it.srcId : null,
        // Only the loans list uses this: the repayment has gone out this month.
        paid: !!(it && it.paid),
        paidOn: it && it.paidOn ? String(it.paidOn).slice(0, 10) : null,
        // Loans only: every repayment made against this loan, oldest first.
        repaid: Array.isArray(it && it.repaid)
          ? it.repaid.map((r) => ({ amount: round2(Number(r && r.amount) || 0), date: String((r && r.date) || '').slice(0, 10) })).filter((r) => r.amount > 0)
          : [],
      }))
      .filter((it) => it.label || it.amount);
  }
  // A month written while this was a single figure keeps that figure, as one
  // entry. Dropping it would quietly change that month's closing balance.
  // Other Expense arrives as an expression ("2000+5000"); sumExpr reads both
  // that and a plain number, and the sum is what the sheet was using anyway.
  const legacy = sumExpr(sheet && sheet[cfg.legacy]);
  return legacy ? [{ label: 'Carried over', amount: legacy }] : [];
}
const sheetItemsTotal = (items) => round2((items || []).reduce((a, it) => a + (Number(it.amount) || 0), 0));
// A loan's repayments so far, and what is still owed on it.
const repaidTotal = (it) => round2(((it && it.repaid) || []).reduce((a, r) => a + (Number(r.amount) || 0), 0));
const loanLeft = (it) => round2(Math.max(0, (Number(it && it.amount) || 0) - repaidTotal(it)));
// What the sheet's Loan row costs: what is still owed on the loans not yet settled.
const loansOwed = (items) => round2((items || []).filter((i) => !i.paid).reduce((a, i) => a + loanLeft(i), 0));
// A month sheet's existing loans as two numbers - how many are still open and what is owed on them - for
// the AI prompt, which must never see a loan's label.
export function sheetLoanSummary(sheet) {
  const open = sheetItemsOf(sheet, SHEET_LISTS.loan).filter((i) => !i.paid && loanLeft(i) > 0);
  return { count: open.length, owed: loansOwed(open) };
}

// The repayments made against one loan, newest first, with a way to undo a wrong one. Rendered inside the
// form (never as a second sheet, which would discard unsaved edits).
function loanHistoryPanel(row, onChange) {
  const panel = el('div', { class: 'loan-hist' });
  const draw = () => {
    panel.innerHTML = '';
    const items = (row.repaid || []).slice().reverse();
    if (!items.length) { panel.appendChild(el('p', { class: 'hint', style: 'margin:0', text: 'No repayments logged yet.' })); return; }
    items.forEach((r) => {
      panel.appendChild(el('div', { class: 'loan-hist-row' }, [
        el('span', { class: 'loan-hist-date', text: _spendDayLabel(r.date) }),
        el('span', { class: 'loan-hist-amt', text: fmtSheetCur(r.amount) }),
        el('button', {
          class: 'icon-btn vb-del', type: 'button', text: '\u00d7',
          title: 'Remove this repayment', 'aria-label': 'Remove this repayment',
          onclick: () => {
            const at = row.repaid.lastIndexOf(r);
            if (at >= 0) row.repaid.splice(at, 1);
            // Taking a repayment away can un-settle a loan.
            if (row.paid && loanLeft(row) > 0) { row.paid = false; row.paidOn = null; }
            if (onChange) onChange();
          },
        }),
      ]));
    });
  };
  draw();
  return panel;
}

// One row per person or reason: what it is, and how much. Rows are added as
// things happen and removed when they stop being true.
function openSheetListForm(ym, sheet, cfg, monthLabel, onSaved, auto) {
  const rows = sheetItemsOf(sheet, cfg).map((it) => ({ label: it.label, amount: it.amount, srcId: it.srcId, paid: it.paid, paidOn: it.paidOn, repaid: (it.repaid || []).slice() }));
  const autoAmt = auto && auto.amount > 0 ? round2(auto.amount) : 0;
  const wrap = el('div', { class: 'vb-rows' });
  // Which loans are showing their repayment history; kept across redraws of the list.
  const openHist = new Set();
  // Green reads as money coming in, and only one of these two is. A running
  // total that colours a repair bill like income is worse than uncoloured.
  const totalEl = el('span', { class: 'vb-total-val ' + (cfg.totalCls || '') });
  const inputs = [];

  const syncTotal = () => {
    let sum = 0;
    // For loans the figure that matters is what is still owed, not what was borrowed.
    inputs.forEach(({ ix, amt }) => {
      const v = num(amt.value) || 0;
      sum = round2(sum + (cfg.paidToggle ? Math.max(0, round2(v - repaidTotal(rows[ix]))) : v));
    });
    totalEl.textContent = fmtSheetCur(round2(sum + autoAmt));
  };
  // Values are read back out of the boxes before any redraw, so a half-typed
  // row is not thrown away by adding or removing another one.
  const syncRows = () => {
    inputs.forEach(({ ix, lbl, amt }) => {
      // Keeps what the box does not show (the spend it came from, whether it is paid).
      rows[ix] = Object.assign({}, rows[ix], { label: lbl.value, amount: round2(num(amt.value) || 0) });
    });
  };

  const draw = () => {
    wrap.innerHTML = '';
    inputs.length = 0;
    const settled = [];
    rows.forEach((r, ix) => {
      if (r == null) return;
      // A settled loan is kept below, read-only, and never counted.
      if (cfg.paidToggle && r.paid) { settled.push({ r, ix }); return; }
      const lbl = el('input', { type: 'text', class: 'vb-label', value: r.label || '',
        placeholder: cfg.itemPlaceholder, 'aria-label': cfg.itemAria });
      const amt = el('input', { type: 'number', inputmode: 'decimal', step: 'any', class: 'vb-amt',
        value: r.amount ? r.amount : '', placeholder: '0', 'aria-label': 'Amount' });
      amt.addEventListener('input', syncTotal);
      inputs.push({ ix, lbl, amt });
      const delBtn = el('button', {
        class: 'icon-btn vb-del', type: 'button', text: '×',
        title: 'Remove this entry', 'aria-label': 'Remove this entry',
        onclick: () => { syncRows(); rows[ix] = null; draw(); },
      });
      if (!cfg.paidToggle) { wrap.appendChild(el('div', { class: 'vb-row' }, [lbl, amt, delBtn])); return; }

      // A loan is paid off over time: log each repayment, see the tally, and it settles itself when nothing is left.
      const payInp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', min: '0', class: 'vb-amt loan-pay',
        placeholder: 'Repay \u20b9', 'aria-label': 'Repayment for ' + (r.label || 'this loan') });
      const addPay = () => {
        const v = round2(num(payInp.value) || 0);
        if (!(v > 0)) { toast('Enter the amount you repaid'); return; }
        syncRows();
        const row = rows[ix];
        row.repaid = (row.repaid || []).concat([{ amount: v, date: todayISO() }]);
        if (loanLeft(row) <= 0) { row.paid = true; row.paidOn = todayISO(); toast((row.label || 'Loan') + ' fully repaid'); }
        draw();
      };
      payInp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addPay(); } });
      const done = repaidTotal(r), left = loanLeft(r);
      wrap.appendChild(el('div', { class: 'vb-loan' }, [
        el('div', { class: 'vb-row' }, [lbl, amt, delBtn]),
        el('div', { class: 'vb-loan-meta' }, [
          el('span', { class: 'vb-loan-tally', text: done > 0
            ? fmtSheetCur(done) + ' repaid \u00b7 ' + fmtSheetCur(left) + ' left'
            : 'Nothing repaid yet' }),
          el('button', { class: 'icon-btn vb-loan-hist', type: 'button', title: 'Repayment history',
            'aria-label': 'Repayment history for ' + (r.label || 'this loan'),
            onclick: () => { if (openHist.has(ix)) openHist.delete(ix); else openHist.add(ix); draw(); } }, [_historyIcon()]),
        ]),
        openHist.has(ix) ? loanHistoryPanel(rows[ix], () => draw()) : null,
        el('div', { class: 'vb-loan-pay' }, [
          payInp,
          el('button', { class: 'btn small primary', type: 'button', text: 'Add', onclick: addPay }),
          el('button', { class: 'vb-paid', type: 'button', text: 'Settle', title: 'Mark this loan as fully settled',
            onclick: () => { syncRows(); rows[ix].paid = true; rows[ix].paidOn = todayISO(); draw(); } }),
        ]),
        // filter(Boolean): the history panel is only there when it is open.
      ].filter(Boolean)));
    });
    if (!inputs.length) {
      wrap.appendChild(el('p', { class: 'hint', style: 'margin:0', text: cfg.empty }));
    }
    if (settled.length) {
      wrap.appendChild(el('div', { class: 'vb-prev-head', text: 'Previous loans' }));
      settled.forEach(({ r, ix }) => { wrap.appendChild(el('div', { class: 'vb-row vb-prev' }, [
        el('span', { class: 'vb-prev-name', text: r.label }),
        el('span', { class: 'vb-prev-amt', text: fmtSheetCur(r.amount) }),
        (r.repaid && r.repaid.length) ? el('button', { class: 'icon-btn vb-loan-hist', type: 'button', title: 'Repayment history',
          'aria-label': 'Repayment history for ' + (r.label || 'this loan'),
          onclick: () => { if (openHist.has('p' + ix)) openHist.delete('p' + ix); else openHist.add('p' + ix); draw(); } }, [_historyIcon()]) : null,
        el('span', { class: 'vb-prev-date', text: 'Paid ' + (r.paidOn ? _spendDayLabel(r.paidOn) : '') }),
        el('button', {
          class: 'icon-btn vb-prev-undo', type: 'button', text: 'Undo', title: 'Move this loan back to your active loans',
          onclick: () => { syncRows(); rows[ix].paid = false; rows[ix].paidOn = null; draw(); },
        }),
      ].filter(Boolean)));
        if (openHist.has('p' + ix)) wrap.appendChild(loanHistoryPanel(r, () => draw()));
      });
    }
    syncTotal();
  };

  const addRow = () => {
    syncRows();
    rows.push({ label: '', amount: 0 });
    draw();
    const last = inputs[inputs.length - 1];
    if (last) last.lbl.focus();
  };
  draw();

  const save = async () => {
    syncRows();
    // A row with neither a name nor an amount is a blank line, not an entry.
    const items = rows.filter(Boolean)
      .map((r) => ({ label: String(r.label || '').trim(), amount: round2(Number(r.amount) || 0),
        srcId: r.srcId != null ? r.srcId : null, paid: !!r.paid, paidOn: r.paid ? (r.paidOn || todayISO()) : null,
        repaid: (r.repaid || []).map((x) => ({ amount: round2(Number(x.amount) || 0), date: x.date || todayISO() })) }))
      .filter((r) => r.label || r.amount > 0);
    if (items.some((r) => !r.label)) { toast('Every entry needs a name'); return; }
    if (items.some((r) => r.amount <= 0)) { toast('Every entry needs an amount'); return; }
    const patch = { ym, updatedAt: new Date().toISOString() };
    patch[cfg.key] = items;
    // The old single figure is cleared once the list owns the number, so the
    // two can never both be read and disagree.
    patch[cfg.legacy] = null;
    patch[cfg.legacy + 'Src'] = null;
    await DB.put('monthlySheet', Object.assign({}, sheet, patch));
    closeModal();
    toast(items.length
      ? fmtSheetCur(sheetItemsTotal(items)) + ' across ' + items.length + (items.length === 1 ? ' entry' : ' entries')
      : cfg.savedNone);
    if (onSaved) onSaved();
  };

  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: cfg.title + ' · ' + monthLabel }),
      el('p', { class: 'hint', text: cfg.blurb }),
      wrap,
      // The live line under a divider: read-only, worked out from the cards' cycles, not part of the saved list.
      auto ? el('div', { class: 'vb-auto' }, [
        el('hr', { class: 'vb-auto-hr' }),
        el('div', { class: 'vb-row vb-auto-row' }, [
          el('div', { class: 'vb-auto-body' }, [
            el('div', { class: 'vb-auto-name' }, [document.createTextNode(auto.label), el('span', { class: 'msheet-follow', text: 'auto' })]),
            el('div', { class: 'vb-auto-note', text: auto.note }),
          ]),
          el('span', { class: 'vb-auto-amt', text: fmtSheetCur(autoAmt) }),
        ]),
      ]) : document.createTextNode(''),
      el('div', { class: 'vb-add' }, [
        el('button', { class: 'btn small primary', type: 'button', text: '+ Add entry', onclick: addRow }),
      ]),
      el('div', { class: 'vb-total' }, [
        el('span', { class: 'vb-total-label', text: cfg.totalLabel }),
        totalEl,
      ]),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ])]),
  ]));
}

// Opens the existing-loans list for a month (the Get started card lands here).
export async function openLoanEntries() {
  const now = new Date();
  const ym = ui._expSheetYm || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
  const mod = await import('./credit.js');
  const sheet = (await DB.get('monthlySheet', ym).catch(() => null)) || { ym };
  openSheetListForm(ym, sheet, SHEET_LISTS.loan, mod.monthLabel(ym), () => renderHomeExpense());
}

// ---------- A personal spend for somebody else, paid by UPI ----------
//
// On a card this is already handled: every "for others" card spend counts into
// that cycle's reimbursement, because a bill is coming and somebody else is
// going to settle their share of it.
//
// Paid by UPI there is no bill for it to land on. The money simply left, and
// what is left behind is a person owing you — which is precisely what Virtual
// Bal is a list of. So the spend writes itself a row there, labelled with its
// category and whatever tags it carries, rather than being typed twice.
//
// Linked by srcId, and that link is what keeps this from fighting the user:
// editing the spend moves its own row, deleting the spend takes it away, and
// a row removed by hand — the way this list is meant to be used the day
// somebody pays you back — is never put back by a later edit.
// "appa payment" when the spend says who will pay it back; otherwise its category and tags.
const owedLabel = (rec) => (rec.owedBy ? rec.owedBy + ' payment' : [String(rec.category || 'Misc')].concat(tagsOf(rec)).join(' - '));
export const isOwedRow = (rec) => !!(rec && rec.forOthers) && rec.method !== 'Card' && Number(rec.amount) > 0;

export async function syncOwedRow(rec, id, wasOwed) {
  const cfg = SHEET_LISTS.virtual;
  const recYm = String((rec && rec.ym) || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(recYm) || id == null) return;
  const owed = isOwedRow(rec);
  if (!owed && !wasOwed) return;                 // never was one, still is not

  // A new owed row goes on the CURRENT month's list - that is where the money is being waited for, whatever date
  // the spend itself carries. An existing row is found wherever it already sits (the spend's own month, for rows
  // made before this, or this month) and stays there.
  const curYm = todayISO().slice(0, 7);
  let ym = curYm, stored = null, items = [], at = -1;
  for (const k of [...new Set([recYm, curYm])]) {
    const sh = await DB.get('monthlySheet', k).catch(() => null);
    const list = sh ? sheetItemsOf(sh, cfg) : [];
    const i = list.findIndex((it) => it.srcId === id);
    if (i >= 0) { ym = k; stored = sh; items = list; at = i; break; }
  }
  if (at < 0) {
    stored = await DB.get('monthlySheet', ym).catch(() => null);
    items = stored ? sheetItemsOf(stored, cfg) : [];
  }
  // A month nobody has opened has no sheet yet, and this must not be the thing that creates it: a sheet made here
  // holding only this one row would look "already started" and skip the new-month carry-over (loans, running
  // totals, In Hand's own figure). It is marked `unseeded`, and the sheet seeds itself around it on first open.
  const sheet = stored || { ym, unseeded: true };

  if (owed) {
    const row = { label: owedLabel(rec), amount: round2(Number(rec.amount) || 0), srcId: id };
    if (at >= 0) items[at] = row;
    else if (!wasOwed) items.push(row);          // newly owed: a row is due
    else return;                                 // it had one and it was removed
  } else if (at >= 0) {
    items.splice(at, 1);
  } else return;

  const patch = { ym, updatedAt: new Date().toISOString() };
  patch[cfg.key] = items;
  // Only the virtual list is touched: nothing else on the month's sheet is rewritten.
  if (stored) { patch[cfg.legacy] = null; patch[cfg.legacy + 'Src'] = null; }
  await DB.put('monthlySheet', Object.assign({}, sheet, patch)).catch(() => {});
}

// A spend being deleted takes its row with it, if it still has one.
export async function dropOwedRow(rec) {
  if (!isOwedRow(rec) || rec.id == null) return;
  await syncOwedRow(Object.assign({}, rec, { forOthers: false }), rec.id, true);
}

// The row on the sheet: a read-only total, who or what is behind it, and the +
// that opens the list. A figure that is the sum of a list cannot also be typed
// over without one of the two becoming a lie, so there is no box here.
// `auto` (Other Expense only): a live line the list always ends with - { label, amount, note } - worked out
// from the cards, never stored, so it can never go stale or be counted twice by a save.
function sheetListRow(ym, sheet, cfg, monthLabel, cls, onSaved, auto) {
  const items = sheetItemsOf(sheet, cfg);
  // Settled loans are shown but never counted, and a loan only costs what is still owed on it.
  const autoAmt = auto && auto.amount > 0 ? round2(auto.amount) : 0;
  const total = round2((cfg.paidToggle ? loansOwed(items) : sheetItemsTotal(items)) + autoAmt);
  const names = items.map((i) => i.label).filter(Boolean);
  const node = el('div', { class: 'msheet-row ' + cls }, [
    el('div', { class: 'msheet-label' }, [
      el('span', {}, [cfg.rowLabel, el('span', { class: 'msheet-follow', text: 'list' })]),
      el('span', { class: 'msheet-note', text: (items.length
        ? items.length + (items.length === 1 ? ' entry · ' : ' entries · ')
          + (cfg.paidToggle ? items.filter((i) => i.paid).length + ' paid · ' : '')
          + names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) + ' more' : '')
        : (autoAmt ? '' : cfg.rowEmpty))
        + (autoAmt ? (items.length ? ' · ' : '') + auto.short + ' ' + fmtSheetCur(autoAmt) : '') }),
    ]),
    el('div', { class: 'msheet-list' }, [
      el('span', { class: 'msheet-val', text: fmtSheetCur(total) }),
      el('button', {
        class: 'cat-add-btn msheet-list-btn', type: 'button', text: '+',
        title: cfg.btnTitle, 'aria-label': 'Edit ' + cfg.title + ' entries',
        onclick: (e) => { e.stopPropagation(); openSheetListForm(ym, sheet, cfg, monthLabel, onSaved, auto); },
      }),
    ]),
  ]);
  return { node, items, total };
}

// ---------- Monthly cash-flow sheet (Expense → Expense tab) ----------
// One month at a time: what came in, what's committed out, what's left.
//
// Almost every row is READ LIVE from the surface that owns it rather than
// re-entered here — Allocation owns the plan, Credit Card owns the month's
// reimbursement, Emergency owns the fund. Only the three figures no other
// surface knows (virtual balance, loan, this month's own spending) are typed
// in, and those are the only ones stored (monthlySheet, keyed by month).
//
// Allocation's per-category figures are already PER MONTH (the tab is headed
// "Annual Allocations" and totals them as annual, but the amounts themselves
// are a monthly plan), so they're carried across as-is — no scaling.
export async function renderExpenseSheet(host, token) {
  const mod = await import('./credit.js');
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  // The sheet runs from the month it went into use to the CURRENT month, and no
  // further: a future month has no card statement, no spending and no fund
  // balance behind it, so stepping into one would only ever show a hollow copy
  // of the plan. Clamped rather than merely hidden, so a stale _expSheetYm
  // (left behind by a month rolling over mid-session) can't strand the tab on
  // an out-of-range month.
  const months = mod.monthRangeYm(EXPENSE_START_YM, thisYm);
  if (!months.length) months.push(thisYm); // clock set before the start month
  if (!ui._expSheetYm || !months.includes(ui._expSheetYm)) ui._expSheetYm = months[months.length - 1];
  const ym = ui._expSheetYm;
  const year = Number(ym.slice(0, 4));

  const [allocs, reimb, sheetRow, ef, spendRows, efLoans] = await Promise.all([
    DB.all('allocations').catch(() => []),
    ccReimbursements().catch(() => ({ map: {}, detail: new Map() })),
    DB.get('monthlySheet', ym).catch(() => null),
    efLoad().catch(() => null),
    DB.byIndex('spends', 'ym', ym).catch(() => []),
    DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
  ]);
  if (expRenderStale(token)) return;
  const alloc = (allocs || []).find((a) => Number(a.year) === year) || null;
  const sheet = sheetRow || {};

  // What the Tracker tab has left in the household kitty for this month —
  // House Exp (plus others' contribution), less everything logged against it. Feeds the Monthly
  // Expense row so the two surfaces can't disagree about the same figure.
  const kitty = _kittyFor(ym, allocs, efLoans);
  const kittySpent = round2((spendRows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const kittyLeft = round2(kitty - kittySpent);
  const efAvail = ef ? round2(Math.max(0, ef.c.cashInHand)) : 0;
  // The same figure the Credit Card tab shows: household card spends plus
  // personal ones made for somebody else, over each card's own cycle.
  const reimbAmt = round2((reimb && reimb.map && reimb.map[ym]) || 0);
  const reimbBits = (reimb && reimb.detail && reimb.detail.get(ym)) || null;
  // Card bills marked paid on the Credit Card tab. A statement is named for the
  // month it closes in, which is the month it is paid in, so it belongs on
  // THIS month's sheet.
  const cardPaid = round2((reimb && reimb.paid && reimb.paid[ym]) || 0);

  // Allocation figures are already monthly — used as entered.
  const perMonth = (key) => (alloc ? Number(alloc[key]) || 0 : 0);
  const planNote = alloc ? year + ' allocation' : 'no ' + year + ' allocation';

  // ---- The committed (red) rows ----
  // `source` is the live figure the owning surface reports for this month, or
  // null for the two nothing else knows about. Every one of these carries an
  // editable box holding a RUNNING TOTAL the user accumulates into — Fetch adds
  // the source on top of whatever's already there, so pulling twice in a month
  // records both. The row's headline number is that box.
  const debitRows = [
    // Follows the month's combined card reimbursement, which card spends on
    // the Tracker add to themselves — so logging one flows straight through
    // to here. Out of Fetch for the same reason EMI / EF is: already live.
    { key: 'nextMonthDue', label: 'Next Month Due', source: null, single: true, fallback: reimbAmt,
      note: 'card reimbursement · ' + fmtSheetCur(reimbAmt)
        + (reimbBits && reimbBits.auto && reimbBits.others > 0
          ? ' (house ' + fmtSheetCur(reimbBits.house) + ' + others ' + fmtSheetCur(reimbBits.others) + ')' : '') },
    // Follows the Emergency Fund's own available cash, so the two can't
    // disagree. `source: null` keeps it out of Fetch — there is nothing to
    // pull when the figure is already live — while staying overridable for a
    // month the fund was actually drawn on.
    { key: 'emiEf', label: 'EMI / EF', source: null, single: true, fallback: efAvail,
      note: ef ? 'emergency fund · ' + fmtSheetCur(efAvail) : 'you enter' },
    // A list now (one entry per loan, each with a Paid button); its total is the row's figure.
    { key: 'loan', label: 'Loan', list: true, source: null, note: '' },
    { key: 'home', label: 'Parents', source: perMonth('home'), note: planNote },
    { key: 'mf', label: 'Mutual Fund', source: perMonth('mf'), note: planNote },
    { key: 'indStock', label: 'Ind Stock', source: perMonth('indStock'), note: planNote },
    { key: 'usStock', label: 'US Stock', source: perMonth('usStock'), note: planNote },
    { key: 'metal', label: 'Metal', source: perMonth('metal'), note: planNote },
    // `single` rows are one editable figure with no accumulation box: nothing
    // fetches into them, so there'd be no list of terms to keep. Monthly
    // Expense defaults to whatever the Tracker has left in the kitty, and is
    // overridable for a month that didn't work out that way.
    { key: 'monthlyExpense', label: 'Monthly Expense', source: null, single: true, fallback: kittyLeft,
      note: kitty > 0 ? 'tracker balance · ' + fmtSheetCur(kittyLeft) : 'you enter' },
  ];
  // Boxes are stored as text ("2000+5000"), but earlier months were written as
  // plain numbers — String() covers both, and sumExpr reads either. Normalised
  // on the way out so a box written before term-rounding existed (the emergency
  // fund's cash arrives as 140600.25999999999) reads back at 2dp.
  const exprOf = (r) => normaliseExpr(sheet[r.key]);
  // sumExpr on BOTH kinds, deliberately: a row that used to accumulate "+"
  // terms and is now a single figure still has months holding "70300+70300" on
  // record, and Number() on that is NaN — which would have silently read as
  // zero and quietly changed those months' closing balance.
  // A `single` row shows its live source while it is following, and its own
  // figure once it has genuinely been overridden.
  const boxOf = (r) => (r.list
    ? loansOwed(sheetItemsOf(sheet, SHEET_LISTS.loan))
    : r.single
      ? (followsSource(r.key, sheet[r.key]) ? round2(r.fallback || 0) : sumExpr(sheet[r.key]))
      : sumExpr(exprOf(r)));

  // ---- Month stepper + the shared Fetch ----
  // Steps within the known range only. While the range IS one month (the sheet
  // has only just started) the arrows are left out entirely rather than shown
  // permanently dead — they reappear on their own once a second month exists.
  const monthIx = months.indexOf(ym);
  const multiMonth = months.length > 1;
  const monthLabelEl = el('span', { class: 'msheet-month-label', text: mod.monthLabel(ym) });
  const step = (delta) => {
    const next = months[monthIx + delta];
    if (!next) return;
    ui._expSheetYm = next;
    renderHomeExpense();
  };

  // Pulls every committed row that HAS a live source, APPENDING it to that
  // row's expression as another "+" term rather than collapsing the box to a
  // single total — so the box keeps a visible record of what was added.
  // Loan and Monthly Expense have no source to pull, so they're left alone.
  // Confirmed first because it's additive: running it twice by mistake would
  // silently double the month, and there's no undo.
  const fetchable = debitRows.filter((r) => r.source != null && r.source > 0);
  const appended = (r) => {
    const cur = exprOf(r).trim();
    return cur === '' ? exprTerm(r.source) : cur + '+' + exprTerm(r.source);
  };
  const fetchAll = async () => {
    if (!fetchable.length) { toast('Nothing to fetch for ' + mod.monthLabel(ym)); return; }
    const lines = fetchable.map((r) => '  • ' + r.label + ':  ' + appended(r) + '  =  ' + fmtSheetCur(boxOf(r) + r.source));
    const ok = (await appConfirm(
      'Add this month\'s figures into ' + mod.monthLabel(ym) + '?\n\n' + lines.join('\n')
      + '\n\nThis ADDS to what each box already holds — running it again will add them a second time.'
    ));
    if (!ok) return;
    const patch = { ym, updatedAt: new Date().toISOString() };
    fetchable.forEach((r) => { patch[r.key] = appended(r); });
    await DB.put('monthlySheet', Object.assign({}, sheet, patch));
    toast('Fetched ' + fetchable.length + ' value' + (fetchable.length === 1 ? '' : 's'));
    renderHomeExpense();
  };

  // A month that has never been opened gets its figures pulled in on the spot,
  // so rolling into a new month doesn't start on a blank sheet nobody
  // remembered to fill. Unlike the button this doesn't ask: it only ever fires
  // when the month has NO stored row at all, so there is nothing it could
  // double, and it can't fire twice because writing the row settles the
  // condition. Past months are left alone — auto-filling one the user
  // deliberately skipped would invent history.
  // Virtual entries carry into a new month for the same reason they exist: a
  // debt is not settled by a calendar turning over. They ride the same one-shot
  // seed as the fetched figures, and are removed by hand from the form once the
  // money actually arrives.
  const prevD = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 2, 1);
  const prevYmSheet = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
  const unseeded = !sheetRow || !!sheetRow.unseeded;
  const prevSheet = (unseeded && ym === thisYm)
    ? await DB.get('monthlySheet', prevYmSheet).catch(() => null) : null;
  if (expRenderStale(token)) return;
  // Only the virtual list carries: an unpaid debt is still unpaid in a new
  // month, whereas last month's repair bill is not this month's.
  const carried = prevSheet ? sheetItemsOf(prevSheet, SHEET_LISTS.virtual) : [];
  // Existing loans recur: last month's unpaid loans carry over.
  let carriedLoans = prevSheet
    ? sheetItemsOf(prevSheet, SHEET_LISTS.loan).filter((it) => !it.paid).map((it) => ({ label: it.label, amount: it.amount, srcId: null, paid: false, paidOn: null, repaid: (it.repaid || []).slice() }))
    : [];
  // Other Expense carries too, now: what was itemised there last month comes across. The automatic "next
  // statement card reimbursement" line is not one of those entries (it is worked out, never stored) - it is
  // what this month's own Next Month Due shows, so it is not duplicated.
  const carriedOther = prevSheet ? sheetItemsOf(prevSheet, SHEET_LISTS.other).map((it) => Object.assign({}, it)) : [];
  if (unseeded && ym === thisYm && (fetchable.length || carried.length || carriedLoans.length || carriedOther.length)) {
    const seed = { ym, updatedAt: new Date().toISOString() };
    // The running-total rows (Parents, Mutual Fund, stocks, Metal) carry last month's total and add this
    // month's allocation on top, in the same "last+this" form the box already shows, so the history stays
    // readable. Rows that follow something live (Next Month Due, EMI / EF, Monthly Expense) carry nothing.
    fetchable.forEach((r) => {
      const prevTotal = prevSheet ? sumExpr(normaliseExpr(prevSheet[r.key])) : 0;
      seed[r.key] = prevTotal > 0 ? exprTerm(prevTotal) + '+' + exprTerm(r.source) : exprTerm(r.source);
    });
    // Rows already added by a For-others spend before the sheet was first opened sit after the carried ones.
    const already = sheetRow ? sheetItemsOf(sheetRow, SHEET_LISTS.virtual) : [];
    if (carried.length || already.length) seed.virtualItems = carried.concat(already);
    if (carriedLoans.length) seed.loanItems = carriedLoans;
    if (carriedOther.length) seed.otherItems = carriedOther;
    await DB.put('monthlySheet', seed);
    if (expRenderStale(token)) return;
    toast(mod.monthLabel(ym) + ' started — '
      + (fetchable.length ? 'figures fetched' : 'sheet opened')
      + (carried.length ? ', ' + carried.length + ' virtual carried over' : '')
      + (carriedOther.length ? ', ' + carriedOther.length + ' other expense carried over' : ''));
    renderHomeExpense();
    return;
  }

  const prevBtn = el('button', { class: 'icon-btn', type: 'button', text: '◀', onclick: () => step(-1) });
  const nextBtn = el('button', { class: 'icon-btn', type: 'button', text: '▶', onclick: () => step(1) });
  // An arrow shows only when there is a month to go to on that side.
  host.appendChild(el('div', { class: 'msheet-head' }, [
    el('div', { class: 'msheet-stepper' }, [monthIx > 0 ? prevBtn : null, monthLabelEl, monthIx < months.length - 1 ? nextBtn : null].filter(Boolean)),
    el('button', { class: 'btn ghost small msheet-fetch', type: 'button', text: '↻ Fetch', onclick: fetchAll }),
  ]));

  // ---- Rows ----
  const table = el('div', { class: 'msheet' });
  let credits = 0;

  // Saving a derived row records WHAT THE SOURCE SAID at the time, in
  // `<key>Src`. That one extra number is what separates the two things a typed
  // figure can mean:
  //
  //   typed 2,500 while the reimbursement was 2,500  -> a copy. Still meant to
  //     follow, so when the reimbursement moves to 3,500 the row moves with it.
  //   typed 9,999 while the reimbursement was 2,500  -> a real override, meant
  //     to stay put whatever the reimbursement does next.
  //
  // Without it there is no way to tell them apart, and every row that was ever
  // touched froze for good - which is exactly the bug this fixes.
  const saveField = async (key, value, srcAtSave) => {
    const patch = { ym, [key]: value, updatedAt: new Date().toISOString() };
    if (srcAtSave !== undefined) patch[key + 'Src'] = value == null ? null : round2(srcAtSave || 0);
    // Field history: what this box held just before, dated to when it
    // changed - last 5, newest first, same shape the vault's own password
    // history uses, so "when did I change what" has one answer across the
    // app rather than a different convention per surface. Compared as
    // NUMBERS (sumExpr), not raw text, so rewriting "7000" as "2000+5000"
    // isn't logged as a change when the two add up the same.
    const prevRaw = sheet[key];
    const prevNum = (prevRaw == null || String(prevRaw).trim() === '') ? null : sumExpr(prevRaw);
    const nextNum = (value == null || String(value).trim() === '') ? null : sumExpr(String(value));
    if (prevNum != null && prevNum !== nextNum) {
      const hist = Array.isArray(sheet[key + 'Hist']) ? sheet[key + 'Hist'] : [];
      // `raw` keeps the actual stored text (e.g. "2000+5000"), not just its
      // sum - Loan through Metal are accumulating boxes, and a history that
      // only ever showed the total would lose exactly the thing those boxes
      // exist to keep (what was added and when). Harmless for the single-
      // figure rows too: their raw IS just the number, so nothing extra shows.
      patch[key + 'Hist'] = [{ value: prevNum, raw: prevRaw == null ? null : String(prevRaw), changedAt: new Date().toISOString() }, ...hist].slice(0, 5);
    }
    await DB.put('monthlySheet', Object.assign({}, sheet, patch));
    renderHomeExpense();
  };
  // Subtle by design - present on every field this sheet can actually save
  // (see saveField above), never calling attention to itself, but always
  // there for "when did I change this." Opens even with nothing recorded yet
  // (shows Current only) rather than only appearing once a history exists.
  // `rawCurrent`, when passed, is the box's own stored text - only the
  // accumulating rows (Loan..Metal) have one; the rest leave it undefined and
  // openSheetFieldHistory shows just the total for them, same as before.
  const historyBtn = (label, key, currentVal, rawCurrent) => el('button', {
    class: 'icon-btn msheet-history', type: 'button',
    title: label + ' history', 'aria-label': label + ' history',
    onclick: (e) => {
      e.stopPropagation();
      openSheetFieldHistory(label, currentVal, rawCurrent, Array.isArray(sheet[key + 'Hist']) ? sheet[key + 'Hist'] : []);
    },
  }, [_historyIcon()]);

  // Is this row still tracking its source, or has it been deliberately set?
  // Nothing stored at all follows. A stored figure follows only while it still
  // matches what the source read when it was saved.
  //
  // A row saved before `<key>Src` existed has no record of that, so it counts
  // as an override and keeps the figure it has - the safe reading, since the
  // alternative silently rewrites a number the user may have meant. Clearing
  // the box resumes following.
  const followsSource = (key, storedRaw) => {
    if (storedRaw == null || String(storedRaw).trim() === '') return true;
    const src = sheet[key + 'Src'];
    if (src == null || String(src).trim() === '') return false;
    return Math.abs(sumExpr(storedRaw) - (Number(src) || 0)) < 0.005;
  };

  // Green rows carry no second box: the headline figure IS the field. They hold
  // one plain number (no "+" accumulation — nothing fetches into them), so a
  // separate box under a read-only total would just be the same number twice.
  // `fallback` is what shows when nothing has been entered for this month — In
  // Hand starts from the Allocation salary but is overridable, since actual
  // take-home moves around (a bonus, a deduction) while the plan stays put.
  // `deduct` is money that has already gone OUT of this figure rather than a
  // commitment against it - a card bill settled has left the account, so what
  // is in hand is simply less. Taken off the row's own value rather than folded
  // into `fallback`, so it still applies when the user has typed their actual
  // take-home over the planned one.
  const creditInputRow = (label, key, note, fallback, hasSource, deduct) => {
    const follows = followsSource(key, sheet[key]);
    const off = round2(deduct || 0);
    // `base` is what came IN; `amount` is what is left of it after money that
    // has already gone back out. One box, showing and editing the figure that
    // matters - what is actually in hand - because a second box under a
    // read-only total would just be the same money written twice.
    const base = follows ? round2(fallback || 0) : sumExpr(sheet[key]);
    const amount = round2(base - off);
    credits += amount;
    const inp = el('input', {
      class: 'msheet-val-input',
      type: 'number', inputmode: 'decimal', step: 'any',
      value: amount, placeholder: fmtSheetCur(round2((fallback || 0) - off)),
      'aria-label': label,
    });
    inp.addEventListener('blur', () => {
      const raw = inp.value.trim();
      // Typed as what is LEFT, stored as what came in, so a bill settled after
      // this was typed still takes its own bite - and unticking one gives it
      // back. Cleared to empty means "use the planned figure again", not zero.
      const v = raw === '' ? null : round2((num(raw) || 0) + off);
      if (v !== base || raw === '') saveField(key, v, fallback);
    });
    const state = !hasSource ? document.createTextNode('')
      : follows
        ? el('span', { class: 'msheet-follow', text: 'auto' })
        : el('button', {
            class: 'msheet-follow is-override', type: 'button',
            title: 'Set by you — tap to follow ' + fmtSheetCur(fallback || 0) + ' again',
            text: 'set ↻',
            onclick: (e) => { e.stopPropagation(); saveField(key, null, fallback); },
          });
    table.appendChild(el('div', { class: 'msheet-row msheet-credit' }, [
      el('div', { class: 'msheet-label' }, [
        el('span', {}, [label, state, historyBtn(label, key, amount)]),
        // The deduction is named in the caption rather than shown as a second
        // figure, so the row still explains itself with one number on it.
        el('span', { class: 'msheet-note', text: off > 0 ? note + ' − ' + fmtSheetCur(off) : note }),
      ]),
      inp,
    ]));
  };

  // In Hand follows the Allocation salary.
  // Card bills ticked off on the Credit Card tab come straight off here: the
  // bank has taken the money, so it is not in hand any more. Read off the cards
  // rather than stored again, so unticking a bill gives it straight back.
  creditInputRow('In Hand', 'inHand',
    planNote + ' · ' + fmtSheetCur(perMonth('salary'))
      + (cardPaid > 0 ? ' · card paid' : ''),
    perMonth('salary'), true, cardPaid);
  const again = () => renderHomeExpense();
  const vRow = sheetListRow(ym, sheet, SHEET_LISTS.virtual, mod.monthLabel(ym), 'msheet-credit', again);
  credits += vRow.total;
  table.appendChild(vRow.node);

  debitRows.forEach((r) => {
    if (r.list) {
      table.appendChild(sheetListRow(ym, sheet, SHEET_LISTS.loan, mod.monthLabel(ym), 'msheet-debit', again).node);
      return;
    }
    const expr = exprOf(r);
    const boxVal = boxOf(r);
    // `single` rows edit their headline figure directly — same shape as the
    // green rows, since with nothing fetching into them a box under a
    // read-only total would just be the number twice.
    if (r.single) {
      const follows = followsSource(r.key, sheet[r.key]);
      // The figure is always IN the box, never only a placeholder. A row
      // carrying a live 3,500 used to render as an empty field with a grey
      // hint, which reads as "nothing here" rather than "this is the number".
      const inp = el('input', {
        class: 'msheet-val-input',
        type: 'number', inputmode: 'decimal', step: 'any',
        value: boxVal, placeholder: fmtSheetCur(r.fallback || 0),
        'aria-label': r.label,
      });
      inp.addEventListener('blur', () => {
        const raw = inp.value.trim();
        // Cleared means "follow the source again", not zero.
        const v = raw === '' ? null : round2(num(raw) || 0);
        if (v !== boxVal || raw === '') saveField(r.key, v, r.fallback);
      });
      // Which state the row is in, and a one-tap way out of an override. Only
      // shown where there is a source to follow: Loan and Other Expense are
      // typed figures with nothing behind them.
      const state = r.fallback == null ? document.createTextNode('')
        : follows
          ? el('span', { class: 'msheet-follow', text: 'auto' })
          : el('button', {
              class: 'msheet-follow is-override', type: 'button',
              title: 'Set by you — tap to follow ' + fmtSheetCur(r.fallback || 0) + ' again',
              text: 'set ↻',
              onclick: (e) => { e.stopPropagation(); saveField(r.key, null, r.fallback); },
            });
      table.appendChild(el('div', { class: 'msheet-row msheet-debit' }, [
        el('div', { class: 'msheet-label' }, [
          el('span', {}, [r.label, state, historyBtn(r.label, r.key, boxVal)]),
          el('span', { class: 'msheet-note', text: r.note }),
        ]),
        inp,
      ]));
      return;
    }
    // type=text, not number: a number input rejects "2000+5000" outright and
    // reports an empty value for it. inputmode=text keeps a usable keyboard on
    // mobile (the decimal pad has no "+" key).
    const inp = el('input', {
      type: 'text', inputmode: 'text', autocomplete: 'off', spellcheck: 'false',
      value: expr, placeholder: '0', 'aria-label': r.label + ' running total',
    });
    // The headline follows the box as it's typed, so the sum of an expression
    // is visible before committing it.
    const liveTotal = el('span', { class: 'msheet-val', text: fmtSheetCur(boxVal) });
    inp.addEventListener('input', () => { liveTotal.textContent = fmtSheetCur(sumExpr(inp.value)); });
    inp.addEventListener('blur', () => {
      const cleaned = normaliseExpr(inp.value.trim());
      if (cleaned !== expr) saveField(r.key, cleaned);
    });
    // The note carries the source AMOUNT, not just where it came from: the
    // headline is now the box, so without this the figure Available Balance
    // actually subtracts wouldn't appear anywhere on screen.
    const noteTxt = r.source != null ? r.note + ' · ' + fmtSheetCur(r.source) : r.note;
    table.appendChild(el('div', { class: 'msheet-row msheet-debit' }, [
      el('div', { class: 'msheet-label' }, [
        el('span', {}, [r.label, historyBtn(r.label, r.key, boxVal, expr)]),
        el('span', { class: 'msheet-note', text: noteTxt }),
      ]),
      el('div', { class: 'msheet-stack' }, [
        liveTotal,
        el('div', { class: 'msheet-input' }, [inp]),
      ]),
    ]));
  });

  // Last red row, where it always was - but a list now, for the same reason
  // Virtual Bal is one: "2000+5000" recorded the amounts and nothing about
  // what they were, so the month could not be explained afterwards.
  // Always last in Other Expense, under a divider: what the card spends already logged will cost on NEXT month's
  // statement, by each card's own cycle (the same figure next month's Next Month Due will show). Live, not
  // stored - it follows every spend added, edited or removed - and nothing when no card spend reaches it yet.
  const nextD = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 1);
  const nextYm = nextD.getFullYear() + '-' + String(nextD.getMonth() + 1).padStart(2, '0');
  const nextReimb = round2((reimb && reimb.map && reimb.map[nextYm]) || 0);
  const nextBits = (reimb && reimb.detail && reimb.detail.get(nextYm)) || null;
  const autoNext = nextReimb > 0 ? {
    label: 'Next statement card reimbursement',
    short: mod.monthLabel(nextYm) + ' card bill',
    amount: nextReimb,
    note: mod.monthLabel(nextYm) + ' statement, by each card’s cycle'
      + (nextBits && nextBits.auto && nextBits.others > 0 ? ' · house ' + fmtSheetCur(nextBits.house) + ' + others ' + fmtSheetCur(nextBits.others) : ''),
  } : null;
  const oRow = sheetListRow(ym, sheet, SHEET_LISTS.other, mod.monthLabel(ym), 'msheet-debit', again, autoNext);
  table.appendChild(oRow.node);

  host.appendChild(table);

  // ---- Closing balance ----
  // (In Hand + Virtual Bal) − every committed row, taken from the BOXES. The
  // boxes are what actually happened this month; the source figures are only
  // the starting suggestion Fetch pulls in, so the balance follows what's
  // recorded rather than what was planned.
  const debits = round2(debitRows.reduce((s, r) => s + boxOf(r), 0) + oRow.total);
  // Existing loans are easy to overlook, so they are taken off separately: Available Balance is what is left
  // before them, Actual Balance is what is really left once they are paid. With no loans the two are the same
  // and only one line is shown.
  const loanOwed = loansOwed(sheetItemsOf(sheet, SHEET_LISTS.loan));
  const actual = round2(credits - debits);
  const available = round2(actual + loanOwed);
  if (loanOwed > 0) {
    host.appendChild(el('div', { class: 'msheet-total' + (available < 0 ? ' is-neg' : '') }, [
      el('span', { class: 'msheet-total-label', text: 'Available Balance' }),
      el('span', { class: 'msheet-total-val', text: fmtSheetCur(available) }),
    ]));
    host.appendChild(el('div', { class: 'msheet-loan-line' }, [
      el('span', { text: '\u2212 Existing loans' }),
      el('span', { text: fmtSheetCur(loanOwed) }),
    ]));
    host.appendChild(el('div', { class: 'msheet-total msheet-actual' + (actual < 0 ? ' is-neg' : '') }, [
      el('span', { class: 'msheet-total-label', text: 'Actual Balance' }),
      el('span', { class: 'msheet-total-val', text: fmtSheetCur(actual) }),
    ]));
    host.appendChild(el('p', { class: 'hint msheet-loan-note', text: 'Loans stay out of sight, but this is your real balance. Pay them first and close them.' }));
  } else {
    host.appendChild(el('div', { class: 'msheet-total' + (actual < 0 ? ' is-neg' : '') }, [
      el('span', { class: 'msheet-total-label', text: 'Available Balance' }),
      el('span', { class: 'msheet-total-val', text: fmtSheetCur(actual) }),
    ]));
  }

  host.appendChild(explainRow('About this sheet', [
    'This sheet shows what is left of the month once everything is paid.',
    'Available Balance = In Hand + Virtual Balance \u2212 the red rows. Actual Balance also takes off your existing loans, so it is the real figure.',
    'In Hand: the money you actually have this month. It starts from your yearly plan salary. Type over it if this month was different.',
    'Virtual Balance: money you expect to receive but that has not reached your hand yet, for example an amount someone owes you. It counts like cash here until it arrives; then move it to In Hand.',
    'Other Expense: money you have to give others that fits none of the listed rows, like a repair, a gift or a fee.',
    'Red rows: what goes out this month. \u21BB Fetch fills them from your plan, and a box adds up what you type, like 2000+5000.',
  ], 'How the sheet adds up'));
}

// The accumulating boxes (Loan through Metal) store an additive EXPRESSION,
// not a single number - "2000+5000" - and sumExpr (their own totalling
// function) parses it by pulling out every signed number, not by splitting
// on "+". Mirrored here rather than a naive split so a breakdown can never
// disagree with the total shown next to it. Returns null for a plain single
// figure (nothing to break down) or fewer than 2 terms.
function _sheetExprBreakdown(raw) {
  if (raw == null) return null;
  const parts = String(raw).match(/-?\d+(?:\.\d+)?/g);
  if (!parts || parts.length < 2) return null;
  return parts.map((p, i) => {
    const n = Number(p);
    return (n < 0 ? '− ' : (i === 0 ? '' : '+ ')) + fmtSheetCur(Math.abs(n));
  }).join('  ');
}

// A per-field timeline for the Balance sheet - same shape as the vault's own
// password history (openVaultPasswordHistory): "Current" first with its own
// dot/badge, then up to the last 5 superseded values below it, newest first.
// Reached from the subtle history icon `historyBtn` puts on every field
// renderExpenseSheet can actually save - see saveField there for where the
// history itself is recorded. Not password data, so no masking here: the
// value is shown plainly, with a copy button for pulling a past figure back
// into a note or a calculation elsewhere.
//
// `rawCurrent` - only ever set for the accumulating rows (Loan..Metal, see
// historyBtn's call site) - adds a second, smaller line under the total
// showing the actual terms that made it up ("2,000 + 5,000"), same as each
// history entry's own `raw`. The single-figure rows never pass one, so they
// show only the total, exactly as before this existed.
function openSheetFieldHistory(label, current, rawCurrent, hist) {
  // The breakdown ("2,000 + 5,000") sits on its OWN line under the value row,
  // never inside it - the value row is a flex line ending in the copy
  // button, and a variable-length expression squeezed in there would push
  // that button around instead of just wrapping cleanly underneath.
  const contentOf = (val, raw, whenNode) => {
    const breakdown = _sheetExprBreakdown(raw);
    return el('div', { class: 'vh-content' }, [
      whenNode,
      el('div', { class: 'vh-pw-row' }, [
        el('span', { class: 'vd-value vh-pw-val', text: fmtSheetCur(val) }),
        _vaultCopyBtn(label, () => String(val)),
      ]),
      breakdown ? el('div', { class: 'vh-expr', text: breakdown }) : null,
    ].filter(Boolean));
  };
  const items = [
    el('div', { class: 'vh-item vh-current' }, [
      el('div', { class: 'vh-dot' }),
      contentOf(current, rawCurrent, el('div', { class: 'vh-when' }, [el('span', { class: 'vh-current-badge', text: 'Current' })])),
    ]),
    ...hist.map((h) => el('div', { class: 'vh-item' }, [
      el('div', { class: 'vh-dot' }),
      contentOf(h.value, h.raw, el('div', { class: 'vh-when', text: h.changedAt ? new Date(h.changedAt).toLocaleString() : 'Unknown date' })),
    ])),
  ];
  openModal(el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('div', { class: 'vd-head' }, [
        el('div', { class: 'vd-head-text' }, [
          el('h2', { class: 'vd-title', text: label }),
          el('div', { class: 'vd-cat', text: 'Change history' }),
        ]),
      ]),
      el('div', { class: 'vh-timeline' }, items),
      el('p', { class: 'hint', text: hist.length
        ? 'Only the last 5 changes are kept for this box.'
        : 'No changes recorded yet for this box.' }),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ])]),
  ]));
}
