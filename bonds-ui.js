import { DB } from './db.js';
import { fmtCur, fmtIntRate, num, todayISO } from './core.js';
import { setAppMode, $, updateBondNavActive, el, _bondTab, fmtIntCur, _mfCell, explainRow, _mfValueCard, b, refresh, field, appConfirm, closeModal, toast, moreOptions, openModal } from './app.js';

// ---------- Bonds surface ----------
let _bondFilter = 'active';  // 'active' | 'matured' (matured + sold) | 'all'
let _bondSort = 'maturity';  // 'maturity' | 'amount' | 'rate'
// Lazy-loaded: bonds.js only loads when the user opens Bonds. No seed data.
export async function openBond() {
  setAppMode('bond');
}

export async function renderBond() {
  const host = $('#bondView');
  host.innerHTML = '';
  updateBondNavActive();
  const mod = await import('./bonds.js');
  const all = (await DB.byIndex('bonds', 'owner', 'me')) || [];
  const now = Date.now();
  const rows = all.map((b2) => ({ b: b2, c: mod.computeBond(b2, now) }));

  if (!rows.length) {
    host.appendChild(el('section', { class: 'summary' }, [
      el('div', { class: 'label', text: 'Active invested' }),
      el('div', { class: 'big', text: fmtCur(0, 'INR') }),
    ]));
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🧾' }),
      el('p', { text: 'No bonds yet.' }),
      el('p', { class: 'hint', text: 'Tap + to add your first bond — name, rating, amount, rate, start & maturity dates.' }),
    ]));
    return;
  }

  const activeRows = rows.filter(({ c }) => c.effectiveStatus === 'active');
  // "Matured" in the UI covers both closed statuses - a bond stops being live
  // capital whether it aged to maturity or was sold early. Always partition on
  // effectiveStatus, never pastMaturity (see bonds.js computeBond) - a bond sold
  // after its own maturity date is pastMaturity===true but effectiveStatus
  // 'sold', so filtering on pastMaturity here would double-count it into both.
  const maturedRows = rows.filter(({ c }) => c.effectiveStatus === 'matured');
  const soldRows = rows.filter(({ c }) => c.effectiveStatus === 'sold');
  const closedRows = maturedRows.concat(soldRows);
  let list = _bondFilter === 'active' ? activeRows.slice() : _bondFilter === 'matured' ? closedRows.slice() : rows.slice();

  // Totals over active bonds (still-live capital) - mirrors FD's "locked capital,
  // tracked in this surface's own totals" rationale.
  let totInv = 0, totInterest = 0, totVsBank = 0, vsBankCount = 0, receivedToDate = 0;
  // Live capital = what's still outstanding. Same as principal for a bond whose
  // principal returns in one lump; genuinely smaller once it amortizes.
  // Emergency-Fund-linked bonds are excluded from every total on this page (they
  // stay in the list, badged) because that surface owns them now — the same
  // split SGBs have between the stocks store and the Metals surface.
  activeRows.forEach(({ b: b2, c }) => { if (b2.emergencyFund) return; totInv += c.outstandingPrincipal; totInterest += c.totalInterest; });
  const returnPct = totInv > 0 ? (totInterest / totInv) * 100 : 0;
  // Interest earned from closed (matured + sold) bonds - real (logged payouts,
  // or realised sale proceeds) once either exists, else the coupon-rate
  // projection for a matured bond with no payouts logged. Received-to-date sums
  // actual COUPON payouts logged across every bond - sale proceeds are a
  // separate, larger figure shown on the sold card itself, not folded in here.
  let interestEarnedTotal = 0;
  closedRows.forEach(({ b: b2, c }) => { if (b2.emergencyFund) return; interestEarnedTotal += c.interestEarned; });
  rows.forEach(({ b: b2, c }) => {
    if (b2.emergencyFund) return;
    if (c.vsBank != null) { totVsBank += c.vsBank; vsBankCount++; }
    receivedToDate += c.payoutsTotal;
  });

  const holdContent = el('div', { class: 'tab-content' + (_bondTab === 'holdings' ? '' : ' hidden') });
  const ovrvContent = el('div', { class: 'tab-content' + (_bondTab === 'overview' ? '' : ' hidden') });

  const summarySec = el('section', { class: 'summary' }, [
    el('div', { class: 'row-between summary-top' }, [
      el('div', {}, [
        el('div', { class: 'label', text: 'Active invested' }),
        el('div', { class: 'big', text: fmtCur(totInv, 'INR') }),
      ]),
      el('div', { class: 'summary-earned' }, [
        el('div', { class: 'label', text: 'Interest to earn (full tenure)' }),
        el('div', { class: 'v pos', text: fmtIntCur(totInterest) }),
      ]),
    ]),
    el('div', { class: 'grid' }, [
      // Sign-safe: a bond sold at a loss can make this negative for the first
      // time (previously bond interest was always >= 0).
      _mfCell('Interest earned (realised)', (interestEarnedTotal >= 0 ? '+' : '') + fmtIntCur(interestEarnedTotal), interestEarnedTotal >= 0 ? 'pos' : 'neg'),
      _mfCell('Coupons received', fmtIntCur(receivedToDate), 'pos'),
      _mfCell('Return %', returnPct ? fmtIntRate(returnPct) : '—'),
      _mfCell('vs Bank', vsBankCount ? (totVsBank >= 0 ? '+' : '') + fmtIntCur(totVsBank) : '—', totVsBank >= 0 ? 'pos' : 'neg'),
    ]),
  ]);

  // ---- Holdings tab: filter + sort + card list ----
  const filterSeg = el('div', { class: 'seg' }, [
    ['active', `Active (${activeRows.length})`],
    ['matured', `Matured / Sold (${closedRows.length})`],
    ['all', `All (${rows.length})`],
  ].map(([v, l]) => el('button', { class: (_bondFilter === v ? 'active' : ''), type: 'button', text: l, onclick: () => { _bondFilter = v; renderBond(); } })));
  const sortbar = el('div', { class: 'sortbar mf-sortbar' }, [['maturity', 'Maturity'], ['amount', 'Amount'], ['rate', 'Rate']].map(([v, l]) =>
    el('button', { class: 'sort-btn' + (_bondSort === v ? ' active' : ''), type: 'button', text: l, onclick: () => { _bondSort = v; renderBond(); } })));
  holdContent.appendChild(el('div', { class: 'toolbar mf-toolbar-top' }, [filterSeg, sortbar]));

  if (!list.length) {
    holdContent.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '🧾' }), el('p', { text: 'Nothing here.' })]));
  } else {
    // For a sold bond, the date that actually happened is soldDate, not its
    // (possibly still-future) maturity date - sort by whichever applies so a
    // 2026 sale doesn't sort after a 2027 maturity in the closed list.
    const exitOf = (c) => c.soldDate || c.maturity;
    list.sort((a, b2) => {
      if (_bondSort === 'amount') return b2.c.principal - a.c.principal;
      if (_bondSort === 'rate') return b2.c.rate - a.c.rate;
      const am = exitOf(a.c) ? Date.parse(exitOf(a.c)) : Infinity;
      const bm = exitOf(b2.c) ? Date.parse(exitOf(b2.c)) : Infinity;
      return am - bm;
    });
    const wrap = el('section', { class: 'stock-list' });
    list.forEach(({ b: b2, c }) => wrap.appendChild(_bondCard(b2, c)));
    holdContent.appendChild(wrap);
  }
  holdContent.appendChild(explainRow('About these bonds', 'Log each interest/coupon payment you actually receive on a bond\'s Payouts tab — once logged, it replaces the projected estimate as the real interest-earned figure. Not financial advice.', 'How payouts are counted'));

  // ---- Overview tab: allocation by rating + next maturity ----
  const byRating = {};
  activeRows.forEach(({ b: b2, c }) => { const k = b2.rating || 'Unrated'; byRating[k] = (byRating[k] || 0) + c.principal; });
  const ratings = Object.keys(byRating).sort((a, b2) => byRating[b2] - byRating[a]);
  if (ratings.length && totInv > 0) {
    const alloc = el('div', { class: 'chart-card' }, [el('h3', { text: 'Allocation by rating' })]);
    ratings.forEach((rk) => {
      const pct = (byRating[rk] / totInv) * 100;
      alloc.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: rk }),
        el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: `width:${Math.max(2, pct).toFixed(1)}%` })]),
        el('span', { class: 'bn', text: pct.toFixed(2) + '%' }),
      ]));
    });
    ovrvContent.appendChild(alloc);
  }
  const upcoming = activeRows.filter(({ c }) => c.daysToMaturity != null).sort((a, b2) => a.c.daysToMaturity - b2.c.daysToMaturity)[0];
  if (upcoming) {
    ovrvContent.appendChild(el('div', { class: 'chart-card' }, [
      el('h3', { text: 'Next maturity' }),
      el('div', { class: 'mf-goal-meta', text: `${upcoming.b.name || 'Bond'} — ${fmtCur(upcoming.c.maturityValue, 'INR')} on ${upcoming.c.maturity} (${upcoming.c.daysToMaturity} days)` }),
    ]));
  }
  if (!activeRows.length) {
    ovrvContent.appendChild(el('p', { class: 'hint', text: 'No active bonds to allocate or project.' }));
  }

  host.appendChild(summarySec);
  host.appendChild(holdContent);
  host.appendChild(ovrvContent);
}

function _bondCard(b2, c) {
  const statusBadge = c.effectiveStatus === 'active'
    ? el('span', { class: 'badge good mf-beat', text: 'active' })
    : c.effectiveStatus === 'sold'
      ? el('span', { class: 'badge warn mf-beat', text: 'sold' })
      : el('span', { class: 'badge muted mf-beat', text: 'matured' });
  const freqShort = { monthly: 'mthly', quarterly: 'qtrly', halfyearly: 'half-yrly', yearly: 'yrly', staggered: 'staggered', maturity: 'at maturity' };
  const catLine = el('div', { class: 'cat mf-catline' }, [`${b2.rating || 'Unrated'} · ${fmtIntRate(c.rate)}`
    + (c.payout === 'cumulative' ? ' · cumulative' : ' · payout')
    + (c.interestFreq && c.interestFreq !== 'maturity' ? ' ' + freqShort[c.interestFreq] : '')
    + (c.amortizes ? ' · principal ' + (freqShort[c.principalFreq] || c.principalFreq) : '')]);
  catLine.appendChild(statusBadge);
  // Still listed here, but its money is counted on the Emergency Fund page.
  if (b2.emergencyFund) catLine.appendChild(el('span', { class: 'badge ef-badge mf-beat', text: 'EF' }));
  // Three independent branches (not one three-way ternary) so each is easy to
  // audit on its own - a fall-through bug here previously meant "sold" landed
  // in the wrong branch of matTxt OR rightCol without the other noticing.
  const matTxt = c.effectiveStatus === 'sold'
    ? `Sold ${c.soldDate}`
    : c.maturity
      ? (c.effectiveStatus === 'active'
          ? (c.daysToMaturity >= 0 ? `Matures ${c.maturity} · ${c.daysToMaturity}d` : `Due ${c.maturity}`)
          : `Matured ${c.maturity}`)
      : 'No maturity date';
  // Sold: the realised figure (payouts before exit + sale gain/loss) - can be
  // negative, so sign-safe rather than the hardcoded '+' the other branches use
  // (bond interest could never be negative before sold bonds existed).
  // Matured: show both the projected total interest AND the real earned figure
  // (real once any payout is logged, else the same projection - see computeBond).
  // Active: one projected/accrued figure, clearly marked as an estimate.
  const rightCol = c.effectiveStatus === 'sold'
    ? [
        el('div', { class: 'pct ' + (c.interestEarned >= 0 ? 'pos' : 'neg'), text: (c.interestEarned >= 0 ? '+' : '') + fmtIntCur(c.interestEarned) }),
        el('div', { class: 'meta-line', text: 'realised' }),
      ]
    : c.effectiveStatus === 'matured'
      ? [
          el('div', { class: 'pct pos', text: '+' + fmtIntCur(c.totalInterest) }),
          el('div', { class: 'meta-line', text: 'interest' }),
          el('div', { class: 'meta-line pos', text: '+' + fmtIntCur(c.interestEarned) + ' earned' }),
        ]
      : [
          el('div', { class: 'pct pos', text: '+' + fmtIntCur(c.projectedAccrued) }),
          el('div', { class: 'meta-line', text: 'accrued (est.)' }),
        ];
  // Sold: "Received" against actual proceeds, not the maturity-value
  // counterfactual - a bond exited early never reaches c.maturityValue.
  const valueLine = c.effectiveStatus === 'sold'
    ? el('span', { class: 'value-emphasis' }, [
        'Received ',
        c.soldAmount != null
          ? _mfValueCard(c.soldAmount, c.principal, false, fmtIntCur)
          : el('span', { class: 'meta-line warn', text: 'amount not entered' }),
      ])
    : el('span', { class: 'value-emphasis' }, ['Maturity ', _mfValueCard(c.maturityValue, c.principal, false, fmtIntCur)]);
  return el('div', { class: 'card', onclick: () => openBondForm(b2) }, [
    el('div', { class: 'top' }, [
      el('div', { class: 'card-left' }, [
        el('div', { class: 'name', text: b2.name || 'Bond' }),
        catLine,
      ]),
      el('div', { class: 'card-right' }, rightCol),
    ]),
    el('div', { class: 'sub mf-sub2' }, [
      el('span', {}, [
        // An amortizing bond's original principal no longer describes what's at
        // work, so show what's left outstanding alongside it while it's live.
        el('div', {}, ['Invested ', b(fmtIntCur(c.principal))]),
        el('div', { class: 'mf-meta-mini', text: matTxt }),
      ]),
      valueLine,
    ]),
    c.amortizes && c.effectiveStatus === 'active'
      ? el('div', { class: 'meta-line' }, [
          'Outstanding ', b(fmtIntCur(c.outstandingPrincipal)),
          ' · ', fmtIntCur(c.principalReturned), ' returned',
          c.nextDue ? ' · next ' + c.nextDue.date : '',
        ])
      : document.createTextNode(''),
    c.amortizes && c.perInstallmentPrincipal != null
      ? el('div', { class: 'mf-meta-mini', text: `${fmtIntCur(c.perInstallmentPrincipal)} principal × ${c.installments} installments` })
      : document.createTextNode(''),
    el('div', { class: 'mf-meta-mini', text: 'Basis: ' + c.basis }),
    c.hasPayouts ? el('div', { class: 'meta-line pos', text:
      `${fmtIntCur(c.payoutsTotal)} interest received` +
      (c.principalPayoutsTotal ? ` · ${fmtIntCur(c.principalPayoutsTotal)} principal received` : '') +
      ` · ${(b2.payouts || []).length} payout${(b2.payouts || []).length === 1 ? '' : 's'}` }) : document.createTextNode(''),
    c.effectiveStatus === 'sold' && c.payoutsAfterExit ? el('div', { class: 'meta-line warn', text: `${fmtIntCur(c.payoutsAfterExit)} of that is dated on/after the sale - counted as part of proceeds, not extra interest` }) : document.createTextNode(''),
    c.vsBank != null ? el('div', { class: 'meta-line ' + (c.vsBank >= 0 ? 'pos' : 'neg'), text: `${c.vsBank >= 0 ? '+' : ''}${fmtIntCur(c.vsBank)} vs bank` }) : document.createTextNode(''),
  ]);
}

// Simple dated ledger editor for a bond's Payouts tab - one row per interest
// and/or principal payment actually received (date + ₹ interest + optional ₹
// principal). The principal leg only matters once a bond amortizes, but the row
// stays a single shape regardless - a repayment that's principal-only (no coupon
// that period) is just a row with the interest field left blank. Mirrors
// buildContribEditor's add/remove/summary shape (MF's Buy/Sell log).
function buildPayoutEditor(payouts, addMonthsFn, onChange) {
  const rowsWrap = el('div', { class: 'hist-rows mf-txn-rows' });
  const summary = el('div', { class: 'mf-txn-summary' });
  const emptyEl = el('div', { class: 'mf-txn-empty', text: 'No payouts logged yet.' });
  const refs = [];

  const refreshSummary = () => {
    const rows = refs.filter((r) => !r.removed);
    const has = rows.length > 0;
    rowsWrap.classList.toggle('hidden', !has);
    summary.classList.toggle('hidden', !has);
    emptyEl.classList.toggle('hidden', has);
    if (has) {
      const iTotal = rows.reduce((s, r) => s + (num(r.amt.value) || 0), 0);
      const pTotal = rows.reduce((s, r) => s + (num(r.pri.value) || 0), 0);
      summary.innerHTML = '';
      summary.appendChild(el('span', { text: rows.length + (rows.length === 1 ? ' payout' : ' payouts') }));
      summary.appendChild(el('span', { text: 'Interest ' + fmtCur(iTotal, 'INR') }));
      // Principal only shown once it's actually in use - most bonds never touch
      // this leg, and a permanent "Principal ₹0" reads as a claim about the bond.
      if (pTotal > 0) summary.appendChild(el('span', { text: 'Principal ' + fmtCur(pTotal, 'INR') }));
    }
    // Deferred (same reasoning as buildContribEditor): this can fire while the
    // caller's own `refresh` const is still being declared - a macrotask tick
    // guarantees the caller's synchronous setup has finished first.
    if (typeof onChange === 'function') setTimeout(onChange, 0);
  };

  const addRow = (date, amount, principal) => {
    const d = el('input', { class: 'txn-date', type: 'date', value: date || todayISO() });
    const amt = el('input', { class: 'txn-amt', type: 'number', inputmode: 'decimal', step: 'any', value: amount != null ? amount : '', placeholder: 'Interest received ₹' });
    const pri = el('input', { class: 'txn-amt', type: 'number', inputmode: 'decimal', step: 'any', value: principal != null && principal !== 0 ? principal : '', placeholder: 'Principal received ₹ (optional)' });
    const del = el('button', { class: 'icon-btn', type: 'button', text: '×' });
    const ref = { d, amt, pri, removed: false };
    amt.addEventListener('blur', refreshSummary);
    pri.addEventListener('blur', refreshSummary);
    d.addEventListener('change', refreshSummary);
    const row = el('div', { class: 'mf-txn-row' }, [el('div', { class: 'txn-line' }, [d, amt, pri, del])]);
    del.addEventListener('click', () => { row.remove(); ref.removed = true; refreshSummary(); });
    refs.push(ref);
    rowsWrap.appendChild(row);
    refreshSummary();
  };
  (payouts || []).slice().sort((a, b2) => (b2.date || '').localeCompare(a.date || '')).forEach((p) => addRow(p.date, p.amount, p.principal));
  refreshSummary();

  const lastDate = () => refs.reduce((max, r) => (!r.removed && r.d.value && r.d.value > (max || '')) ? r.d.value : max, null);
  const addBtn = el('button', {
    class: 'icon-btn', type: 'button', text: '+', title: 'Add payout',
    // Default the new row's date to one month after the latest one logged (most
    // adds are "log this month's payout"), not today.
    onclick: () => addRow(addMonthsFn(lastDate() || todayISO(), lastDate() ? 1 : 0), null, null),
  });

  const node = el('div', {}, [summary, emptyEl, rowsWrap, el('div', { class: 'mf-txn-btn-row' }, [addBtn])]);
  const collect = () => {
    const out = [];
    for (const r of refs) {
      if (r.removed) continue;
      const dv = r.d.value, av = num(r.amt.value), pv = num(r.pri.value);
      // A row needs a date and at least one non-zero leg - a repayment date can
      // legitimately carry only principal, or only interest.
      if (!dv || (!(av > 0) && !(pv > 0))) continue;
      out.push({ date: dv, amount: Math.round((av || 0) * 100) / 100, principal: Math.round((pv || 0) * 100) / 100 });
    }
    return out.sort((a, b2) => (a.date || '').localeCompare(b2.date || ''));
  };
  return { node, collect };
}

// Custom installment editor for a bond's "staggered" schedule - one row per
// expected installment from the term sheet (date + ₹ principal + ₹ interest).
// Same add/remove/summary shape as buildPayoutEditor, with a third field: a row
// may carry principal only, interest only, or both, which is what lets a single
// editor describe a term sheet that staggers the two on different dates.
// Distinct from the Payouts ledger on purpose - this is the PLAN (what the issuer
// promised), payouts are the ACTUALS (what landed).
function buildBondScheduleEditor(schedule, addMonthsFn, onChange) {
  const rowsWrap = el('div', { class: 'hist-rows mf-txn-rows' });
  const summary = el('div', { class: 'mf-txn-summary' });
  const emptyEl = el('div', { class: 'mf-txn-empty', text: 'No installments added yet.' });
  const refs = [];

  const refreshSummary = () => {
    const rows = refs.filter((r) => !r.removed);
    const has = rows.length > 0;
    rowsWrap.classList.toggle('hidden', !has);
    summary.classList.toggle('hidden', !has);
    emptyEl.classList.toggle('hidden', has);
    if (has) {
      const pTot = rows.reduce((s, r) => s + (num(r.pri.value) || 0), 0);
      const iTot = rows.reduce((s, r) => s + (num(r.int.value) || 0), 0);
      summary.innerHTML = '';
      summary.appendChild(el('span', { text: rows.length + (rows.length === 1 ? ' installment' : ' installments') }));
      summary.appendChild(el('span', { text: 'Principal ' + fmtCur(pTot, 'INR') }));
      summary.appendChild(el('span', { text: 'Interest ' + fmtCur(iTot, 'INR') }));
    }
    // Deferred for the same reason as buildPayoutEditor: this can fire while the
    // caller's own `refresh` const is still being declared.
    if (typeof onChange === 'function') setTimeout(onChange, 0);
  };

  const addRow = (date, principal, interest) => {
    const d = el('input', { class: 'txn-date', type: 'date', value: date || todayISO() });
    const pri = el('input', { class: 'txn-amt', type: 'number', inputmode: 'decimal', step: 'any', value: principal != null ? principal : '', placeholder: 'Principal ₹' });
    const int = el('input', { class: 'txn-amt', type: 'number', inputmode: 'decimal', step: 'any', value: interest != null ? interest : '', placeholder: 'Interest ₹' });
    const del = el('button', { class: 'icon-btn', type: 'button', text: '×' });
    const ref = { d, pri, int, removed: false };
    pri.addEventListener('blur', refreshSummary);
    int.addEventListener('blur', refreshSummary);
    d.addEventListener('change', refreshSummary);
    const row = el('div', { class: 'mf-txn-row' }, [el('div', { class: 'txn-line' }, [d, pri, int, del])]);
    del.addEventListener('click', () => { row.remove(); ref.removed = true; refreshSummary(); });
    refs.push(ref);
    rowsWrap.appendChild(row);
    refreshSummary();
  };
  (schedule || []).slice().sort((a, b2) => (a.date || '').localeCompare(b2.date || '')).forEach((r) => addRow(r.date, r.principal, r.interest));
  refreshSummary();

  const lastDate = () => refs.reduce((max, r) => (!r.removed && r.d.value && r.d.value > (max || '')) ? r.d.value : max, null);
  const addBtn = el('button', {
    class: 'icon-btn', type: 'button', text: '+', title: 'Add installment',
    onclick: () => addRow(addMonthsFn(lastDate() || todayISO(), lastDate() ? 3 : 0), null, null),
  });

  const node = el('div', {}, [summary, emptyEl, rowsWrap, el('div', { class: 'mf-txn-btn-row' }, [addBtn])]);
  const collect = () => {
    const out = [];
    for (const r of refs) {
      if (r.removed) continue;
      const dv = r.d.value, pv = num(r.pri.value), iv = num(r.int.value);
      // A row needs a date and at least one non-zero leg to mean anything.
      if (!dv || (!(pv > 0) && !(iv > 0))) continue;
      out.push({ date: dv, principal: Math.round((pv || 0) * 100) / 100, interest: Math.round((iv || 0) * 100) / 100 });
    }
    return out.sort((a, b2) => (a.date || '').localeCompare(b2.date || ''));
  };
  return { node, collect };
}

export async function openBondForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const mod = await import('./bonds.js');
  const b2 = Object.assign({ owner: 'me', payout: 'payout' }, existing || {});

  const ratingList = el('datalist', { id: 'bondratinglist' }, mod.BOND_RATINGS.map((x) => el('option', { value: x })));
  const name = el('input', { type: 'text', value: b2.name || '', placeholder: 'Bond / issuer name' });
  const rating = el('input', { type: 'text', value: b2.rating || '', list: 'bondratinglist', placeholder: 'Rating (e.g. A+)' });
  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });
  const investAmount = numInput(b2.investAmount, '₹ invested');
  const rate = numInput(b2.rate, 'Coupon rate % p.a.');
  const bankRate = numInput(b2.bankRate, 'Bank rate % (optional, for comparison)');
  const startDate = el('input', { type: 'date', value: b2.startDate || todayISO() });
  const maturityDate = el('input', { type: 'date', value: b2.maturityDate || '' });
  const tenure = numInput('', 'Months');
  const payout = el('select', {}, [['cumulative', 'Cumulative (reinvest)'], ['payout', 'Payout (coupon out)']].map(([v, l]) => { const o = el('option', { value: v, text: l }); if (v === b2.payout) o.selected = true; return o; }));
  const maturityAmount = numInput(b2.maturityAmount, '₹ maturity amount (optional — overrides the projection)');

  // Interest schedule. Only offered for PAYOUT bonds: a cumulative bond is
  // "at maturity" by definition (that's what cumulative means), so showing the
  // picker there would invite a contradictory pair. '' = not specified, which is
  // every bond predating this field - it keeps the old projection untouched.
  const freqOpts = (sel, includeBlank) => {
    const opts = includeBlank ? [el('option', { value: '', text: 'Not specified' })] : [];
    mod.BOND_FREQ.forEach(([v, l]) => { const o = el('option', { value: v, text: l }); if (v === sel) o.selected = true; return opts.push(o); });
    return opts;
  };
  const interestFreq = el('select', {}, freqOpts(b2.interestFreq || '', true));
  // Principal defaults to the classic single lump; anything else amortizes and
  // switches the interest projection onto the reducing balance.
  const principalFreq = el('select', {}, freqOpts(b2.principalFreq || 'maturity', false));
  const scheduleEditor = buildBondScheduleEditor(b2.schedule, mod.addMonths, () => refresh());
  const staggerBlock = el('div', { class: 'hidden' }, [
    el('p', { class: 'hint', text: 'Staggered — enter the term sheet\'s own installments. Leave a leg blank when that date only pays the other one. Principal installments should add up to the invested amount.' }),
    scheduleEditor.node,
  ]);
  const interestFreqField = field('Interest payout', interestFreq, 'interestPayout');
  // Principal (and interest) dates normally anchor on MATURITY, not start - a
  // bond maturing on the 26th pays on the 26th of every month, regardless of
  // when a given buyer's own start date falls (see bonds.js periodDates). This
  // field is an OPTIONAL OVERRIDE for the irregular case where the real first
  // repayment genuinely isn't on that maturity-anchored date - a moratorium
  // period, or a term sheet with a one-off first installment. Left blank, the
  // correct maturity-anchored schedule applies automatically - no default to
  // fill in here. Only meaningful for a periodic principalFreq - 'maturity' has
  // no installments, 'staggered' already gives exact dates row by row.
  const principalIsPeriodic = () => principalFreq.value !== 'maturity' && principalFreq.value !== 'staggered';
  const principalFirstDate = el('input', { type: 'date', value: b2.principalFirstDate || '' });
  const principalFirstDateField = field('First repayment on (optional override, e.g. a moratorium)', principalFirstDate);
  const isStaggered = () => interestFreq.value === 'staggered' || principalFreq.value === 'staggered';
  const syncFreqVisibility = () => {
    const cum = payout.value === 'cumulative';
    interestFreqField.classList.toggle('hidden', cum);
    principalFirstDateField.classList.toggle('hidden', !principalIsPeriodic());
    staggerBlock.classList.toggle('hidden', !isStaggered());
    scheduleTabBtn.classList.toggle('hidden', !(startDate.value && maturityDate.value));
  };

  // Sold / redeemed early — bonds have no stored status field (status stays
  // fully date-derived, see bonds.js), so a checkbox is the minimal honest
  // control here rather than adding a parallel status enum like `funds` has
  // (which ends up checked in three different places as
  // `f.status === 'Sold' || f.soldDate`). This is also the right way to close
  // out a bond that redeemed exactly at maturity, not just an early exit.
  const isSoldChk = el('input', { type: 'checkbox' });
  isSoldChk.checked = !!b2.soldDate;
  const soldSwitch = el('label', { class: 'switch' }, [
    isSoldChk,
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
  ]);

  // Linking a bond to the Emergency Fund hands ownership of it to that surface:
  // it stays listed here with an "EF" badge but leaves this page's totals and
  // Home's Total Invested, so the same money is never counted in two places.
  const efChk = el('input', { type: 'checkbox' });
  efChk.checked = !!b2.emergencyFund;
  const efSwitch = el('label', { class: 'switch' }, [
    efChk,
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
  ]);
  const soldDate = el('input', { type: 'date', value: b2.soldDate || todayISO() });
  // Deliberately explicit: entering the GAIN instead of the total proceeds
  // under-counts realised interest by exactly the principal.
  const soldAmount = numInput(b2.soldAmount, '₹ received (total, including principal)');
  const soldBlock = el('div', { class: 'sold-only' + (isSoldChk.checked ? '' : ' hidden') }, [
    el('div', { class: 'field-row' }, [field('Amount received (₹) — total, including principal', soldAmount), field('Sold on', soldDate)]),
  ]);
  isSoldChk.addEventListener('change', () => { soldBlock.classList.toggle('hidden', !isSoldChk.checked); refresh(); });

  // Payouts tab - built before buildRec/refresh so buildRec can call
  // payoutEditor.collect(); its onChange fires deferred (see buildPayoutEditor),
  // so referencing `refresh` before it's declared below is safe.
  const payoutEditor = buildPayoutEditor(b2.payouts, mod.addMonths, () => refresh());

  const buildRec = () => {
    // Gate on the checkbox, not "soldDate.value is non-empty" — soldDate always
    // has a value (it defaults to today) so unchecking must be what clears both
    // fields, or unticking "sold" would leave orphaned soldAmount/soldDate data
    // behind in the record.
    const isSoldNow = isSoldChk.checked;
    return {
      owner: 'me',
      name: name.value.trim(),
      rating: rating.value.trim(),
      investAmount: num(investAmount.value) || 0,
      rate: num(rate.value) || 0,
      bankRate: bankRate.value !== '' ? num(bankRate.value) : null,
      startDate: startDate.value || null,
      maturityDate: maturityDate.value || null,
      payout: payout.value,
      emergencyFund: efChk.checked,
      // A cumulative bond's interest is at maturity by definition, so don't store a
      // second, possibly-disagreeing answer for it - null means "ask `payout`".
      interestFreq: payout.value === 'cumulative' ? null : (interestFreq.value || null),
      principalFreq: principalFreq.value || 'maturity',
      // Only meaningful while principal is periodic; clearing it otherwise stops a
      // stale date silently anchoring a schedule that no longer uses it.
      principalFirstDate: principalIsPeriodic() ? (principalFirstDate.value || null) : null,
      // Only meaningful while something is staggered; clearing it otherwise stops
      // orphaned installment rows silently driving a schedule later.
      schedule: isStaggered() ? scheduleEditor.collect() : [],
      maturityAmount: maturityAmount.value !== '' ? num(maturityAmount.value) : null,
      payouts: payoutEditor.collect(),
      soldDate: isSoldNow ? (soldDate.value || todayISO()) : null,
      soldAmount: isSoldNow ? num(soldAmount.value) : null,
      createdAt: b2.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const readout = el('div', { class: 'mf-bench-readout' });
  const refresh = () => {
    readout.innerHTML = '';
    const rec = buildRec();
    const c = mod.computeBond(rec, Date.now());
    readout.appendChild(el('div', { class: 'mf-bench-now' }, [
      el('span', {}, ['Tenure ', b(c.tenureYears ? c.tenureYears.toFixed(2) + ' yr' : '—')]),
      el('span', {}, [c.isSold ? 'Received ' : 'Maturity ', b(c.isSold ? (c.soldAmount != null ? fmtCur(c.soldAmount, 'INR') : '—') : (c.maturity ? fmtCur(c.maturityValue, 'INR') : '—'))]),
      el('span', {}, [c.isSold ? 'Realised ' : 'Interest ', b(c.isSold ? fmtIntCur(c.interestEarned) : (c.maturity ? fmtIntCur(c.totalInterest) : '—'))]),
    ]));
    // The realised figure is DERIVED, never typed, so the arithmetic behind it
    // must be visible before saving - a wrong "amount received" entry (e.g. the
    // gain instead of the total proceeds) is otherwise invisible until later.
    if (c.isSold && c.soldAmount != null) {
      readout.appendChild(el('p', { class: 'hint', style: 'margin-top:6px', text:
        `₹${Math.round(c.soldAmount).toLocaleString('en-IN')} received − ₹${Math.round(c.principal).toLocaleString('en-IN')} invested` +
        (c.payoutsBeforeExit ? ` + ₹${Math.round(c.payoutsBeforeExit).toLocaleString('en-IN')} coupons already received` : '') +
        ` = ₹${Math.round(c.interestEarned).toLocaleString('en-IN')} realised` }));
    }
    if (c.isSold && c.payoutsAfterExit) {
      readout.appendChild(el('p', { class: 'hint warn', style: 'margin-top:4px', text:
        `Heads up: ₹${Math.round(c.payoutsAfterExit).toLocaleString('en-IN')} of the logged payouts is dated on/after the sale — it's being treated as part of "Amount received", not extra interest. Remove that payout row if it's the same money.` }));
    }
    // The whole point of the frequency pickers: say plainly how much principal
    // comes back each time, and how much is still working.
    if (c.amortizes && c.scheduleRows.length) {
      const per = c.perInstallmentPrincipal;
      readout.appendChild(el('div', { class: 'mf-bench-now', style: 'margin-top:6px' }, [
        el('span', {}, ['Principal back ', b(per != null ? fmtCur(per, 'INR') : 'as scheduled')]),
        el('span', {}, ['× ', b(String(c.installments)), ' installments']),
        el('span', {}, ['Outstanding ', b(fmtCur(c.outstandingPrincipal, 'INR'))]),
      ]));
      readout.appendChild(el('p', { class: 'hint', style: 'margin-top:4px', text:
        `Interest is projected on the reducing balance, so each payment is smaller than the last — ${fmtIntCur(c.totalInterest)} total over the tenure, not ${fmtIntCur(c.principal * (c.rate / 100) * c.tenureYears)}. See the Schedule tab for every date.` }));
    }
    // Guard on the principal actually SCHEDULED, not on whether the schedule has
    // rows: a staggered-principal bond whose interest is periodic still produces
    // interest rows, so "has rows" would pass while nothing amortizes at all.
    if (c.amortizes && Math.abs(c.principalScheduled - c.principal) > 1) {
      const none = !(c.principalScheduled > 0);
      readout.appendChild(el('p', { class: 'hint warn', style: 'margin-top:4px', text:
        !c.scheduleRows.length
          ? 'Set both a start and maturity date to build the repayment schedule.'
          : none
            ? 'No principal installments yet — add them on the Schedule tab, or this bond still behaves as a single lump at maturity.'
            : `Principal installments total ${fmtIntCur(c.principalScheduled)} but ${fmtIntCur(c.principal)} was invested — a ${fmtIntCur(Math.abs(c.principalScheduled - c.principal))} ${c.principalScheduled > c.principal ? 'excess' : 'shortfall'}. Fix them on the Schedule tab.` }));
    }
    // Once any real principal repayment is logged on the Payouts tab, it
    // overrides the projected schedule for Outstanding/Invested - same as actual
    // interest already overrides the projected accrual. Said explicitly so a
    // number that no longer matches the Schedule tab's plan isn't mistaken for a
    // bug.
    if (c.hasPrincipalPayouts) {
      readout.appendChild(el('p', { class: 'hint', style: 'margin-top:4px', text:
        `Using actual repayments logged on Payouts (${fmtIntCur(c.principalPayoutsTotal)} principal received) for Outstanding, not the projected schedule.` }));
    }
    const basisTxt = 'Basis: ' + c.basis + (c.hasPayouts
      ? ` · ${rec.payouts.length} payout${rec.payouts.length === 1 ? '' : 's'} logged, ${fmtIntCur(c.payoutsTotal)} received to date`
      : ' · no payouts logged yet, showing the projection');
    readout.appendChild(el('p', { class: 'hint', style: 'margin-top:6px', text: basisTxt }));
  };
  tenure.addEventListener('input', () => {
    const m = num(tenure.value);
    if (m != null && startDate.value) maturityDate.value = mod.addMonths(startDate.value, m);
    refresh();
  });
  [investAmount, rate, bankRate, payout, startDate, maturityDate, maturityAmount, soldDate, soldAmount,
    interestFreq, principalFreq, principalFirstDate].forEach((inp) => inp.addEventListener('input', refresh));
  // Visibility depends on the pickers themselves, so it has to run on their change
  // as well as once up front - not just inside refresh(), which also fires from the
  // deferred editor callbacks and would fight the user mid-edit.
  [payout, interestFreq, principalFreq, startDate, maturityDate].forEach((inp) => inp.addEventListener('change', syncFreqVisibility));

  const del = async () => {
    if (!(await appConfirm('Delete this bond? This cannot be undone.'))) return;
    await DB.del('bonds', b2.id); closeModal(); toast('Bond deleted'); renderBond();
  };
  const save = async () => {
    if (!name.value.trim()) { toast('Enter the bond name'); return; }
    if (!(num(investAmount.value) > 0)) { toast('Enter the invested amount'); return; }
    if (isSoldChk.checked && num(soldAmount.value) == null) { toast('Enter the amount received on sale'); return; }
    const rec = buildRec();
    if (isEdit) rec.id = b2.id;
    await DB.put('bonds', rec); closeModal(); toast(isEdit ? 'Bond updated' : 'Bond added'); renderBond();
  };

  // ---- Details tab ----
  const detailsContent = el('div', {}, [
    field('Name', name),
    el('div', { class: 'field-row' }, [field('Rating', rating), field('Coupon rate % p.a.', rate, 'coupon')]),
    field('₹ invested', investAmount),
    el('div', { class: 'field-row' }, [field('Start date', startDate), field('Maturity date', maturityDate)]),
    field('Tenure (months) → fills maturity date', tenure),
    field('Type', payout, 'payoutType'),
    moreOptions([
      el('div', { class: 'field-row' }, [field('Bank rate % (optional)', bankRate), field('Maturity amount (optional override)', maturityAmount)]),
      el('div', { class: 'field-row' }, [interestFreqField, field('Principal repaid', principalFreq, 'principalRepaid')]),
      principalFirstDateField,
      staggerBlock,
      field('Sold / redeemed early — also use this to close out a bond redeemed at maturity', soldSwitch),
      soldBlock,
      field('Part of Emergency Fund — moves it to that page and out of these totals', efSwitch),
    ], !!(existing && (existing.bankRate || existing.maturityAmount || existing.interestFreq || existing.principalFreq
      || existing.principalFirstDate || (existing.schedule && existing.schedule.length) || existing.soldDate || existing.emergencyFund))),
    readout,
  ]);

  // ---- Payouts tab ----
  const payoutsContent = el('div', { class: 'hidden' }, [
    el('p', { class: 'hint', text: 'Log each interest/coupon payment you actually receive, dated — this becomes the real "interest earned" figure once logged, overriding the projected estimate above.' }),
    payoutEditor.node,
  ]);

  // ---- Schedule tab: the projected timeline, read-only ----
  const scheduleContent = el('div', { class: 'hidden' });
  const renderSchedule = () => {
    scheduleContent.innerHTML = '';
    const c = mod.computeBond(buildRec(), Date.now());
    if (!c.scheduleRows.length) {
      scheduleContent.appendChild(el('p', { class: 'hint', text: 'Nothing to project yet — set a start date, a maturity date, and either an interest frequency or a principal repayment frequency other than "At maturity".' }));
      return;
    }
    scheduleContent.appendChild(explainRow('About this schedule', c.amortizes
      ? 'Projected from the reducing balance: each row pays interest on whatever principal was still outstanding for that period, then returns its slice of principal. This is a plan, not actuals — log real receipts on the Payouts tab.'
      : 'Projected coupon dates. Principal returns as a single lump at maturity. This is a plan, not actuals — log real receipts on the Payouts tab.', 'How the projection works'));
    const today = todayISO();
    const head = el('div', { class: 'bond-sched-row bond-sched-head' }, [
      el('span', { text: 'Date' }), el('span', { text: 'Interest' }), el('span', { text: 'Principal' }), el('span', { text: 'Balance' }),
    ]);
    const wrap = el('div', { class: 'bond-sched' }, [head]);
    c.scheduleRows.forEach((r) => {
      // Past rows dim so the next one to land reads as the live edge of the schedule.
      wrap.appendChild(el('div', { class: 'bond-sched-row' + (r.date <= today ? ' is-past' : '') }, [
        el('span', { text: r.date }),
        el('span', { class: r.interest > 0 ? 'pos' : 'flat', text: r.interest > 0 ? fmtIntCur(r.interest) : '—' }),
        el('span', { text: r.principal > 0 ? fmtIntCur(r.principal) : '—' }),
        el('span', { class: 'flat', text: fmtIntCur(r.outstanding) }),
      ]));
    });
    scheduleContent.appendChild(wrap);
    const iTot = c.scheduleRows.reduce((s, r) => s + r.interest, 0);
    scheduleContent.appendChild(el('div', { class: 'mf-txn-summary' }, [
      el('span', { text: c.scheduleRows.length + ' rows' }),
      el('span', { text: 'Interest ' + fmtIntCur(iTot) }),
      el('span', { text: 'Principal ' + fmtIntCur(c.principalScheduled) }),
    ]));
    // A staggered principal plan that doesn't add up to the invested amount is the
    // single most likely data-entry slip here, and it silently skews every figure.
    if (c.amortizes && Math.abs(c.principalScheduled - c.principal) > 1) {
      scheduleContent.appendChild(el('p', { class: 'hint warn', style: 'margin-top:4px', text:
        `The principal installments add up to ${fmtIntCur(c.principalScheduled)}, but ${fmtIntCur(c.principal)} was invested — a ${fmtIntCur(Math.abs(c.principalScheduled - c.principal))} ${c.principalScheduled > c.principal ? 'excess' : 'shortfall'}. Fix the installments so they total the invested amount.` }));
    }
  };

  const detailsTabBtn = el('button', { class: 'active', type: 'button', text: 'Details' });
  const scheduleTabBtn = el('button', { type: 'button', text: 'Schedule' });
  const payoutsTabBtn = el('button', { type: 'button', text: 'Payouts' });
  const tabs = [
    { btn: detailsTabBtn, content: detailsContent },
    { btn: scheduleTabBtn, content: scheduleContent },
    { btn: payoutsTabBtn, content: payoutsContent },
  ];
  const showTab = (which) => tabs.forEach((t) => { const on = t === which; t.btn.classList.toggle('active', on); t.content.classList.toggle('hidden', !on); });
  detailsTabBtn.addEventListener('click', () => showTab(tabs[0]));
  scheduleTabBtn.addEventListener('click', () => { showTab(tabs[1]); renderSchedule(); });
  payoutsTabBtn.addEventListener('click', () => { showTab(tabs[2]); refresh(); });

  syncFreqVisibility();
  refresh();

  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: isEdit ? (b2.name || 'Edit bond') : 'Add bond' }),
      el('div', { class: 'seg' }, [detailsTabBtn, scheduleTabBtn, payoutsTabBtn]),
      ratingList,
      detailsContent,
      scheduleContent,
      payoutsContent,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}
