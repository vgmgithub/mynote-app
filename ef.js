import { DB } from './db.js';
import { fmtIntRate, fmtCur, todayISO, num } from './core.js';
import { setAppMode, $, updateEfNavActive, _efTab, el, fmtIntCur, _mfCell, b, explainRow, openModal, field, closeModal, round2, toast, _ordinalSuffix, fmtSheetCur, segChoice, refresh, catList, _spendMonthLabel, formSection, noteField, appConfirm } from './app.js';

// ---------- Emergency Fund surface ----------
let _efLoanFilter = 'open';  // 'open' | 'closed' | 'all'
// Logic in emergency.js; app.js does the `emergency`-store CRUD. The fund's
// INVESTMENTS deliberately do NOT live in that store — they're ordinary
// funds/bonds/fds records flagged `emergencyFund: true`, so they keep the
// existing live NAV fetch with no duplicated code and no extra network calls.
// Those flagged records are excluded from their own surface's totals AND from
// Home's Total Invested, exactly the treatment SGBs already get in `stocks`.
export async function openEmergency() {
  // No seeding: the user logs their own contributions, and the source sheet's
  // own totals don't reconcile, so importing them would import the discrepancy.
  setAppMode('ef');
}

// The fund's parked investments, read live from the three home stores.
//
// Each holding is decomposed into three separate quantities, because conflating
// them loses real money:
//   invested — capital still deployed (drops to 0 once the holding closes, since
//              the principal is then back in the fund as cash)
//   value    — what that deployed capital is worth right now (unrealised)
//   income   — cash the holding has ALREADY paid into the fund
//
// `income` is the one that's easy to miss. A payout bond's currentValue stays
// flat at its principal because each coupon leaves as cash, and a payout FD does
// the same — so `value − invested` is 0 for both, and their real receipts would
// vanish entirely if income weren't tracked on its own. It feeds `parkedRealised`
// → corpusIn → available cash.
async function efParked(nowMs) {
  const now = nowMs || Date.now();
  const items = [];
  let invested = 0, value = 0, realised = 0;
  const push = (o) => {
    o.income = Number(o.income) || 0;
    items.push(o);
    realised += o.income;
    if (!o.closed) { invested += Number(o.invested) || 0; value += Number(o.value) || 0; }
  };
  try {
    const linked = ((await DB.byIndex('funds', 'owner', 'me')) || []).filter((f) => f.emergencyFund);
    if (linked.length) {
      const mod = await import('./mf.js');
      for (const f of linked) {
        const c = mod.computeFund(f, now);
        const closed = f.status === 'Sold' || !!f.soldDate;
        // A fund pays nothing out along the way — units × NAV already carries the
        // whole return — so income is only the gain realised on redemption.
        push({ kind: 'MF', name: f.name || 'Fund', closed,
          invested: c.invested, value: c.value,
          income: closed ? (c.value || 0) - (c.invested || 0) : 0,
          sub: (f.type || 'Fund') + (c.value != null && f.navAsOf ? ' · NAV ' + f.navAsOf : '') });
      }
    }
  } catch (_) { /* a missing store or module must not blank the whole surface */ }
  try {
    const linked = ((await DB.byIndex('bonds', 'owner', 'me')) || []).filter((b2) => b2.emergencyFund);
    if (linked.length) {
      const mod = await import('./bonds.js');
      for (const b2 of linked) {
        const c = mod.computeBond(b2, now);
        const closed = c.effectiveStatus !== 'active';
        // Active: the coupons actually banked so far (post-sale rows excluded, as
        // those are the exit itself). Closed: interestEarned already folds the
        // coupons together with any sale gain.
        push({ kind: 'Bond', name: b2.name || 'Bond', closed,
          invested: c.outstandingPrincipal, value: c.currentValue,
          income: closed ? c.interestEarned : c.payoutsBeforeExit,
          sub: (b2.rating || 'Unrated') + ' · ' + fmtIntRate(c.rate) });
      }
    }
  } catch (_) {}
  try {
    const linked = ((await DB.byIndex('fds', 'owner', 'me')) || []).filter((f) => f.emergencyFund);
    if (linked.length) {
      const mod = await import('./fd.js');
      for (const f of linked) {
        const c = mod.computeFd(f, now);
        const closed = c.effectiveStatus === 'matured';
        // A payout FD hands its interest over as it accrues; a cumulative one
        // keeps it inside currentValue, so counting it as income too would
        // double it.
        push({ kind: 'FD', name: f.bank || 'FD', closed,
          invested: c.principal, value: c.currentValue,
          income: closed ? c.totalInterest : (c.payout ? c.accruedInterest : 0),
          sub: fmtIntRate(c.rate) + (c.maturity ? ' · mat ' + c.maturity : '') });
      }
    }
  } catch (_) {}
  return { invested, value, realised, count: items.length, items };
}

// All three logical tables plus the parked figures, in one pass.
// The fund's lending rate: one figure for the whole fund, stored in `meta` and
// edited on the Loans tab. EF_RATE is only the built-in default, used until it
// has been changed. Kept out of emergency.js, which reads no store.
async function efStoredRate(mod) {
  const row = await DB.get('meta', 'efLoanRate').catch(() => null);
  const v = row ? Number(row.value) : 0;
  return v > 0 ? v : mod.EF_RATE;
}

export async function efLoad() {
  const now = Date.now();
  const [rows, parked] = await Promise.all([
    DB.all('emergency').catch(() => []),
    efParked(now),
  ]);
  const of = (k) => (rows || []).filter((r) => r.kind === k);
  const mod = await import('./emergency.js');
  const rate = await efStoredRate(mod);
  const c = mod.computeEmergencyFund({
    rate,
    contributions: of('contribution'),
    targets: of('target'),
    loans: of('loan'),
    parkedInvested: parked.invested,
    parkedValue: parked.value,
    parkedRealised: parked.realised,
    parkedCount: parked.count,
  }, now);
  return { mod, c, parked, rows: rows || [] };
}

export async function renderEmergency() {
  const host = $('#efView');
  host.innerHTML = '';
  updateEfNavActive();
  const { mod, c, parked } = await efLoad();

  // ---- Summary ----
  // Shown on the tabs that report on the fund's money (Funds, Targets,
  // Loans), where the headline figure is the thing being read against.
  // Left off Log and Rules: a dated list of contributions and a page of
  // written terms aren't measured against the current balance, so there it
  // was only pushing the actual content down the screen.
  const showSummary = _efTab !== 'log' && _efTab !== 'terms';
  if (showSummary) host.appendChild(el('section', { class: 'summary' }, [
    el('div', { class: 'row-between summary-top' }, [
      el('div', {}, [
        el('div', { class: 'label', text: 'Fund value' }),
        el('div', { class: 'big', text: fmtCur(c.fundValue, 'INR') }),
      ]),
      el('div', { class: 'summary-earned' }, [
        el('div', { class: 'label', text: 'Interest earned' }),
        el('div', { class: 'v ' + (c.totalInterest >= 0 ? 'pos' : 'neg'), text: (c.totalInterest >= 0 ? '+' : '') + fmtIntCur(c.totalInterest) }),
      ]),
    ]),
    el('div', { class: 'grid' }, [
      el('div', { class: 'cell' }, [
        el('div', { class: 'k ef-k-icon' }, [
          'Collected',
          el('button', {
            class: 'calc-btn', type: 'button', 'aria-label': 'Contribution projection calculator',
            title: 'Project future contributions', text: '🔮',
            onclick: (e) => { e.stopPropagation(); openEfProjectionCalc(c, mod); },
          }),
        ]),
        el('div', { class: 'v', text: fmtIntCur(c.contributedTotal) }),
      ]),
      _mfCell('Invested', fmtIntCur(c.parkedInvested)),
      _mfCell('Lent out', fmtIntCur(c.lentOut), c.lentOut > 0 ? 'warn' : ''),
      _mfCell('Available', fmtIntCur(c.cashInHand), c.reconciles ? 'pos' : 'neg'),
    ]),
  ]));

  if (_efTab === 'fund') host.appendChild(efFundTab(c, parked));
  else if (_efTab === 'targets') host.appendChild(efTargetsTab(c, mod));
  else if (_efTab === 'loans') host.appendChild(efLoansTab(c, mod));
  else if (_efTab === 'terms') host.appendChild(efTermsTab(mod, c));
  else host.appendChild(efLogTab(c));
}

// Icon + label/sub + amount row, used for the Funds tab's Interest breakdown
// and the Log tab's Contributed breakdown — one visual language for "here's
// a figure, here's what it means" instead of the bare .grid/.cell markup
// (which has no CSS backing outside .summary, so it used to render unstyled).
// `group` drives the left accent color: 'realised'/'pos' green, 'pending'/
// 'warn' amber, anything else (e.g. 'neutral') falls back to a plain border.
const _efInfoRow = (icon, label, sub, amount, group, amtCls) => el('div', { class: 'ef-interest-row is-' + group }, [
  el('div', { class: 'ef-interest-icon', text: icon }),
  el('div', { class: 'ef-interest-body' }, [
    el('div', { class: 'ef-interest-label', text: label }),
    el('div', { class: 'ef-interest-sub', text: sub }),
  ]),
  el('div', { class: 'ef-interest-amt ' + (amtCls || ''), text: amount }),
]);

// ---- Fund tab: where the money is, the reconciliation, and the target ladder
function efFundTab(c, parked) {
  const wrap = el('div', { class: 'tab-content' });
  // Nothing entered yet: say what to do first instead of showing a screen of zeros.
  if (!c.contributionCount && !c.loanCount && !(c.targets || []).length && !c.parkedCount) {
    wrap.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🚨' }),
      el('p', { text: 'Start your emergency fund.' }),
      el('p', { class: 'hint', text: 'Log what you put in each month, and set a target to aim for. Everything else on this page fills in from that.' }),
      el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn primary', type: 'button', text: 'Log a contribution', onclick: () => openEfContribForm(null) }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Set a target', onclick: () => openEfTargetForm(null) }),
      ]),
    ]));
    return wrap;
  }

  // Interest, grouped by REALISED (cash already in the fund) vs PENDING /
  // unrealised (mark-to-market or a projection) — different confidence, so kept
  // visually apart instead of one flat row of numbers.
  const interestCard = el('div', { class: 'chart-card ef-interest-card' }, [el('h3', { text: 'Interest' })]);
  const interestList = el('div', { class: 'ef-interest-list' });
  const interestRow = _efInfoRow;
  interestList.appendChild(el('div', { class: 'ef-interest-group-label', text: 'Realised — already cash in the fund' }));
  interestList.appendChild(interestRow('🤝', 'From lending', 'Interest collected on loans', fmtIntCur(c.loanInterestRealised), 'realised', 'pos'));
  interestList.appendChild(interestRow('📈', 'From investments', 'Coupons and payouts received', fmtIntCur(c.parkedRealised), 'realised', c.parkedRealised > 0 ? 'pos' : ''));
  interestList.appendChild(el('div', { class: 'ef-interest-group-label', text: 'Pending / unrealised' }));
  interestList.appendChild(interestRow('📊', 'Unrealised on investments', 'Mark-to-market on what\'s still deployed', (c.marketInterest >= 0 ? '+' : '') + fmtIntCur(c.marketInterest), 'pending', c.marketInterest >= 0 ? 'pos' : 'neg'));
  interestList.appendChild(interestRow('⏳', 'Due on open loans', 'Projected if repaid on schedule', fmtIntCur(c.loanInterestPending), 'pending', c.loanInterestPending > 0 ? 'warn' : ''));
  interestCard.appendChild(interestList);
  wrap.appendChild(interestCard);

  // Where it's parked — live from the linked records, grouped by category
  // (MF / Bonds / FD) so each ladder reads as its own cluster instead of one
  // undifferentiated list, with a per-group subtotal in the header.
  const inv = el('div', { class: 'chart-card' }, [el('h3', { text: 'Invested in' })]);
  if (!parked.count) {
    inv.appendChild(el('p', { class: 'hint', text: 'Nothing linked yet. Open a mutual fund, bond or FD and switch on "Part of Emergency Fund" — it keeps its live NAV there and shows up here.' }));
  } else {
    const KIND_META = {
      MF: { icon: '📈', label: 'Mutual Funds' },
      Bond: { icon: '🧾', label: 'Bonds' },
      FD: { icon: '🏦', label: 'Fixed Deposits' },
    };
    const KIND_ORDER = ['MF', 'Bond', 'FD'];
    const groups = new Map();
    parked.items.forEach((it) => {
      if (!groups.has(it.kind)) groups.set(it.kind, []);
      groups.get(it.kind).push(it);
    });
    const kinds = KIND_ORDER.filter((k) => groups.has(k)).concat([...groups.keys()].filter((k) => !KIND_ORDER.includes(k)));
    kinds.forEach((kind) => {
      const list = groups.get(kind);
      const meta = KIND_META[kind] || { icon: '💰', label: kind };
      // Header subtotal: capital still deployed in this category, or (once
      // everything in it has closed) the realised interest it left behind.
      let gInvested = 0, gIncome = 0;
      list.forEach((it) => { gIncome += Number(it.income) || 0; if (!it.closed) gInvested += Number(it.invested) || 0; });
      inv.appendChild(el('div', { class: 'ef-group-header' }, [
        el('span', { class: 'ef-group-ico', text: meta.icon }),
        el('span', { class: 'ef-group-title', text: `${meta.label} · ${list.length}` }),
        el('span', { class: 'ef-group-total', text: gInvested > 0 ? fmtIntCur(gInvested) : (gIncome > 0 ? '+' + fmtIntCur(gIncome) + ' realised' : '—') }),
      ]));
      list.forEach((it) => {
        const gain = (Number(it.value) || 0) - (Number(it.invested) || 0);
        // For bonds, show payout total instead of 0 for sold bonds
        const isBond = it.kind === 'Bond';
        const payoutLabel = isBond && it.closed ? ' · payouts ' + fmtIntCur(it.income) : '';
        inv.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'top' }, [
            el('div', { class: 'card-left' }, [
              el('div', { class: 'name', text: it.name }),
              el('div', { class: 'cat mf-catline', text: (it.sub || '') + (it.closed ? ' · closed' : '') + payoutLabel }),
            ]),
            el('div', { class: 'card-right' }, it.closed
              // "realised" uses income (the actual realised interest/gain), not a
              // never-set `.gain` field — closed holdings used to always show +₹0.
              ? [el('div', { class: 'pct pos', text: '+' + fmtIntCur(it.income) }), el('div', { class: 'meta-line', text: 'realised' })]
              // "unrealised", not "gain" — a payout bond sits at +₹0 here while its
              // coupons show on their own line below, and "gain ₹0" would read as
              // if it had earned nothing.
              : [el('div', { class: 'pct ' + (gain >= 0 ? 'pos' : 'neg'), text: (gain >= 0 ? '+' : '') + fmtIntCur(gain) }), el('div', { class: 'meta-line', text: 'unrealised' })]),
          ]),
          it.closed ? document.createTextNode('') : el('div', { class: 'sub mf-sub2' }, [
            el('span', {}, [el('div', {}, ['Invested ', b(fmtIntCur(it.invested))])]),
            el('span', { class: 'value-emphasis' }, ['Value ', b(fmtIntCur(it.value))]),
          ]),
          // Coupons / payout interest already banked. Shown separately because it
          // is NOT inside the value above — that money has left the holding.
          (!it.closed && it.income > 0)
            ? el('div', { class: 'meta-line pos', text: fmtIntCur(it.income) + ' interest received (already cash in the fund)' })
            : document.createTextNode(''),
        ]));
      });
    });
  }
  wrap.appendChild(inv);

  // Reconciliation — spelled out rather than left as a bare number, because it's
  // the one figure that can silently go wrong if a contribution wasn't logged.
  const rec = el('div', { class: 'chart-card' }, [el('h3', { text: 'Where it all is' })]);
  const line = (label, amount, cls) => el('div', { class: 'bar-row' }, [
    el('span', { class: 'bl', text: label }),
    el('span', { class: 'bn ' + (cls || ''), text: fmtIntCur(amount) }),
  ]);
  rec.appendChild(line('Collected (contributions + interest received)', c.corpusIn));
  rec.appendChild(line('− Invested', c.parkedInvested));
  rec.appendChild(line('− Lent out', c.lentOut));
  rec.appendChild(line('= Available now', c.cashInHand, c.reconciles ? 'pos' : 'neg'));
  if (!c.reconciles) {
    rec.appendChild(el('p', { class: 'hint warn', text:
      `More has been invested and lent than the log says was collected — short by ${fmtIntCur(c.shortfall)}. A contribution is probably missing from the Log tab.` }));
  }
  wrap.appendChild(rec);

  wrap.appendChild(explainRow('About these figures', 'Nothing here is counted in Home\'s Total Invested — the linked funds, bonds and FDs are tracked on this page instead of theirs, so the same money is never counted twice. Not financial advice.', 'What this does and does not count'));
  return wrap;
}

const _EF_MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _efMonthLabel = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(iso || ''); return m ? `${_EF_MONS[+m[2] - 1]} ${m[1]}` : '—'; };

// Calculator popup opened from the 🧮 next to "Collected" on the summary card.
// Projects the RAW contribution total (mine + spouse, no loan/investment
// interest — that's what "Collected" now shows) forward across the next 12
// months, assuming the last logged monthly contribution keeps repeating.
// "Auto-calculate" (default on, when there's a contribution to base it on)
// fills the monthly amount from the last logged row; switching it off lets
// the amount be typed by hand for a what-if scenario.
function openEfProjectionCalc(c, mod) {
  const rows = (c.contributionRows || []).slice().sort((a, b2) => (a.date || '').localeCompare(b2.date || ''));
  const last = rows.length ? rows[rows.length - 1] : null;
  const lastAmt = last ? (Number(last.mine) || 0) + (Number(last.spouse) || 0) : 0;
  // The upcoming-months list always starts from the current month forward —
  // even if the last logged contribution is stale, "upcoming" should still
  // mean upcoming from today, not from whenever it was last logged. The
  // month-count used in the actual projection math is separate (from `last`).
  const todayMonthISO = todayISO().slice(0, 7) + '-01';
  const lastMonthISO = last ? last.date.slice(0, 7) + '-01' : todayMonthISO;
  const baseISO = lastMonthISO > todayMonthISO ? lastMonthISO : todayMonthISO;

  const autoChk = el('input', { type: 'checkbox' });
  autoChk.checked = !!last;
  if (!last) autoChk.disabled = true;
  const autoSwitch = el('label', { class: 'switch' }, [
    autoChk,
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
  ]);
  const amtInput = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: lastAmt || '', placeholder: '₹ per month' });
  amtInput.disabled = autoChk.checked;

  let selectedISO = mod.addMonths(baseISO, 3);

  const readout = el('div', { class: 'ef-proj-big' });
  const monthList = el('div', { class: 'ef-proj-months' });
  const monthBtns = [];

  const currentMonthlyAmt = () => (autoChk.checked ? lastAmt : (num(amtInput.value) || 0));

  const refreshReadout = () => {
    readout.innerHTML = '';
    const amt = currentMonthlyAmt();
    const fromISO = last ? last.date : baseISO;
    const projected = mod.projectContributions(c.contributedTotal, fromISO, amt, selectedISO);
    const months = Math.max(0, mod.monthsBetween(fromISO, selectedISO));
    readout.appendChild(el('div', { class: 'label', text: 'Projected collected by ' + _efMonthLabel(selectedISO) }));
    readout.appendChild(el('div', { class: 'big', text: fmtCur(projected, 'INR') }));
    readout.appendChild(el('div', { class: 'hint', text:
      `${fmtIntCur(c.contributedTotal)} now + ${months} more month${months === 1 ? '' : 's'} at ${fmtIntCur(amt)}/mo = ${fmtIntCur(projected - c.contributedTotal)} added` }));
  };

  for (let i = 1; i <= 12; i++) {
    const mISO = mod.addMonths(baseISO, i);
    const btn = el('button', { type: 'button', class: 'ef-proj-month' + (mISO === selectedISO ? ' active' : ''), text: _efMonthLabel(mISO) });
    btn.addEventListener('click', () => {
      selectedISO = mISO;
      monthBtns.forEach((r) => r.btn.classList.toggle('active', r.iso === selectedISO));
      refreshReadout();
    });
    monthBtns.push({ iso: mISO, btn });
    monthList.appendChild(btn);
  }

  autoChk.addEventListener('change', () => {
    amtInput.disabled = autoChk.checked;
    if (autoChk.checked) amtInput.value = lastAmt || '';
    refreshReadout();
  });
  amtInput.addEventListener('input', refreshReadout);

  refreshReadout();

  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Contribution projection' }),
    el('p', { class: 'hint', text: last
      ? `Last logged: ${_efMonthLabel(last.date)} · ${fmtIntCur(lastAmt)}`
      : 'No contributions logged yet — enter a monthly amount to project with.' }),
    el('div', { class: 'ef-proj-current' }, [
      el('span', { class: 'bl', text: 'Collected so far' }),
      el('span', { class: 'bn', text: fmtIntCur(c.contributedTotal) }),
    ]),
    field('Auto-calculate from last contribution', autoSwitch),
    field('Monthly amount to project with', amtInput),
    readout,
    el('h3', { style: 'margin-top:14px', text: 'Upcoming months — tap one' }),
    monthList,
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

// ---- Targets tab
function efTargetsTab(c, mod) {
  const wrap = el('div', { class: 'tab-content' });
  if (!c.targets.length) {
    wrap.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🎯' }),
      el('p', { text: 'No targets yet.' }),
      el('p', { class: 'hint', text: 'Tap + to add the first rung of your emergency fund ladder.' }),
    ]));
  } else {
    c.targets.forEach((t) => {
      wrap.appendChild(el('div', { class: 'card', onclick: () => openEfTargetForm(t) }, [
        el('div', { class: 'top' }, [
          el('div', { class: 'card-left' }, [
            el('div', { class: 'name' }, [t.name || 'Target',
              t.isMet ? el('span', { class: 'badge good mf-beat', text: 'met' }) : document.createTextNode('')]),
            el('div', { class: 'cat mf-catline', text: fmtIntCur(t.cumulative)
              + (t.ladder === 'absorb' ? ' · replaces the previous' : '')
              + (t.expectedClosure ? ' · by ' + t.expectedClosure : '') }),
          ]),
          el('div', { class: 'card-right' }, [
            el('div', { class: 'pct ' + (t.isMet ? 'pos' : ''), text: t.pct.toFixed(0) + '%' }),
            el('div', { class: 'meta-line', text: t.isMet ? '+' + fmtIntCur(t.surplus) + ' over' : fmtIntCur(t.remaining) + ' to go' }),
          ]),
        ]),
        el('div', { class: 'bar-row' }, [
          el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: `width:${Math.max(2, t.pct).toFixed(1)}%` })]),
        ]),
      ]));
    });
  }
  // "How the ladder works" on the left; when a target was last reached, on the
  // right of the SAME line.
  const last = mod && mod.lastTargetAchieved ? mod.lastTargetAchieved(c) : null;
  const when = !last ? '' : last.days === 0 ? 'today' : last.days === 1 ? 'yesterday' : last.days + ' days ago';
  wrap.appendChild(el('div', { class: 'ef-ladder-foot' }, [
    explainRow('About the ladder', 'Your emergency fund ladder progress. Each target can replace or add to the previous one.', 'How the ladder works'),
    last ? el('span', { class: 'ef-ladder-last', title: last.target.name || '', text: '🏆 Last target achieved ' + when }) : null,
  ].filter(Boolean)));
  return wrap;
}

// ---- Loans tab
function efLoansTab(c, mod) {
  const wrap = el('div', { class: 'tab-content' });
  // ---- The fund's lending rate ----
  // One figure for the whole fund, so it lives on the tab that lists what the
  // fund has lent rather than being re-typed inside every loan. Editing it
  // prices loans taken FROM NOW ON: each loan stores the rate it was saved
  // with, so a change here never quietly re-prices a loan already agreed.
  const rateInput = el('input', {
    type: 'number', inputmode: 'decimal', step: '0.25', min: String(mod.EF_MIN_RATE),
    class: 'ef-rate-input', value: c.rate,
  });
  const rateSave = el('button', { class: 'btn primary ef-rate-save hidden', type: 'button', text: 'Save' });
  // The button only appears once the figure actually differs, so the card reads
  // as a statement of the rate and not as an unfinished form.
  const syncRateSave = () => {
    const v = num(rateInput.value);
    rateSave.classList.toggle('hidden', !(v > 0) || Math.abs(v - c.rate) < 0.001);
  };
  rateInput.addEventListener('input', syncRateSave);
  rateSave.addEventListener('click', async () => {
    const v = round2(num(rateInput.value));
    if (!(v >= mod.EF_MIN_RATE)) { toast('The fund\u2019s lending rate cannot go below ' + mod.EF_MIN_RATE + '%'); return; }
    await DB.put('meta', { key: 'efLoanRate', value: v, updatedAt: new Date().toISOString() });
    toast('Lending rate set to ' + v + '%');
    renderEmergency();
  });
  wrap.appendChild(el('div', { class: 'ef-rate-card' }, [
    el('div', { class: 'ef-rate-icon', text: '💰' }),
    el('div', { class: 'ef-rate-body' }, [
      el('div', { class: 'ef-rate-label', text: 'Lending rate' }),
      el('div', { class: 'ef-rate-sub', text: 'Charged on every new loan, never below ' + mod.EF_MIN_RATE + '%. Emergency draws are free for '
        + mod.EF_FREE_MONTHS.emergency + ' months, gifts for ' + mod.EF_FREE_MONTHS.gift + '.' }),
    ]),
    el('div', { class: 'ef-rate-edit' }, [rateInput, el('span', { class: 'ef-rate-pct', text: '%' }), rateSave]),
  ]));

  const seg = el('div', { class: 'seg' }, [
    ['open', `Open (${c.openCount})`],
    ['closed', `Closed (${c.loanCount - c.openCount})`],
    ['all', `All (${c.loanCount})`],
  ].map(([v, label]) => el('button', {
    class: (_efLoanFilter === v ? 'active' : ''), type: 'button', text: label,
    onclick: () => { _efLoanFilter = v; renderEmergency(); },
  })));
  wrap.appendChild(el('div', { class: 'toolbar mf-toolbar-top' }, [seg]));

  if (c.overdueCount || c.freeExpiringCount) {
    const bits = [];
    if (c.overdueCount) bits.push(`${c.overdueCount} past its return date`);
    // Warn BEFORE the free window closes, not after interest has already started.
    if (c.freeExpiringCount) bits.push(`${c.freeExpiringCount} about to start accruing interest`);
    wrap.appendChild(el('p', { class: 'hint warn', text: bits.join(' · ') }));
  }

  const list = c.loans.filter((l) => _efLoanFilter === 'all' || (_efLoanFilter === 'open' ? !l.isClosed : l.isClosed));
  if (!list.length) {
    wrap.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '🤝' }), el('p', { text: 'Nothing here.' })]));
  } else {
    const sec = el('section', { class: 'stock-list' });
    // Open first, then most recently taken.
    list.slice().sort((a, b2) => (a.isClosed - b2.isClosed) || String(b2.rec.takenDate || '').localeCompare(String(a.rec.takenDate || '')))
      .forEach((l) => sec.appendChild(efLoanCard(l, mod)));
    wrap.appendChild(sec);
  }
  return wrap;
}

function efLoanCard(l, mod) {
  const r = l.rec;
  const kindLabel = (mod.EF_KINDS.find(([v]) => v === r.loanKind) || [null, r.loanKind || 'Loan'])[1];
  // "0m" on its own reads as a loan with no term, which is what it looked like
  // on one taken this month. Elapsed OF the term agreed says the real thing:
  // none of it has run yet, out of the six months it is meant to.
  const span = l.isClosed
    ? 'ran ' + l.monthsElapsed + (l.monthsElapsed === 1 ? ' month' : ' months')
    : (l.plannedMonths != null
      ? l.monthsElapsed + ' of ' + l.plannedMonths + (l.plannedMonths === 1 ? ' month' : ' months')
      : l.monthsElapsed + 'm in · no return date');
  const badge = l.isClosed
    ? el('span', { class: 'badge muted mf-beat', text: 'closed' })
    : l.overdue
      ? el('span', { class: 'badge bad mf-beat', text: 'overdue' })
      : l.isFree
        ? el('span', { class: 'badge good mf-beat', text: l.freeMonthsLeft <= 1 ? 'free · ' + l.freeMonthsLeft + 'm left' : 'interest-free' })
        // The band the figure beside it is priced at, which on an open loan is
        // the one it reaches by its expected date - not today's. Labelled, so
        // it cannot be read as the band already being charged.
        : el('span', { class: 'badge warn mf-beat',
            text: l.isClosed ? l.multiplier + '× band' : l.quotedMultiplier + '× at return' });
  return el('div', { class: 'card', onclick: () => openEfLoanForm(r) }, [
    el('div', { class: 'top' }, [
      el('div', { class: 'card-left' }, [
        el('div', { class: 'name', text: (r.who || '—') + ' · ' + (r.purpose || 'Loan') }),
        el('div', { class: 'cat mf-catline' }, [kindLabel + ' · ' + span, badge]),
      ]),
      el('div', { class: 'card-right' }, [
        el('div', { class: 'pct ' + (l.interest > 0 ? 'warn' : 'pos'), text: l.interest > 0 ? fmtIntCur(l.interest) : '₹0' }),
        el('div', { class: 'meta-line', text: l.isClosed ? 'interest' : 'if repaid on time' }),
      ]),
    ]),
    el('div', { class: 'sub mf-sub2' }, [
      el('span', {}, [
        el('div', {}, ['Lent ', b(fmtIntCur(l.amount))]),
        el('div', { class: 'mf-meta-mini', text: (r.takenDate || '?') + (r.expectedDate ? ' → ' + r.expectedDate : '') }),
      ]),
      el('span', { class: 'value-emphasis' }, [l.isClosed ? 'Repaid ' : 'Outstanding ', b(fmtIntCur(l.isClosed ? l.repaid : l.outstanding))]),
    ]),
    l.instalments ? el('div', { class: 'mf-meta-mini', text: `${l.instalments} instalment${l.instalments === 1 ? '' : 's'} · ${fmtIntCur(l.repaid)} repaid` }) : document.createTextNode(''),
    // Show the accrued figure only when it differs from the quoted one, so an
    // open loan makes clear what it costs NOW versus if repaid as planned.
    (!l.isClosed && l.interestAccrued !== l.interest)
      ? el('div', { class: 'meta-line', text: fmtIntCur(l.interestAccrued) + ' accrued so far' })
      : document.createTextNode(''),
    l.isOverridden ? el('div', { class: 'meta-line flat', text: 'interest entered manually' }) : document.createTextNode(''),
    l.interestPaid ? el('div', { class: 'meta-line pos', text: fmtIntCur(l.interestPaid) + ' interest paid' }) : document.createTextNode(''),
  ]);
}

// A working couple can keep both contributions equal: 'equal' mirrors one figure into the other when logging.
function efSplitCard() {
  const seg = el('div', { class: 'seg ef-split-seg' });
  const card = el('div', { class: 'ef-rate-card ef-split-card' }, [
    el('div', { class: 'ef-rate-icon', text: '\u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}' }),
    el('div', { class: 'ef-rate-body' }, [
      el('div', { class: 'ef-rate-label', text: 'Contribution split' }),
      el('div', { class: 'ef-rate-sub', text: 'Working couple? Keep both contributions equal, so logging one fills the other.' }),
    ]),
    seg,
  ]);
  const paint = (mode) => {
    seg.innerHTML = '';
    [['equal', 'Equal'], ['custom', 'Custom']].forEach(([k, label]) => seg.appendChild(el('button', {
      type: 'button', class: mode === k ? 'active' : '', text: label,
      onclick: async () => { await DB.put('meta', { key: 'efSplitMode', value: k, updatedAt: new Date().toISOString() }); paint(k); toast(k === 'equal' ? 'Contributions will be kept equal' : 'Each contribution is entered separately'); },
    })));
  };
  paint(null);
  DB.get('meta', 'efSplitMode').then((r) => paint(r && r.value)).catch(() => {});
  return card;
}

// ---- Log tab: the contribution ledger
function efLogTab(c) {
  const wrap = el('div', { class: 'tab-content' });
  wrap.appendChild(efSplitCard());

  // Contributed, redesigned to match the Funds tab's Interest card: a big
  // total up top (with the month count as context, not just another cell),
  // then Mine/Spouse as icon rows instead of the bare .grid/.cell markup —
  // that had no CSS backing outside .summary, so it rendered unstyled.
  const summaryCard = el('div', { class: 'chart-card ef-interest-card' }, [el('h3', { text: 'Contributed' })]);
  summaryCard.appendChild(el('div', { class: 'ef-proj-big' }, [
    el('div', { class: 'label', text: c.contributionCount + (c.contributionCount === 1 ? ' month logged' : ' months logged') }),
    el('div', { class: 'big', text: fmtCur(c.contributedTotal, 'INR') }),
  ]));
  const contribList = el('div', { class: 'ef-interest-list' });
  contribList.appendChild(_efInfoRow('🧑', 'Mine', 'Your share across every logged month', fmtIntCur(c.mineTotal), 'mine'));
  contribList.appendChild(_efInfoRow('🧑‍🤝‍🧑', 'Spouse', 'Spouse\'s share across every logged month', fmtIntCur(c.spouseTotal), 'spouse'));
  summaryCard.appendChild(contribList);
  wrap.appendChild(summaryCard);

  const rows = (c.contributionRows || []).slice();
  if (!rows.length) {
    wrap.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '🗓️' }), el('p', { text: 'No contributions logged yet.' }), el('p', { class: 'hint', text: 'Tap + to log a month.' })]));
  } else {
    const sec = el('section', { class: 'stock-list' });
    rows.sort((a, b2) => String(b2.date || '').localeCompare(String(a.date || ''))).forEach((r) => {
      const tot = (Number(r.mine) || 0) + (Number(r.spouse) || 0);
      sec.appendChild(el('div', { class: 'card', onclick: () => openEfContribForm(r) }, [
        el('div', { class: 'top' }, [
          el('div', { class: 'card-left' }, [
            el('div', { class: 'name', text: r.date || '—' }),
            el('div', { class: 'cat mf-catline', text: `${fmtIntCur(r.mine)} + ${fmtIntCur(r.spouse)}` + (r.note ? ' · ' + r.note : '') }),
          ]),
          el('div', { class: 'card-right' }, [el('div', { class: 'pct pos', text: fmtIntCur(tot) })]),
        ]),
      ]));
    });
    wrap.appendChild(sec);
  }
  return wrap;
}

// ---- Rules tab: the written policy, verbatim from the family's own terms
// sheet. Pure reference — nothing to add here, so the FAB is hidden on this
// tab. Figures the app actually computes from (the free-months windows, the
// rate, the rounding) are pulled from emergency.js's own constants, so this
// text can never drift out of sync with what the Loans tab actually charges.
function efTermsTab(mod, c) {
  const ratePct = c && c.rate != null ? c.rate : mod.EF_RATE;
  const wrap = el('div', { class: 'tab-content' });
  const card = el('div', { class: 'chart-card' }, [el('h3', { text: 'Emergency Fund Terms' })]);
  const list = el('div', { class: 'ef-rules' });

  const rule = (n, text, subRows) => {
    list.appendChild(el('div', { class: 'ef-rule' }, [
      el('div', { class: 'ef-rule-num', text: String(n) }),
      el('div', { class: 'ef-rule-body' }, [
        el('div', { class: 'ef-rule-text', text }),
        subRows ? el('div', { class: 'ef-rule-sub' }, subRows.map(([k, v]) => el('div', { class: 'ef-rule-sub-row' }, [
          el('span', { text: k }), el('span', { class: 'ef-rule-sub-v', text: v }),
        ]))) : document.createTextNode(''),
      ]),
    ]));
  };

  rule(1, 'The fund should be used only for genuine emergencies.');
  rule(2, `If we use the fund, the used amount must be repaid within ${mod.EF_FREE_MONTHS.emergency} months.`);
  rule(3, 'If repayment takes longer than that for an emergency, we must pay interest based on usage.');
  rule(4, 'If the fund is used for a non-emergency, interest must be paid from the beginning of usage.');
  rule(5, 'If repayment exceeds the free window, additional interest will apply.');
  rule(6, 'Additional interest is calculated for every 3-month block:', [
    ['Up to 3 months', '1×'],
    ['4–6 months', '2×'],
    ['7–9 months', '3×'],
    ['10–12 months', '4×'],
    ['Beyond 12 months', '+1× every further 3 months'],
  ]);
  rule(7, `The rule above applies to both emergency and non-emergency usage. Only emergency use within ${mod.EF_FREE_MONTHS.emergency} months is interest-free.`);
  rule(8, 'These rules apply to our personal use only.');
  rule(9, `For helping others, up to ${mod.EF_HELP_SHARE}% of the fund can be given without interest or reason, but must be returned within 3–${mod.EF_FREE_MONTHS.gift} months.`);
  rule(10, `Only one allocation of the ${mod.EF_HELP_SHARE}% for others is allowed per cycle. After repayment, the amount can be given again — not multiple times simultaneously.`);

  card.appendChild(list);
  wrap.appendChild(card);

  // ---- What counts as an emergency ----
  // Rule 1 turns on the word "genuine", and a rulebook that leaves its central
  // term undefined is the one that gets argued about at the worst moment. This
  // is the agreed list, with the catch-all spelled out rather than assumed.
  const REASONS = [
    ['🏥', 'Medical needs'],
    ['💼', 'Job loss'],
    ['✈️', 'Unplanned travel for family emergencies'],
    ['📦', 'Relocation costs'],
    ['🚗', 'Vehicle repairs'],
    ['🔌', 'Essential appliance breakdown'],
  ];
  const reasonCard = el('div', { class: 'chart-card' }, [el('h3', { text: 'Emergency Reasons' })]);
  reasonCard.appendChild(el('div', { class: 'ef-reasons' }, REASONS.map(([ico, text]) => el('div', { class: 'ef-reason' }, [
    el('span', { class: 'ef-reason-ico', text: ico }),
    el('span', { class: 'ef-reason-text', text }),
  ]))));
  reasonCard.appendChild(el('p', { class: 'ef-reason-note', text:
    'Any other situation that threatens basic living, health, or safety can be considered an emergency — to be decided together.' }));
  wrap.appendChild(reasonCard);

  // ---- Loan Rules: rules 9 and 10 in rupees ----
  // The policy states a percentage; what anyone actually needs to know is the
  // figure it comes to today and who each allocation belongs to. Derived from
  // the fund's current value, so it moves as the fund does instead of being a
  // number copied out of the sheet once.
  //
  // Every party gets the SAME cap: this is one allowance repeated, not a
  // quarter split four ways.
  const HELP_PARTIES = ['Appa · Amma', 'Athai · Mama', 'Others', 'Ours'];
  const helpCap = round2(((c && c.fundValue) || 0) * (mod.EF_HELP_SHARE / 100));
  const loanCard = el('div', { class: 'chart-card' }, [el('h3', { text: 'Loan Rules' })]);
  loanCard.appendChild(el('div', { class: 'ef-lr-head' }, [
    el('div', { class: 'ef-lr-head-cell' }, [
      el('div', { class: 'ef-lr-head-label', text: mod.EF_HELP_SHARE + '% can be used with no interest' }),
      el('div', { class: 'ef-lr-head-big', text: fmtIntCur(helpCap) }),
    ]),
    el('div', { class: 'ef-lr-head-cell is-side' }, [
      el('div', { class: 'ef-lr-head-label', text: 'Repay period' }),
      el('div', { class: 'ef-lr-head-val', text: '3 – ' + mod.EF_FREE_MONTHS.gift + ' months' }),
    ]),
  ]));
  loanCard.appendChild(el('div', { class: 'ef-lr-rows' }, HELP_PARTIES.map((name) => el('div', { class: 'ef-lr-row' }, [
    el('span', { class: 'ef-lr-share', text: mod.EF_HELP_SHARE + '%' }),
    el('span', { class: 'ef-lr-who', text: name }),
    el('span', { class: 'ef-lr-amt', text: fmtIntCur(helpCap) }),
  ]))));
  // A percentage of the fund is a policy cap, not a promise that the money is
  // to hand - what can actually be lent is limited by cash as well, and that
  // is the constraint that bites at the moment of asking.
  if (helpCap > 0 && (c ? c.cashInHand : 0) < helpCap) {
    loanCard.appendChild(el('p', { class: 'hint warn', style: 'margin:9px 0 0',
      text: 'Only ' + fmtIntCur(Math.max(0, c.cashInHand)) + ' is in cash right now, so the full '
        + fmtIntCur(helpCap) + ' could not be lent today without selling something the fund holds.' }));
  }
  loanCard.appendChild(el('p', { class: 'ef-reason-note', text: helpCap > 0
    ? 'Each of these is the same allowance, not a share of one — ' + mod.EF_HELP_SHARE
      + '% of the fund per party, one allocation at a time (rules 9 and 10). ' + mod.EF_HELP_SHARE
      + '% of the current fund value of ' + fmtIntCur((c && c.fundValue) || 0) + '.'
    : 'Each of these is the same allowance, not a share of one — ' + mod.EF_HELP_SHARE
      + '% of the fund per party, one allocation at a time (rules 9 and 10). The figures fill in once the fund has a value.' }));
  wrap.appendChild(loanCard);

  wrap.appendChild(el('p', { class: 'hint mf-foot', text:
    `This is the written policy — the Loans tab computes interest from it automatically: CEILING(amount × ${ratePct != null ? ratePct : mod.EF_RATE}% × multiplier, ₹${mod.EF_ROUND_TO}), with the multiplier from rule 6 and the free windows from rules 2, 7 and 9.` }));
  return wrap;
}

// Instalment ledger for a loan — an emergency draw is often repaid across
// several months. Same date+amount shape as buildPayoutEditor.
function buildEfRepayEditor(repayments, onChange) {
  const rowsWrap = el('div', { class: 'hist-rows mf-txn-rows' });
  const summary = el('div', { class: 'mf-txn-summary' });
  const emptyEl = el('div', { class: 'mf-txn-empty', text: 'No repayments logged yet.' });
  const refs = [];
  const refreshSummary = () => {
    const rows = refs.filter((r) => !r.removed);
    const has = rows.length > 0;
    rowsWrap.classList.toggle('hidden', !has);
    summary.classList.toggle('hidden', !has);
    emptyEl.classList.toggle('hidden', has);
    if (has) {
      const total = rows.reduce((s, r) => s + (num(r.amt.value) || 0), 0);
      summary.innerHTML = '';
      summary.appendChild(el('span', { text: rows.length + (rows.length === 1 ? ' instalment' : ' instalments') }));
      summary.appendChild(el('span', { text: 'Repaid ' + fmtCur(total, 'INR') }));
    }
    if (typeof onChange === 'function') setTimeout(onChange, 0);
  };
  const addRow = (date, amount) => {
    const d = el('input', { class: 'txn-date', type: 'date', value: date || todayISO() });
    const amt = el('input', { class: 'txn-amt', type: 'number', inputmode: 'decimal', step: 'any', value: amount != null ? amount : '', placeholder: 'Repaid ₹' });
    const del = el('button', { class: 'icon-btn', type: 'button', text: '×' });
    const ref = { d, amt, removed: false };
    amt.addEventListener('blur', refreshSummary);
    d.addEventListener('change', refreshSummary);
    const row = el('div', { class: 'mf-txn-row' }, [el('div', { class: 'txn-line' }, [d, amt, del])]);
    del.addEventListener('click', () => { row.remove(); ref.removed = true; refreshSummary(); });
    refs.push(ref);
    rowsWrap.appendChild(row);
    refreshSummary();
  };
  (repayments || []).slice().sort((a, b2) => (a.date || '').localeCompare(b2.date || '')).forEach((r) => addRow(r.date, r.amount));
  refreshSummary();
  const lastDate = () => refs.reduce((max, r) => (!r.removed && r.d.value && r.d.value > (max || '')) ? r.d.value : max, null);
  const addBtn = el('button', {
    class: 'icon-btn', type: 'button', text: '+', title: 'Add repayment',
    onclick: () => addRow(lastDate() ? _efAddMonths(lastDate(), 1) : todayISO(), null),
  });
  const node = el('div', {}, [summary, emptyEl, rowsWrap, el('div', { class: 'mf-txn-btn-row' }, [addBtn])]);
  const collect = () => {
    const out = [];
    for (const r of refs) {
      if (r.removed) continue;
      const dv = r.d.value, av = num(r.amt.value);
      if (!dv || !(av > 0)) continue;
      out.push({ date: dv, amount: Math.round(av * 100) / 100 });
    }
    return out.sort((a, b2) => (a.date || '').localeCompare(b2.date || ''));
  };
  return { node, collect };
}
// Local month-add so the editor doesn't need the module loaded just to default a date.
function _efAddMonths(iso, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return todayISO();
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + Number(months || 0), +m[3]));
  return isNaN(d) ? todayISO() : d.toISOString().slice(0, 10);
}

// Keeps the Tracker entries that mirror a loan's repayments in step with it.
//
// Rebuilt wholesale rather than diffed: a repayment can be edited, re-dated or
// removed, and re-deriving the whole set is the only version of this that
// cannot leave an orphan entry behind quietly inflating some month.
//
// Entries carry `efLoanId`, which is what makes them findable — and what stops
// a second save from adding a duplicate instead of replacing.
async function _syncLoanAutoSpends(loan) {
  if (loan == null || loan.id == null) return;
  try {
    const all = (await DB.all('spends').catch(() => [])) || [];
    for (const sp of all) {
      if (sp.efLoanId === loan.id) await DB.del('spends', sp.id).catch(() => {});
    }
    // Only a kitty-loaded emergency draw with a category has anything to
    // mirror. Anything else repays out of the fund's own balance and never
    // touched a month's spending.
    if (loan.loanKind !== 'emergency' || loan.applyTo !== 'kitty' || !loan.category) return;
    const nowIso = new Date().toISOString();
    // Ordered by date so the instalment numbering follows the schedule rather
    // than the order rows happened to be typed in.
    const reps = (loan.repayments || [])
      .filter((rp) => round2(Number(rp.amount) || 0) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(rp.date || '').slice(0, 10)))
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let i = 0; i < reps.length; i++) {
      const rp = reps[i];
      const amt = round2(Number(rp.amount) || 0);
      const d = String(rp.date).slice(0, 10);
      // Kept to one short line: which installment, and what it repaid. The
      // amount is on the row already, but the note is what survives when the
      // entry is read on its own, so it says the figure too.
      const bits = ['Emergency fund ' + (i + 1) + _ordinalSuffix(i + 1) + ' installment - ' + fmtSheetCur(amt) + ' repaid'];
      await DB.put('spends', {
        ym: d.slice(0, 7), date: d, category: loan.category, amount: amt,
        method: 'UPI', cardId: null, note: bits.join(' · '),
        efLoanId: loan.id, createdAt: nowIso, updatedAt: nowIso,
      }).catch(() => {});
    }
  } catch (_) { /* the loan itself is already saved; this is the mirror */ }
}

async function openEfLoanForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const mod = await import('./emergency.js');
  // The rate a NEW loan will be priced at. Read once here so the form quotes
  // one figure throughout, even if the setting is edited elsewhere while this
  // is open.
  const ratePct = await efStoredRate(mod);
  const r = Object.assign({ loanKind: 'self', repayments: [] }, existing || {});

  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });
  const who = el('input', { type: 'text', value: r.who || '', placeholder: 'Who took it' });
  const purpose = el('input', { type: 'text', value: r.purpose || '', placeholder: 'What for' });
  const amount = numInput(r.amount, '₹ lent');
  // Type decides how the loan is priced AND how much of the rest of this form
  // applies, so it goes at the top as a segmented control: all three options
  // visible at once, with the consequence of the chosen one spelled out
  // underneath instead of buried in a dropdown's option text.
  const TYPE_SHORT = { self: 'Self', emergency: 'Emergency', gift: 'Gift' };
  // A loan already carrying a rate is priced at THAT, whatever the fund's rate
  // is now, so the line quotes the loan's own figure — otherwise it would
  // contradict the arithmetic printed in the readout further down.
  const loanRate = (r.rate != null && r.rate !== '') ? (num(r.rate) || ratePct) : ratePct;
  const typeWhy = el('p', { class: 'hint', style: 'margin:6px 0 0' });
  const syncTypeWhy = () => {
    const kind = loanKind.value;
    const label = (mod.EF_KINDS.find(([v]) => v === kind) || [null, 'Loan'])[1];
    const free = mod.EF_FREE_MONTHS[kind] || 0;
    const drifted = Math.abs(loanRate - ratePct) > 0.001
      ? ' The fund now lends at ' + ratePct + '%; this loan keeps the ' + loanRate + '% it was agreed at.'
      : '';
    typeWhy.textContent = (free
      ? label + ' · interest-free for the first ' + free + ' months, then ' + loanRate + '% per 3-month band.'
      : label + ' · priced at ' + loanRate + '% from day one, one more band every 3 months.') + drifted;
  };
  const loanKind = segChoice(
    mod.EF_KINDS.map(([v, l]) => [v, TYPE_SHORT[v] || l]),
    r.loanKind,
    () => { syncTypeWhy(); syncExpected(); syncApplyVisible(); refresh(); });
  const takenDate = el('input', { type: 'date', value: r.takenDate || todayISO() });
  const expectedDate = el('input', { type: 'date', value: r.expectedDate || '' });
  // An emergency draw is interest-free for EF_FREE_MONTHS.emergency months, so
  // the end of that window is the date worth aiming at — repay by then and the
  // draw costs nothing. Filled in when the type is chosen, never overwritten:
  // a date already on the record, or one just typed, is the user's own call.
  const freeWindowEnd = () => {
    const free = mod.EF_FREE_MONTHS[loanKind.value] || 0;
    const from = takenDate.value || todayISO();
    if (!free || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return '';
    const d = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + free, Number(from.slice(8, 10)));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  let expectedTouched = !!r.expectedDate;
  expectedDate.addEventListener('input', () => { expectedTouched = true; });
  const syncExpected = () => {
    if (expectedTouched) return;
    const d = freeWindowEnd();
    if (d) expectedDate.value = d;
  };

  // Where an emergency draw shows up outside this page. 'kitty' adds it to that
  // month's household budget, so the month an emergency happened is not
  // reported as overspending. 'balance' leaves it against the fund alone, for a
  // draw that never became household spending.
  const APPLY_TO = [
    ['kitty', 'Monthly kitty', 'Adds to that month\u2019s household budget'],
    ['balance', 'Balance only', 'Already out of the fund \u2014 nothing added anywhere'],
  ];
  let applyTo = r.applyTo === 'balance' ? 'balance' : 'kitty';
  const applyBtns = [];
  const applyRow = el('div', { class: 'seg ef-apply' }, APPLY_TO.map(([v, label, why]) => {
    const btn = el('button', { type: 'button', class: v === applyTo ? 'active' : '', text: label, title: why });
    btn.addEventListener('click', () => {
      applyTo = v;
      applyBtns.forEach((x) => x.classList.toggle('active', x === btn));
      applyWhy.textContent = why;
    });
    applyBtns.push(btn);
    return btn;
  }));
  const applyWhy = el('p', { class: 'hint ef-apply-why', style: 'margin:5px 0 0',
    text: (APPLY_TO.find(([v]) => v === applyTo) || [])[2] || '' });
  // Only an emergency draw can raise a kitty, so the choice is only offered for
  // one. A self loan or a gift is not household spending and never was.
  const applyBlock = field('Load this against', el('div', {}, [applyRow, applyWhy]));

  // What the draw was spent on. Only asked for a kitty-loaded emergency draw,
  // because it is only there that it matters: the category is what the
  // repayment entries get filed under in the Tracker later.
  const categorySel = el('select', {}, [el('option', { value: '', text: 'Choose a category' })].concat(
    catList('spend').reduce((acc, g) => acc.concat(g.items.map((name) => {
      const o = el('option', { value: name, text: g.group + ' \u2014 ' + name });
      if (name === r.category) o.selected = true;
      return o;
    })), [])));

  // Repayment schedule: one box per month from the month AFTER the draw through
  // the month it is expected back. The draw month itself is excluded — that is
  // the month the money arrived and was spent, not one it is paid back over.
  const planWrap = el('div', { class: 'ef-plan' });
  const planInputs = new Map();
  const planTotalEl = el('span', { class: 'ef-plan-total' });
  const syncPlanTotal = () => {
    let sum = 0;
    planInputs.forEach((inp) => { sum = round2(sum + (num(inp.value) || 0)); });
    const amt = round2(num(amount.value) || 0);
    const diff = round2(amt - sum);
    planTotalEl.textContent = fmtSheetCur(sum) + ' of ' + fmtSheetCur(amt)
      + (Math.abs(diff) < 0.5 ? ' \u00b7 balances' : (diff > 0 ? ' \u00b7 ' + fmtSheetCur(diff) + ' unplanned' : ' \u00b7 ' + fmtSheetCur(-diff) + ' over'));
    planTotalEl.classList.toggle('is-off', Math.abs(diff) >= 0.5);
  };
  // Months between the draw and its expected return, exclusive of the draw's
  // own month. Empty when either date is missing, rather than guessing a span.
  const planMonths = () => {
    const from = takenDate.value, to = expectedDate.value;
    if (!/^\d{4}-\d{2}/.test(from || '') || !/^\d{4}-\d{2}/.test(to || '')) return [];
    const out = [];
    let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)) + 1;
    if (m > 12) { m = 1; y++; }
    const endY = Number(to.slice(0, 4)), endM = Number(to.slice(5, 7));
    // Capped so a mistyped year cannot generate hundreds of boxes.
    while ((y < endY || (y === endY && m <= endM)) && out.length < 24) {
      out.push(y + '-' + String(m).padStart(2, '0'));
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  };
  const rebuildPlan = () => {
    const months = planMonths();
    const existingPlan = new Map((r.plan || []).map((pp) => [String(pp.ym), Number(pp.amount) || 0]));
    // Anything already typed wins over both the record and the even split, so
    // rebuilding after a date change does not wipe work in progress.
    const typed = new Map();
    planInputs.forEach((inp, k) => { if (inp.value !== '') typed.set(k, inp.value); });
    planWrap.innerHTML = '';
    planInputs.clear();
    if (!months.length) {
      planWrap.appendChild(el('p', { class: 'hint', style: 'margin:0', text: 'Set the taken and expected-back dates to plan the repayments.' }));
      planTotalEl.textContent = '';
      return;
    }
    const amt = round2(num(amount.value) || 0);
    const even = amt > 0 ? round2(amt / months.length) : 0;
    months.forEach((k, i) => {
      // The last month absorbs the rounding remainder, so an even split of an
      // amount that does not divide cleanly still adds up to the whole.
      const fallback = amt > 0
        ? (i === months.length - 1 ? round2(amt - even * (months.length - 1)) : even)
        : '';
      const start = typed.has(k) ? typed.get(k)
        : (existingPlan.has(k) ? existingPlan.get(k) : fallback);
      const inp = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: start === '' ? '' : start });
      inp.addEventListener('input', syncPlanTotal);
      planInputs.set(k, inp);
      planWrap.appendChild(el('label', { class: 'ef-plan-cell' }, [
        el('span', { class: 'ef-plan-mon', text: _spendMonthLabel(k) }),
        inp,
      ]));
    });
    syncPlanTotal();
  };
  const collectPlan = () => {
    const out = [];
    planInputs.forEach((inp, k) => {
      const v = round2(num(inp.value) || 0);
      if (v > 0) out.push({ ym: k, amount: v });
    });
    return out.sort((a, b) => a.ym.localeCompare(b.ym));
  };

  const planBlock = field('Repayment plan', el('div', {}, [
    el('p', { class: 'hint', style: 'margin:0 0 7px', text: 'Each of these months has its kitty reduced by the amount below, until that repayment is recorded.' }),
    planWrap,
    el('div', { class: 'ef-plan-foot' }, [planTotalEl]),
  ]));
  const categoryBlock = field('Spent on', el('div', {}, [
    categorySel,
    el('p', { class: 'hint', style: 'margin:5px 0 0', text: 'Repayments you record get logged in the Tracker under this category.' }),
  ]));
  // Built here, with the blocks it wraps, because the visibility sync runs
  // while the form is still being assembled and needs it to exist already.
  const emergencySec = formSection('🚨', 'Emergency draw', [applyBlock, categoryBlock, planBlock]);


  // No rate or interest box here any more: the rate is one fund-wide setting
  // (edited on the Loans tab) and gets stamped onto the record below, so there
  // is nothing per-loan left to type. A figure entered by hand on an older
  // record is still honoured and still carried through a save — the readout
  // says so when it is in play.
  const interestPaid = numInput(r.interestPaid, '₹ interest collected');
  // What gets written here is the terms agreed out loud - who asked, what was
  // said about paying it back - so it gets a panel that expects a sentence or
  // two rather than a one-line box that hid everything past the right edge.
  const noteBox = noteField(r.note,
    'What was agreed — the terms, who asked, anything worth remembering later',
    'Shows under the loan on the Loans tab.');
  const note = noteBox.input;

  const closedChk = el('input', { type: 'checkbox' });
  closedChk.checked = !!r.closedDate;
  const closedSwitch = el('label', { class: 'switch' }, [closedChk, el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })])]);
  const closedDate = el('input', { type: 'date', value: r.closedDate || todayISO() });
  const closedBlock = el('div', { class: 'sold-only' + (closedChk.checked ? '' : ' hidden') }, [field('Settled on', closedDate)]);
  closedChk.addEventListener('change', () => { closedBlock.classList.toggle('hidden', !closedChk.checked); refresh(); });

  const syncApplyVisible = () => {
    const isEmergency = loanKind.value === 'emergency';
    // The whole section goes, heading included - an empty "Emergency draw"
    // header over nothing reads as something failing to load.
    emergencySec.classList.toggle('hidden', !isEmergency);
    applyBlock.classList.toggle('hidden', !isEmergency);
    const onKitty = isEmergency && applyTo === 'kitty';
    categoryBlock.classList.toggle('hidden', !onKitty);
    planBlock.classList.toggle('hidden', !onKitty);
    if (onKitty) rebuildPlan();
  };
  applyBtns.forEach((b) => b.addEventListener('click', syncApplyVisible));
  takenDate.addEventListener('change', () => { syncExpected(); rebuildPlan(); });
  expectedDate.addEventListener('change', rebuildPlan);
  amount.addEventListener('input', syncPlanTotal);
  syncApplyVisible();
  syncTypeWhy();
  // Fill the date on OPEN too, so adding an emergency draw needs no extra taps.
  syncExpected();

  const repayEditor = buildEfRepayEditor(r.repayments, () => refresh());

  const buildRec = () => ({
    kind: 'loan',
    loanKind: loanKind.value,
    who: who.value.trim(),
    purpose: purpose.value.trim(),
    amount: num(amount.value) || 0,
    takenDate: takenDate.value || null,
    expectedDate: expectedDate.value || null,
    // Only meaningful on an emergency draw; stored as null elsewhere so the
    // record never implies a choice that was not offered.
    applyTo: loanKind.value === 'emergency' ? applyTo : null,
    // Both only mean anything for a kitty-loaded emergency draw. Cleared
    // otherwise, so switching type does not leave a schedule behind still
    // quietly reducing months.
    category: (loanKind.value === 'emergency' && applyTo === 'kitty') ? (categorySel.value || null) : null,
    plan: (loanKind.value === 'emergency' && applyTo === 'kitty') ? collectPlan() : [],
    // Gate on the checkbox, not on the date having a value — the date defaults to
    // today, so unticking must be what clears it.
    closedDate: closedChk.checked ? (closedDate.value || todayISO()) : null,
    // The rate is STAMPED onto the loan rather than read live, so changing the
    // fund's rate prices new loans and leaves ones already agreed alone. A loan
    // that already carries a rate keeps it; one saved before the rate became a
    // setting picks up the current figure the next time it is saved.
    rate: (r.rate != null && r.rate !== '') ? num(r.rate) : ratePct,
    // Kept, not cleared: the box is gone, but an older record that had its
    // interest typed in by hand should not be silently re-priced by the rule.
    interestOverride: (r.interestOverride != null && r.interestOverride !== '') ? num(r.interestOverride) : null,
    interestPaid: interestPaid.value !== '' ? num(interestPaid.value) : null,
    repayments: repayEditor.collect(),
    note: note.value.trim(),
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const readout = el('div', { class: 'mf-bench-readout' });
  const refresh = () => {
    readout.innerHTML = '';
    const rec = buildRec();
    const c = mod.computeLoan(rec, Date.now(), ratePct);
    readout.appendChild(el('div', { class: 'mf-bench-now' }, [
      el('span', {}, ['Outstanding ', b(fmtIntCur(c.outstanding))]),
      el('span', {}, [c.isClosed ? 'Interest ' : 'If repaid on time ', b(fmtIntCur(c.interest))]),
      // Elapsed of term, and the band the figure to its left is priced at.
      el('span', {}, [(c.isClosed || c.plannedMonths == null
        ? c.monthsElapsed + 'm'
        : c.monthsElapsed + '/' + c.plannedMonths + 'm') + ' · ',
        b((c.isClosed ? c.multiplier : c.quotedMultiplier) + '×')]),
    ]));
    // The interest is DERIVED, so show the arithmetic — a wrong date silently
    // changes the band, and that's invisible otherwise.
    if (c.isFree) {
      readout.appendChild(el('p', { class: 'hint', text:
        `Interest-free for the first ${c.freeMonths} months` + (c.isClosed ? ' — settled inside that window.' : ` · ${c.freeMonthsLeft} month${c.freeMonthsLeft === 1 ? '' : 's'} left before interest starts.`) }));
    } else if (!c.isOverridden && rec.amount > 0) {
      const rt = c.rate;
      // Priced over the months the QUOTED figure covers - the term for an open
      // loan, how long it ran for a settled one. Using elapsed months here
      // printed arithmetic that did not come to the number above it: a loan
      // taken this month for six showed "x 1 (0 months)" beside a figure
      // charged at a 2x band.
      const mult = c.isClosed ? c.multiplier : c.quotedMultiplier;
      const mos = c.isClosed ? c.monthsElapsed : c.quotedMonths;
      readout.appendChild(el('p', { class: 'hint', text:
        `${fmtIntCur(rec.amount)} × ${rt}% × ${mult} (${mos} month${mos === 1 ? '' : 's'}${c.isClosed ? '' : ' to the expected date'}) = ${fmtIntCur(rec.amount * (rt / 100) * mult)}, rounded up to ${fmtIntCur(c.interest)}.` }));
    }
    if (c.isOverridden) readout.appendChild(el('p', { class: 'hint warn', text: 'This loan has an interest figure entered by hand, so the rule above is not applied to it.' }));
    if (c.overdue) readout.appendChild(el('p', { class: 'hint warn', text: 'Past its expected return date.' }));
    if (!c.isClosed && !c.isFree) {
      // Measured from the quoted months, so it reads as the next step UP from
      // the price shown rather than from a band already passed.
      const nextBand = (Math.floor(c.quotedMonths / 3) + 1) * 3;
      readout.appendChild(el('p', { class: 'hint', text: `Held past ${nextBand} months and it moves to a ${c.quotedMultiplier + 1}× band.` }));
    }
  };
  [amount, takenDate, expectedDate, interestPaid, closedDate].forEach((i) => i.addEventListener('input', refresh));
  refresh();

  const del = async () => {
    if (!(await appConfirm('Delete this loan? This cannot be undone.'))) return;
    // Clear the mirrored Tracker entries first. Doing it after the delete would
    // work too, but a failure between the two would leave repayment entries
    // pointing at a loan that no longer exists.
    await _syncLoanAutoSpends({ id: r.id, loanKind: null });
    await DB.del('emergency', r.id); closeModal(); toast('Loan deleted'); renderEmergency();
  };
  const save = async () => {
    if (!who.value.trim()) { toast('Who took it?'); return; }
    if (!(num(amount.value) > 0)) { toast('Enter the amount lent'); return; }
    if (!takenDate.value) { toast('Enter the date it was taken'); return; }
    // A plan totalling more than was borrowed would reduce those months by
    // money that never arrived — so it is refused, not merely flagged. Planning
    // LESS is fine: the rest may simply not be scheduled yet.
    if (loanKind.value === 'emergency' && applyTo === 'kitty') {
      const planned = round2(collectPlan().reduce((a, pp) => a + pp.amount, 0));
      const lent = round2(num(amount.value) || 0);
      if (planned - lent > 0.5) {
        toast('Plan is ' + fmtSheetCur(round2(planned - lent)) + ' more than the ' + fmtSheetCur(lent) + ' lent');
        return;
      }
    }
    const rec = buildRec();
    if (isEdit) rec.id = r.id;
    const key = await DB.put('emergency', rec);
    // A new loan has no id until it is written, and the mirrored entries need
    // one to point at.
    await _syncLoanAutoSpends(Object.assign({}, rec, { id: rec.id != null ? rec.id : key }));
    closeModal(); toast(isEdit ? 'Loan updated' : 'Loan added'); renderEmergency();
  };

  // Grouped rather than stacked: what the loan is, the emergency-only extras,
  // what it costs, whether it is done. Read top to bottom it now follows the
  // life of the loan instead of the order the fields happened to be added in.
  const detailsContent = el('div', { class: 'form-secs' }, [
    formSection('🤝', 'The loan', [
      field('Type', el('div', {}, [loanKind.node, typeWhy])),
      el('div', { class: 'field-row' }, [field('Who', who), field('Amount (₹)', amount)]),
      field('Purpose', purpose),
      el('div', { class: 'field-row' }, [field('Taken on', takenDate), field('Expected back', expectedDate)]),
    ]),
    emergencySec,
    formSection('🧮', 'Interest', [readout]),
    // Interest collected and whether it is settled are the same question asked
    // twice, so they share a row; the note then sits directly under them,
    // because what was agreed is part of how the loan ends.
    formSection('✅', 'Settlement', [
      el('div', { class: 'field-row' }, [field('Interest collected (₹)', interestPaid), field('Settled', closedSwitch)]),
      closedBlock,
      noteBox.node,
    ]),
  ]);
  // The schedule, against what has actually been repaid in each of its months.
  // Rebuilt whenever the tab is opened, since both the plan and the repayments
  // can have changed on the other tab since it was last looked at.
  const schedule = el('div', { class: 'ef-sched' });
  const rebuildSchedule = () => {
    schedule.innerHTML = '';
    const plan = collectPlan();
    if (!plan.length || loanKind.value !== 'emergency' || applyTo !== 'kitty') {
      schedule.classList.add('hidden');
      return;
    }
    schedule.classList.remove('hidden');
    const reps = repayEditor.collect();
    const repaidIn = (k) => round2((reps || []).reduce((a, rp) => (String(rp.date || '').slice(0, 7) === k ? a + (Number(rp.amount) || 0) : a), 0));
    schedule.appendChild(el('div', { class: 'ef-sched-head', text: 'Planned against repaid' }));
    plan.forEach((pp) => {
      const got = repaidIn(pp.ym);
      const left = round2(pp.amount - got);
      const done = left <= 0.5;
      schedule.appendChild(el('div', { class: 'ef-sched-row' + (done ? ' is-done' : '') }, [
        el('span', { class: 'ef-sched-mon', text: _spendMonthLabel(pp.ym) }),
        el('span', { class: 'ef-sched-plan', text: fmtSheetCur(pp.amount) }),
        el('span', { class: 'ef-sched-got', text: done ? 'repaid' : fmtSheetCur(got) + ' in' }),
        el('span', { class: 'ef-sched-left', text: done ? '✓' : fmtSheetCur(left) + ' to go' }),
      ]));
    });
  };

  const repayContent = el('div', { class: 'hidden' }, [
    el('p', { class: 'hint', text: 'Log each repayment. Once they cover the amount lent, the loan counts as settled and its interest stops climbing bands. A repayment on a kitty-loaded emergency draw is also logged in the Tracker, under the category on the Details tab.' }),
    schedule,
    repayEditor.node,
  ]);
  const detailsTabBtn = el('button', { class: 'active', type: 'button', text: 'Details' });
  const repayTabBtn = el('button', { type: 'button', text: 'Repayments' });
  const tabs = [{ btn: detailsTabBtn, content: detailsContent }, { btn: repayTabBtn, content: repayContent }];
  const showTab = (w) => tabs.forEach((t) => { const on = t === w; t.btn.classList.toggle('active', on); t.content.classList.toggle('hidden', !on); });
  detailsTabBtn.addEventListener('click', () => showTab(tabs[0]));
  repayTabBtn.addEventListener('click', () => { showTab(tabs[1]); rebuildSchedule(); refresh(); });

  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: isEdit ? (r.purpose || 'Edit loan') : 'Add loan' }),
      el('div', { class: 'seg' }, [detailsTabBtn, repayTabBtn]),
      detailsContent, repayContent,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}

async function openEfContribForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const r = Object.assign({}, existing || {});
  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });
  const date = el('input', { type: 'date', value: r.date || todayISO() });
  // 'equal' (working couple): the spouse's figure always follows mine. 'custom': never mirrored. Unset: as before.
  const splitRow = await DB.get('meta', 'efSplitMode').catch(() => null);
  const splitMode = splitRow && splitRow.value;
  const mine = numInput(r.mine, '₹ mine');
  const spouse = numInput(r.spouse, '₹ spouse');
  const note = el('input', { type: 'text', value: r.note || '', placeholder: 'Note (optional)' });
  const total = el('p', { class: 'hint' });
  const refresh = () => {
    const t = (num(mine.value) || 0) + (num(spouse.value) || 0);
    total.textContent = t > 0 ? 'Total for this month: ' + fmtIntCur(t) : '';
  };
  // Both sides pay the same amount, so mirror it — saves typing the same number
  // twice every month, and it's still editable when a month differs.
  mine.addEventListener('input', () => {
    const mirror = splitMode === 'equal' ? true : splitMode === 'custom' ? false : (!isEdit || !spouse.value);
    if (mirror) spouse.value = mine.value;
    refresh();
  });
  spouse.addEventListener('input', refresh);
  refresh();

  const del = async () => {
    if (!(await appConfirm('Delete this contribution?'))) return;
    await DB.del('emergency', r.id); closeModal(); toast('Contribution deleted'); renderEmergency();
  };
  const save = async () => {
    if (!date.value) { toast('Pick a month'); return; }
    const m = num(mine.value) || 0, s = num(spouse.value) || 0;
    if (!(m + s > 0)) { toast('Enter an amount'); return; }
    const rec = { kind: 'contribution', date: date.value, mine: m, spouse: s, note: note.value.trim(),
      createdAt: r.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (isEdit) rec.id = r.id;
    await DB.put('emergency', rec); closeModal(); toast(isEdit ? 'Contribution updated' : 'Contribution logged'); renderEmergency();
  };
  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: isEdit ? 'Edit contribution' : 'Log contribution' }),
      field('Month', date),
      el('div', { class: 'field-row' }, [field('Mine (₹)', mine), field('Spouse (₹)', spouse)]),
      // The spouse's share is optional; if it is used, equal shares are what the fund's rules recommend.
      el('p', { class: 'hint ef-equal-tip', text: splitMode === 'equal'
        ? '✓ Equal contribution is on: your spouse’s box follows yours. Every penny stays accountable between you.'
        : 'We recommend equal contributions. Every penny should be accountable between the two of you.' }),
      field('Note', note),
      total,
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}

async function openEfTargetForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const mod = await import('./emergency.js');
  const r = Object.assign({ ladder: 'add' }, existing || {});
  const name = el('input', { type: 'text', value: r.name || '', placeholder: 'Target name' });
  const amount = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: r.amount != null && r.amount !== '' ? r.amount : '', placeholder: '₹ target' });
  const order = el('input', { type: 'number', inputmode: 'numeric', step: '1', value: r.order != null && r.order !== '' ? r.order : '', placeholder: 'Rung (1 = first)' });
  const ladder = el('select', {}, mod.EF_LADDER.map(([v, l]) => { const o = el('option', { value: v, text: l }); if (v === r.ladder) o.selected = true; return o; }));
  const expectedClosure = el('input', { type: 'text', value: r.expectedClosure || '', placeholder: 'e.g. Jul 26 (optional)' });
  const note = el('input', { type: 'text', value: r.note || '', placeholder: 'Note (optional)' });

  const del = async () => {
    if (!(await appConfirm('Delete this target?'))) return;
    await DB.del('emergency', r.id); closeModal(); toast('Target deleted'); renderEmergency();
  };
  const save = async () => {
    if (!name.value.trim()) { toast('Enter the target name'); return; }
    if (!(num(amount.value) > 0)) { toast('Enter the target amount'); return; }
    const rec = { kind: 'target', name: name.value.trim(), amount: num(amount.value) || 0,
      ladder: ladder.value, order: num(order.value) || 0,
      expectedClosure: expectedClosure.value.trim(), note: note.value.trim(),
      createdAt: r.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (isEdit) rec.id = r.id;
    await DB.put('emergency', rec); closeModal(); toast(isEdit ? 'Target updated' : 'Target added'); renderEmergency();
  };
  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, [
      el('h2', { text: isEdit ? (r.name || 'Edit target') : 'Add target' }),
      field('Name', name),
      el('div', { class: 'field-row' }, [field('Amount (₹)', amount), field('Order in the ladder', order)]),
      field('How it counts', ladder, 'ladder'),
      el('p', { class: 'hint', text: '"Replaces the previous" is for a target that supersedes the one below it rather than adding to it — e.g. a joint fund that already covers the single-person one beneath it. Use "Adds on top" when the goal genuinely stacks.' }),
      el('div', { class: 'field-row' }, [field('Expected by', expectedClosure), field('Note', note)]),
    ]),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}

// The + FAB is tab-aware: on Fund it adds a target, on Loans a loan, on Log a
// contribution — so the obvious action for whatever you're looking at is one tap.
export function efAddForTab() {
  if (_efTab === 'loans') return openEfLoanForm(null);
  if (_efTab === 'log') return openEfContribForm(null);
  return openEfTargetForm(null);
}
