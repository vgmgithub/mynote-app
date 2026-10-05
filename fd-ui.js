import { DB } from './db.js';
import { todayISO, num, fmtCur, fmtIntRate, pctClass, fmtPct } from './core.js';
import { ui } from './state.js';
import { _mfValueCard } from './mf-ui.js';
import { el, field, toast, closeModal, appConfirm, openModal, formSection, b, state, $, explainRow, updateFdNavActive, refresh, modOn, _modsCache, isSgb, metalPortfolio, _gramsShort, includedStockProfiles } from './app.js';
import { _homeUpcomingStrip } from './home-ui.js';
import { _FD_MONS, _fdMonthLabel, fmtIntCur } from './personal-ui.js';

export async function renderFD() {
  const host = $('#fdView');
  host.innerHTML = '';
  const mod = await import('./fd.js');
  const fds = (await DB.byIndex('fds', 'owner', 'me')) || [];
  const now = Date.now();
  // resolveChain folds each FD's mapped parent maturity value into its effective
  // deposit (principal = fresh only). One shared cache memoizes the whole tree.
  const fdByIdR = new Map(fds.map((x) => [x.id, x]));
  const rCache = new Map();
  const rows = fds.map((f) => ({ f, c: mod.resolveChain(f, fdByIdR, now, rCache) }));
  updateFdNavActive();

  // No FDs → simple empty state (tabs would be pointless).
  if (!fds.length) {
    host.appendChild(el('section', { class: 'summary' }, [
      el('div', { class: 'label', text: 'Fixed Deposits' }),
      el('div', { class: 'big', text: fmtCur(0, 'INR') }),
    ]));
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🏦' }),
      el('p', { text: 'No fixed deposits yet.' }),
      el('p', { class: 'hint', text: 'Tap + to add your first FD — bank, amount, rate, start & maturity dates.' }),
    ]));
    return;
  }

  // Reinvestment-chain lookups (parentFdIds links) - for card badges + supersede.
  // A new FD can merge several matured FDs, so each parent id maps to the one FD
  // that consumed it.
  const fdByIdAll = new Map(rows.map(({ f }) => [f.id, f]));
  const childByParent = new Map();
  rows.forEach(({ f }) => { mod.parentIdsOf(f).forEach((pid) => childByParent.set(pid, f)); });
  const chainOf = (f) => ({
    parents: mod.parentIdsOf(f).map((pid) => fdByIdAll.get(pid)).filter(Boolean),
    child: childByParent.get(f.id) || null,
  });

  // A matured FD is "superseded" once the FD reinvested from it (its child) has
  // ALSO matured - the newer matured FD then telescopes its principal+interest.
  // Superseded matured FDs are hidden from the holdings list (kept in the data +
  // visible in the Chain tab), so the matured list shows only the latest matured
  // link per chain and can't grow unbounded as the ladder loops. Active FDs are
  // never superseded.
  const supersededIds = new Set();
  rows.forEach(({ f, c }) => { if (c.effectiveStatus === 'matured') mod.parentIdsOf(f).forEach((pid) => supersededIds.add(pid)); });
  const activeRows = rows.filter(({ c }) => c.effectiveStatus === 'active');
  const maturedVisible = rows.filter(({ f, c }) => c.effectiveStatus === 'matured' && !supersededIds.has(f.id));
  const visibleRows = rows.filter(({ f, c }) => c.effectiveStatus === 'active' || !supersededIds.has(f.id));
  let list = ui._fdFilter === 'active' ? activeRows.slice() : ui._fdFilter === 'matured' ? maturedVisible.slice() : visibleRows.slice();

  // Totals over active FDs (the live ladder). With principal = fresh money only,
  // each active FD splits into fresh (out-of-pocket) + rolledIn (recycled from a
  // matured parent); effective principal = fresh + rolledIn.
  let totEff = 0, totFresh = 0, totRolled = 0, totCurVal = 0, totInterest = 0, monthlyIncome = 0;
  activeRows.forEach(({ f, c }) => {
    if (f.emergencyFund) return;  // owned by the Emergency Fund surface
    totEff += c.principal; totFresh += c.freshPrincipal; totRolled += c.rolledIn;
    totCurVal += c.currentValue; totInterest += c.totalInterest; monthlyIncome += c.monthlyIncome;
  });
  const totInv = totEff;   // used by the Overview allocation-by-bank below
  // Simple total return: Interest to earn ÷ effective invested. NOT annualized - a
  // ladder with longer-tenure FDs reads higher here even at the same bank rate,
  // since it's total interest over each FD's own remaining life, not per year.
  const returnPct = totEff > 0 ? (totInterest / totEff) * 100 : 0;
  // Realized interest from matured FDs (non-superseded only - the latest matured
  // link per chain, so recycled money isn't counted twice as the ladder loops).
  let interestMatured = 0, maturedInvested = 0;
  maturedVisible.forEach(({ f, c }) => { if (f.emergencyFund) return; interestMatured += c.totalInterest; maturedInvested += c.principal; });
  const maturedReturnPct = maturedInvested > 0 ? (interestMatured / maturedInvested) * 100 : 0;
  // What became of what matured: rolled back into the ladder vs taken out as cash - the natural third
  // fact to sit beside "how much matured" and "what it earned", and it's what balances that row instead
  // of leaving the Reinvested tile visibly shorter than its two neighbours.
  const maturedPayout = maturedInvested + interestMatured;
  const reinvestRate = maturedPayout > 0 ? (totRolled / maturedPayout) * 100 : 0;

  const holdContent = el('div', { class: 'tab-content' + (ui._fdTab === 'holdings' ? '' : ' hidden') });
  const ovrvContent = el('div', { class: 'tab-content' + (ui._fdTab === 'overview' ? '' : ' hidden') });
  const ladderContent = el('div', { class: 'tab-content' + (ui._fdTab === 'ladder' ? '' : ' hidden') });

  // Summary card (shared by Holdings + Overview; hidden on Ladder).
  const summarySec = el('section', { class: 'summary fd-summary' + (ui._fdTab === 'ladder' ? ' hidden' : '') }, [
    el('div', { class: 'row-between summary-top' }, [
      el('div', {}, [
        el('div', { class: 'label', text: 'Total invested value' }),
        el('div', { class: 'fd-big-row' }, [
          el('div', { class: 'big', text: fmtCur(totEff, 'INR') }),
          el('span', { class: 'fd-active-badge', text: activeRows.length + ' ACTIVE' }),
        ]),
        el('div', { class: 'fd-subline', text: 'Fresh invested ' + fmtCur(totFresh, 'INR') }),
      ]),
      el('div', { class: 'summary-earned' }, [
        el('div', { class: 'label', text: 'Active FD interest' }),
        el('div', { class: 'v pos', text: fmtIntCur(totInterest) }),
        el('div', { class: 'fd-subline', text: returnPct ? fmtIntRate(returnPct) + ' return' : '—' }),
      ]),
    ]),
    // Matured -> Interest matured -> Reinvested reads as one story (what came due, what it earned, how
    // much of that went back into the ladder), each tinted by role and each carrying its own second
    // line so the row lands even instead of the last tile trailing off shorter than the other two.
    // The second line of each tile now sits as a badge in its top-right corner (FD count, return %, share
    // rolled over), so the three tiles are one line shorter and still even.
    el('div', { class: 'fd-stat-row' }, [
      el('div', { class: 'fd-stat is-neutral' }, [
        el('div', { class: 'fd-stat-head' }, [
          el('div', { class: 'k fd-k-tiered' }, [el('span', { class: 'fd-k-pre', text: 'Matured' }), el('span', { class: 'fd-k-main', text: 'Principal' })]),
          el('span', { class: 'fd-stat-badge is-count', text: maturedVisible.length + (maturedVisible.length === 1 ? ' FD' : ' FDs') }),
        ]),
        el('div', { class: 'v', text: fmtCur(maturedInvested, 'INR') }),
      ]),
      el('div', { class: 'fd-stat is-good' }, [
        el('div', { class: 'fd-stat-head' }, [
          el('div', { class: 'k fd-k-tiered' }, [el('span', { class: 'fd-k-pre', text: 'Matured' }), el('span', { class: 'fd-k-main', text: 'Interest' })]),
          maturedReturnPct ? el('span', { class: 'fd-stat-badge is-good', title: 'Return on the matured principal', text: fmtIntRate(maturedReturnPct) }) : null,
        ].filter(Boolean)),
        el('div', { class: 'v pos', text: fmtIntCur(interestMatured) }),
      ]),
      el('div', { class: 'fd-stat is-accent' }, [
        el('div', { class: 'fd-stat-head' }, [
          el('div', { class: 'k fd-k-tiered' }, [el('span', { class: 'fd-k-pre', text: 'Reinvested' }), el('span', { class: 'fd-k-main', text: 'FD Rollover' })]),
          reinvestRate ? el('span', { class: 'fd-stat-badge is-accent', title: 'Share of matured payouts rolled into a new FD', text: Math.round(reinvestRate) + '%' }) : null,
        ].filter(Boolean)),
        el('div', { class: 'v', text: fmtCur(totRolled, 'INR') }),
      ]),
    ]),
  ]);

  // ---- Holdings tab: filter + sort + card list ----
  const filterSeg = el('div', { class: 'seg' }, [['active', `Active (${activeRows.length})`], ['matured', `Matured (${maturedVisible.length})`], ['all', `All (${visibleRows.length})`]].map(([v, l]) =>
    el('button', { class: (ui._fdFilter === v ? 'active' : ''), type: 'button', text: l, onclick: () => { ui._fdFilter = v; renderFD(); } })));
  // Short chips on the right of the filter, the same control Mutual Funds uses. Each opens in its natural
  // order (Maturity soonest first, Amount and Rate highest first); tapping the same chip again reverses it.
  const FD_SORTS = [['maturity', 'Maturity', 'asc'], ['principal', 'Amount', 'desc'], ['rate', 'Rate', 'desc']];
  if (!ui._fdSortDir) ui._fdSortDir = (FD_SORTS.find(([v]) => v === ui._fdSort) || FD_SORTS[0])[2];
  const sortbar = el('div', { class: 'mf-sort-chips' }, FD_SORTS.map(([v, l, first]) => {
    const on = ui._fdSort === v;
    return el('button', { class: 'mf-sort-chip' + (on ? ' active' : ''), type: 'button', title: 'Sort by ' + l,
      'aria-label': 'Sort by ' + l + (on ? (ui._fdSortDir === 'asc' ? ', ascending' : ', descending') : ''),
      text: l + (on ? (ui._fdSortDir === 'asc' ? ' ↑' : ' ↓') : ''),
      onclick: () => {
        if (ui._fdSort === v) ui._fdSortDir = ui._fdSortDir === 'asc' ? 'desc' : 'asc';
        else { ui._fdSort = v; ui._fdSortDir = first; }
        renderFD();
      } });
  }));
  holdContent.appendChild(el('div', { class: 'mf-toolbar-row' }, [filterSeg, sortbar]));

  if (!list.length) {
    holdContent.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '🏦' }), el('p', { text: 'Nothing here.' })]));
  } else {
    const dir = ui._fdSortDir === 'desc' ? -1 : 1;
    list.sort((a, b2) => {
      if (ui._fdSort === 'principal') return dir * (a.c.principal - b2.c.principal);
      if (ui._fdSort === 'rate') return dir * (a.c.rate - b2.c.rate);
      if (ui._fdSort === 'bank') return dir * (a.f.bank || '').localeCompare(b2.f.bank || '');
      // An FD with no maturity date always sorts last, whichever way round.
      const am = a.c.maturity ? Date.parse(a.c.maturity) : null, bm = b2.c.maturity ? Date.parse(b2.c.maturity) : null;
      if (am == null || bm == null) return am === bm ? 0 : am == null ? 1 : -1;
      return dir * (am - bm);
    });
    const wrap = el('section', { class: 'stock-list' });
    list.forEach(({ f, c }) => wrap.appendChild(_fdCard(f, c, chainOf(f))));
    holdContent.appendChild(wrap);
  }
  holdContent.appendChild(explainRow('About these FDs', 'Cumulative FDs compound (quarterly by default); payout FDs return principal at maturity with interest paid out along the way. Matured FDs reinvested into a newer FD that has since also matured are hidden here (still in the chain). Not financial advice.', 'How interest is worked out'));

  // ---- Overview tab: allocation by bank + income potential + next maturity ----
  const byBank = {};
  activeRows.forEach(({ f, c }) => { if (f.emergencyFund) return; const k = f.bank || 'Other'; byBank[k] = (byBank[k] || 0) + c.principal; });
  const banks = Object.keys(byBank).sort((a, b2) => byBank[b2] - byBank[a]);
  if (banks.length && totInv > 0) {
    const alloc = el('div', { class: 'chart-card' }, [el('h3', { text: 'Invested by bank' })]);
    banks.forEach((bk) => {
      const pct = (byBank[bk] / totInv) * 100;
      alloc.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: bk }),
        el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: `width:${Math.max(2, pct).toFixed(1)}%` })]),
        el('span', { class: 'bn', text: pct.toFixed(2) + '%' }),
      ]));
    });
    ovrvContent.appendChild(alloc);
  }
  ovrvContent.appendChild(el('div', { class: 'chart-card' }, [
    el('h3', { text: 'Interest income potential' }),
    el('div', { class: 'mf-goal-meta', text: `≈ ${fmtIntCur(monthlyIncome)} / month · ${fmtIntCur(monthlyIncome * 12)} / year` }),
    el('p', { class: 'hint', text: 'Average interest thrown off by your active FDs over their tenure (payout FDs use their actual periodic interest).' }),
  ]));
  const upcoming = activeRows.filter(({ f, c }) => !f.emergencyFund && c.daysToMaturity != null).sort((a, b2) => a.c.daysToMaturity - b2.c.daysToMaturity)[0];
  if (upcoming) {
    ovrvContent.appendChild(el('div', { class: 'chart-card' }, [
      el('h3', { text: 'Next maturity' }),
      el('div', { class: 'mf-goal-meta', text: `${upcoming.f.bank || 'FD'} — ${fmtCur(upcoming.c.maturityValue, 'INR')} on ${upcoming.c.maturity} (${upcoming.c.daysToMaturity} days)` }),
    ]));
  }

  // ---- Ladder tab: ACTIVE FDs only, in upcoming-maturity order ----
  // Matured FDs have already paid out and are done, so they'd just be clutter on
  // a forward-looking "what's coming due" view - the Holdings/Matured filter and
  // Chain tab are where matured history lives.
  const ladderRows = rows.filter(({ f, c }) => !f.emergencyFund && c.maturity && c.effectiveStatus === 'active').sort((a, b2) => Date.parse(a.c.maturity) - Date.parse(b2.c.maturity));
  if (!ladderRows.length) {
    ladderContent.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '🪜' }), el('p', { text: 'No upcoming maturities. Add an active FD with a maturity date to see your ladder.' })]));
  } else {
    ladderContent.appendChild(explainRow('About the ladder', 'Your upcoming maturities, in order — the rungs of the ladder. A gap month means no FD matures then (no interest landing that month), so you can plug it. Tap a rung to edit.', 'How the rungs are read'));
    const wrap = el('div', { class: 'fd-ladder' });
    const mkey = (iso) => (iso || '').slice(0, 7);   // YYYY-MM
    const byMonth = {};
    ladderRows.forEach((r) => { const k = mkey(r.c.maturity); (byMonth[k] = byMonth[k] || []).push(r); });
    const rung = ({ f, c }) => {
      const sub = `${fmtCur(c.principal, 'INR')} @ ${fmtIntRate(c.rate)}` + (c.daysToMaturity >= 0 ? ` · ${c.daysToMaturity}d left` : ' · due');
      return el('div', { class: 'card fd-ladder-row', onclick: () => openFdForm(f) }, [
        el('div', { class: 'fd-ladder-date' }, [
          el('div', { class: 'fd-ladder-mon', text: _fdMonthLabel(c.maturity) }),
          el('div', { class: 'fd-ladder-yr', text: (c.maturity || '').slice(0, 4) }),
        ]),
        el('div', { class: 'fd-ladder-body' }, [
          el('div', { class: 'name', text: f.bank || 'FD' }),
          el('div', { class: 'cat', text: sub }),
        ]),
        // Green badge shows the INTEREST landing at this maturity (the point of the
        // ladder) - the principal is already on the sub-line above.
        el('div', { class: 'fd-ladder-val' }, [el('span', { class: 'mf-value-card positive', text: '+' + fmtIntCur(c.totalInterest) })]),
      ]);
    };
    const gapRung = (k) => el('div', { class: 'card fd-ladder-row fd-ladder-gap' }, [
      el('div', { class: 'fd-ladder-date' }, [
        el('div', { class: 'fd-ladder-mon', text: _FD_MONS[+k.slice(5, 7) - 1] }),
        el('div', { class: 'fd-ladder-yr', text: k.slice(0, 4) }),
      ]),
      el('div', { class: 'fd-ladder-body' }, [
        el('div', { class: 'name', text: 'No maturity' }),
        el('div', { class: 'cat', text: 'No FD maturing this month' }),
      ]),
    ]);
    // Walk every month from the first rung to the last; a month with no maturing
    // FD gets a gap card so the missing interest-landing is visible (the whole
    // point of a ladder is every month having something mature). Guard caps the
    // walk at 600 months so a bad date can't spin forever.
    let [y, m] = mkey(ladderRows[0].c.maturity).split('-').map(Number);
    const [ey, em] = mkey(ladderRows[ladderRows.length - 1].c.maturity).split('-').map(Number);
    let guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 600) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (byMonth[k]) byMonth[k].forEach((r) => wrap.appendChild(rung(r)));
      else wrap.appendChild(gapRung(k));
      m++; if (m > 12) { m = 1; y++; }
    }
    ladderContent.appendChild(wrap);
  }

  host.appendChild(summarySec);
  host.appendChild(holdContent);
  host.appendChild(ovrvContent);
  host.appendChild(ladderContent);
}

function _fdCard(f, c, chain) {
  const statusBadge = c.effectiveStatus === 'active'
    ? el('span', { class: 'badge good mf-beat', text: 'active' })
    : el('span', { class: 'badge good mf-beat fd-matured-badge', text: 'matured' });
  const catLine = el('div', { class: 'cat mf-catline' }, [`${fmtIntRate(c.rate)} · ${c.comp}` + (c.payout ? ' · payout' : '')]);
  catLine.appendChild(statusBadge);
  if (f.emergencyFund) catLine.appendChild(el('span', { class: 'badge ef-badge mf-beat', text: 'EF' }));
  // A compact blue "reinvested" badge flags an FD funded by rolling in matured
  // FD(s) - replaces the old "↻ from {bank}" text (which wrapped to another line)
  // and the fresh+rolled sub-line. Full breakdown lives in the Chain tab.
  const parents = (chain && chain.parents) || [];
  if (parents.length) catLine.appendChild(el('span', { class: 'badge mf-beat fd-reinvested', text: 'reinvested' }));
  if (chain && chain.child) catLine.appendChild(el('span', { class: 'badge mf-beat fd-reinvested', text: 'rolled over' }));
  const matTxt = c.maturity
    ? (c.effectiveStatus === 'active'
        ? (c.daysToMaturity >= 0 ? `Matures ${c.maturity} · ${c.daysToMaturity}d` : `Due ${c.maturity}`)
        : `Matured ${c.maturity}`)
    : 'No maturity date';
  return el('div', { class: 'card', onclick: () => openFdForm(f) }, [
    el('div', { class: 'top' }, [
      el('div', { class: 'card-left' }, [
        el('div', { class: 'name', text: f.bank || 'Fixed Deposit' }),
        catLine,
      ]),
      el('div', { class: 'card-right' }, [
        el('div', { class: 'pct pos', text: '+' + fmtIntCur(c.totalInterest) }),
        el('div', { class: 'meta-line', text: 'interest' }),
      ]),
    ]),
    el('div', { class: 'sub mf-sub2' }, [
      el('span', {}, [
        el('div', {}, ['Invested ', b(fmtIntCur(c.principal))]),
        el('div', { class: 'mf-meta-mini', text: matTxt }),
      ]),
      el('span', { class: 'value-emphasis' }, ['Maturity ', _mfValueCard(c.maturityValue, c.principal, false, fmtIntCur)]),
    ]),
  ]);
}

export async function openFdForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const mod = await import('./fd.js');
  const f = Object.assign({ owner: 'me', status: 'active', compounding: 'quarterly', payout: 'cumulative' }, existing || {});

  // Load every FD for the "Funded by" picker + the Chain tab (reinvestment links).
  const allFds = (await DB.byIndex('fds', 'owner', 'me')) || [];
  const nowFd = Date.now();
  const fdById = new Map(allFds.map((x) => [x.id, x]));
  const rCache = new Map();
  const compById = new Map(allFds.map((x) => [x.id, mod.resolveChain(x, fdById, nowFd, rCache)]));
  const childByParent = new Map();   // matured parent id → the FD that merged it in
  allFds.forEach((x) => { mod.parentIdsOf(x).forEach((pid) => childByParent.set(pid, x)); });

  const bankList = el('datalist', { id: 'fdbanklist' }, mod.FD_BANKS.map((x) => el('option', { value: x })));
  const bank = el('input', { type: 'text', value: f.bank || '', list: 'fdbanklist', placeholder: 'Bank / platform' });
  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });
  const principal = numInput(f.principal, '₹ e.g. 100000');
  const rate = numInput(f.rate, 'e.g. 7.1');
  const startDate = el('input', { type: 'date', value: f.startDate || todayISO() });
  const maturityDate = el('input', { type: 'date', value: f.maturityDate || '' });
  const tenure = numInput('', 'Months');
  const compounding = el('select', {}, mod.FD_COMPOUNDING.map((x) => { const o = el('option', { value: x, text: x }); if (x === f.compounding) o.selected = true; return o; }));
  const payout = el('select', {}, [['cumulative', 'Cumulative (reinvest)'], ['payout', 'Payout (interest out)']].map(([v, l]) => { const o = el('option', { value: v, text: l }); if (v === f.payout) o.selected = true; return o; }));

  // Linking an FD to the Emergency Fund hands ownership of it to that surface:
  // it stays listed here with an "EF" badge but leaves this page's totals and
  // Home's Total Invested, so the same money is never counted in two places.
  const efChk = el('input', { type: 'checkbox' });
  efChk.checked = !!f.emergencyFund;
  const efSwitch = el('label', { class: 'switch' }, [
    efChk,
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
  ]);
  // Its own card rather than a buried switch: a shield, what it does in one line, and the whole card
  // takes the Emergency Fund's purple once it is on.
  const efCard = el('div', { class: 'fd-opt fd-opt-ef' + (efChk.checked ? ' is-on' : '') }, [
    el('span', { class: 'fd-opt-ico', text: '\u{1F6E1}\u{FE0F}' }),
    el('div', { class: 'fd-opt-body' }, [
      el('div', { class: 'fd-opt-title', text: 'Part of Emergency Fund' }),
      el('div', { class: 'fd-opt-sub', text: 'Moves it to Emergency Fund and out of these totals' }),
    ]),
    efSwitch,
  ]);
  efChk.addEventListener('change', () => efCard.classList.toggle('is-on', efChk.checked));

  // "Funded by" — tick the matured FD(s) whose proceeds seed this one. Multiple
  // can be ticked to MERGE several matured FDs into this single new FD. Only
  // matured FDs not already consumed by another FD are offered (plus any this FD
  // already links). Sorted by maturity date (oldest first). Each parent's payout
  // adds to this FD's effective deposit; the links drive the no-double-count totals.
  const currentParentIds = new Set(mod.parentIdsOf(f));
  const eligibleParents = allFds
    .filter((x) => {
      if (x.id === f.id) return false;                              // never self
      if (compById.get(x.id).effectiveStatus !== 'matured') return false; // only matured can be a source
      const takenBy = childByParent.get(x.id);
      return !(takenBy && takenBy.id !== f.id);                     // not already consumed elsewhere
    })
    .sort((a, b2) => (Date.parse(a.maturityDate || 0) || 0) - (Date.parse(b2.maturityDate || 0) || 0));
  const parentBoxes = [];   // { id, cb }
  const parentListEl = el('div', { class: 'fd-roll-list' });
  eligibleParents.forEach((x) => {
    const cb = el('input', { type: 'checkbox' });
    if (currentParentIds.has(x.id)) cb.checked = true;
    parentBoxes.push({ id: x.id, cb });
    const cx = compById.get(x.id);
    const row = el('label', { class: 'fd-roll-row' + (cb.checked ? ' is-on' : '') }, [
      cb,
      el('span', { class: 'fd-roll-check', 'aria-hidden': 'true' }),
      el('div', { class: 'fd-roll-body' }, [
        el('div', { class: 'fd-roll-bank', text: x.bank || 'FD' }),
        el('div', { class: 'fd-roll-sub', text: 'Matured ' + (x.maturityDate || '—') }),
      ]),
      el('div', { class: 'fd-roll-amt', text: fmtIntCur(cx.maturityValue) }),
    ]);
    cb.addEventListener('change', () => row.classList.toggle('is-on', cb.checked));
    parentListEl.appendChild(row);
  });
  const checkedParentIds = () => parentBoxes.filter((p) => p.cb.checked).map((p) => p.id);
  // Rolled over: its own card, with a live "2 linked · ₹X rolled in" line so the effect of each tick is visible.
  const rollCount = el('span', { class: 'fd-opt-count' });
  const rollCard = el('div', { class: 'fd-opt fd-opt-roll' + (eligibleParents.length ? '' : ' is-empty') }, [
    el('div', { class: 'fd-opt-headrow' }, [
      el('span', { class: 'fd-opt-ico', text: '\u{1F501}' }),
      el('div', { class: 'fd-opt-body' }, [
        el('div', { class: 'fd-opt-title' }, [document.createTextNode('Rolled over from a matured FD'), rollCount]),
        el('div', { class: 'fd-opt-sub', text: eligibleParents.length
          ? 'Tick the matured FD(s) whose payout went into this one'
          : 'No matured FDs to roll in - this one is fresh money only' }),
      ]),
    ]),
    eligibleParents.length ? parentListEl : null,
  ].filter(Boolean));

  const buildRec = () => ({
    owner: 'me',
    bank: bank.value.trim(),
    principal: num(principal.value) || 0,   // fresh money only
    rate: num(rate.value) || 0,
    startDate: startDate.value || null,
    maturityDate: maturityDate.value || null,
    compounding: compounding.value,
    payout: payout.value,
    parentFdIds: checkedParentIds(),
    // The Notes box is gone from the form, but a note saved before is kept, never wiped by an edit.
    notes: f.notes || '',
    emergencyFund: efChk.checked,
    createdAt: f.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed = sum of every ticked matured parent's maturity value (its payout). The
  // new FD's deposit = that + the fresh amount typed here.
  const seedFromParent = () => checkedParentIds().reduce((s, pid) => {
    const pc = compById.get(pid);
    return s + (pc ? pc.maturityValue : 0);
  }, 0);

  // What it matures to, worked out live as you type: the maturity value large, the rest underneath.
  const readout = el('div', { class: 'fd-preview' });
  const refresh = () => {
    readout.innerHTML = '';
    const seed = seedFromParent();
    const c = mod.computeFd(buildRec(), Date.now(), seed);
    const ids = checkedParentIds();
    rollCount.textContent = ids.length ? ids.length + ' linked · ' + fmtIntCur(seed) + ' rolled in' : '';
    rollCount.classList.toggle('hidden', !ids.length);
    readout.appendChild(el('div', { class: 'fd-preview-main' }, [
      el('div', { class: 'fd-preview-k', text: 'Matures to' }),
      el('div', { class: 'fd-preview-v', text: c.maturity ? fmtCur(c.maturityValue, 'INR') : '—' }),
    ]));
    const cells = [
      ['Interest', c.maturity ? '+' + fmtIntCur(c.totalInterest) : '—', c.maturity ? 'pos' : ''],
      ['Tenure', c.tenureYears ? c.tenureYears.toFixed(2) + ' yr' : '—', ''],
      ['Deposit', fmtIntCur(c.principal), ''],
    ];
    readout.appendChild(el('div', { class: 'fd-preview-grid' }, cells.map(([k, v, cls]) =>
      el('div', {}, [el('div', { class: 'fd-preview-k', text: k }), el('div', { class: 'fd-preview-s ' + cls, text: v })]))));
    // When money is rolled in from a matured FD, say how the deposit is made up.
    if (seed > 0) readout.appendChild(el('div', { class: 'fd-preview-note', text: fmtIntCur(c.freshPrincipal) + ' fresh + ' + fmtIntCur(c.rolledIn) + ' rolled over' }));
  };
  // Typing a tenure (or tapping a quick pick) fills the maturity date from the start date; then recompute.
  const tenureChips = el('div', { class: 'fd-tenure-chips' });
  const applyTenure = () => {
    const m = num(tenure.value);
    if (m != null && startDate.value) maturityDate.value = mod.addMonths(startDate.value, m);
    [...tenureChips.children].forEach((ch) => ch.classList.toggle('active', Number(ch.dataset.m) === m));
    refresh();
  };
  [[6, '6M'], [12, '1Y'], [24, '2Y'], [36, '3Y'], [60, '5Y']].forEach(([m, l]) => tenureChips.appendChild(
    el('button', { class: 'mf-sort-chip', type: 'button', 'data-m': String(m), text: l, onclick: () => { tenure.value = String(m); applyTenure(); } })));
  tenure.addEventListener('input', applyTenure);
  [principal, rate, compounding, payout, startDate, maturityDate].forEach((inp) => inp.addEventListener('input', refresh));
  parentBoxes.forEach((p) => p.cb.addEventListener('change', refresh));
  refresh();

  const del = async () => {
    if (!(await appConfirm('Delete this FD? This cannot be undone.'))) return;
    await DB.del('fds', f.id); closeModal(); toast('FD deleted'); renderFD();
  };
  const save = async () => {
    if (!bank.value.trim()) { toast('Enter the bank / platform'); return; }
    if (!(num(principal.value) > 0)) { toast('Enter the principal amount'); return; }
    const rec = buildRec();
    if (isEdit) rec.id = f.id;
    await DB.put('fds', rec); closeModal(); toast(isEdit ? 'FD updated' : 'FD added'); renderFD();
  };

  // ---- Details tab (the form) ----
  // Grouped the way the deposit is thought about - where and how much, for how long, how it earns - then
  // what it matures to, then the two things that change where it is counted.
  const detailsContent = el('div', { class: 'fd-form' }, [
    formSection('\u{1F3E6}', 'Deposit', [
      field('Bank / platform', bank),
      el('div', { class: 'field-row' }, [field('Fresh amount ₹', principal, 'fdFresh'), field('Rate % p.a.', rate)]),
    ]),
    formSection('\u{1F4C5}', 'Dates', [
      el('div', { class: 'field-row' }, [field('Start date', startDate), field('Maturity date', maturityDate)]),
      field('Tenure (months) → fills maturity date', el('div', { class: 'fd-tenure' }, [tenure, tenureChips])),
    ]),
    formSection('\u{1F4C8}', 'Interest', [
      el('div', { class: 'field-row' }, [field('Compounding', compounding, 'compounding'), field('Type', payout, 'payoutType')]),
    ]),
    readout,
    formSection('\u{2699}\u{FE0F}', 'Options', [rollCard, efCard]),
  ]);

  // ---- Chain tab: the linked FDs (this FD itself is NOT listed). Walks up via
  // parentFdIds (matured FDs merged in, transitively) and down via childByParent
  // (where this rolled into), deduped, sorted by maturity date. Reflects the LIVE
  // checkbox selection, not just what's saved.
  const chainList = el('div', { class: 'fd-chain' });
  const buildChain = () => {
    const seen = new Set([f.id]);
    const out = [];
    const upStack = checkedParentIds().slice();   // live selection
    let guard = 0;
    while (upStack.length && guard++ < 400) {
      const pid = upStack.shift();
      if (seen.has(pid)) continue;
      const p = fdById.get(pid); if (!p) continue;
      seen.add(pid); out.push(p);
      mod.parentIdsOf(p).forEach((gp) => upStack.push(gp));
    }
    let cur = f; guard = 0;
    while (cur && childByParent.get(cur.id) && guard++ < 400) {
      const ch = childByParent.get(cur.id);
      if (seen.has(ch.id)) break;
      seen.add(ch.id); out.push(ch); cur = ch;
    }
    return out.sort((a, b2) => (Date.parse(a.maturityDate || 0) || 0) - (Date.parse(b2.maturityDate || 0) || 0));
  };
  const renderChain = () => {
    chainList.innerHTML = '';
    const chain = buildChain();
    if (!chain.length) {
      chainList.appendChild(el('p', { class: 'hint', text: 'No linked FDs. Tick a matured FD under “Rolled over from a matured FD” on the Details tab to merge it into this one — the linked FDs then show here.' }));
      return;
    }
    chain.forEach((x) => {
      const cx = compById.get(x.id);
      chainList.appendChild(el('div', { class: 'card fd-chain-row', onclick: () => openFdForm(x) }, [
        el('div', { class: 'fd-chain-body' }, [
          el('div', { class: 'name', text: x.bank || 'FD' }),
          el('div', { class: 'cat', text: `${fmtCur(cx.principal, 'INR')} @ ${cx.rate}% · ${cx.effectiveStatus}` + (x.maturityDate ? ` · mat ${x.maturityDate}` : '') }),
        ]),
        el('div', { class: 'fd-chain-int pos', text: '+' + fmtIntCur(cx.totalInterest) }),
      ]));
    });
  };
  const chainContent = el('div', { class: 'hidden' }, [
    el('p', { class: 'hint', text: 'Linked FDs — the matured FD(s) merged into this one (and where it rolls into, if any). Tap a link to open it.' }),
    chainList,
  ]);

  // ---- Tabs (Chain only when editing an existing FD) ----
  const detailsTabBtn = el('button', { class: 'active', type: 'button', text: 'Details' });
  const chainTabBtn = el('button', { type: 'button', text: 'Chain' });
  const tabs = [{ btn: detailsTabBtn, content: detailsContent }];
  if (isEdit) tabs.push({ btn: chainTabBtn, content: chainContent });
  const showTab = (which) => {
    tabs.forEach((t) => { const on = t === which; t.btn.classList.toggle('active', on); t.content.classList.toggle('hidden', !on); });
    if (which.btn === chainTabBtn) renderChain();
  };
  detailsTabBtn.addEventListener('click', () => showTab(tabs[0]));
  if (isEdit) chainTabBtn.addEventListener('click', () => showTab(tabs[1]));

  const scrollChildren = [
    el('h2', { text: isEdit ? (f.bank || 'Edit FD') : 'Add fixed deposit' }),
    // A new FD has no Chain yet, so no tab bar at all rather than a lone 'Details' tab.
    isEdit ? el('div', { class: 'seg' }, [detailsTabBtn, chainTabBtn]) : null,
    bankList,
    detailsContent,
    ...(isEdit ? [chainContent] : []),
  ].filter(Boolean);
  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (isEdit) btns.push(el('button', { class: 'btn danger', text: 'Delete', onclick: del }));
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, scrollChildren),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]),
  ]));
}

// What the Home "Total Invested" / "Total Earned" headline is actually made of.
// Returns one entry per contributing bucket, so the headline figures and the
// ⓘ breakdown sheet are always computed from the same pass and can't drift.
//
// Each exclusion below is deliberate:
//   • Stocks — Me · India (native ₹) + Me · US, converted to ₹ at the Home
//     strip's own live USD→INR rate (2026-09-15 onward - previously Me · US
//     was left out entirely). Wife · India stays excluded regardless: it's a
//     separate book (hers, not this personal total), which is a different
//     reason than the currency and unaffected by adding the US conversion.
//     The US leg silently contributes 0 if no rate has ever been cached (open
//     Home once) rather than guessing one.
//   • Stocks — SGB gold bonds are skipped here and counted under Metals
//     instead (they're gold), so the same money isn't counted twice.
//   • Sold stocks and redeemed funds — that capital is no longer at work.
//   • FDs — MATURED only. Money still locked in a running deposit hasn't come
//     back yet, so it isn't treated as invested capital here; the FD surface
//     tracks the active ladder itself. A matured deposit that was renewed into
//     another matured deposit is superseded by its child, so one principal
//     isn't counted twice along the chain.
//   • Bonds — deliberately a DIFFERENT basis from FDs: invested = ACTIVE bond
//     principal (still-live capital), earned = realised interest from bonds
//     that have closed (matured or sold) only — never an active bond's
//     accrued-but-unpaid interest. Matured/sold principal has been returned,
//     so it's no longer "invested" once it's back; an active bond's principal
//     genuinely still is. See bonds.js computeBond for the realised-interest
//     math (payoutsBeforeExit + soldGain for a sold bond).
//   • Emergency Fund — ANY funds/bonds/fds record flagged `emergencyFund: true`
//     is skipped by its own row above and contributes NOTHING here, not even a
//     row of its own. The Emergency Fund surface is the sole owner of that
//     money: its corpus, its lent-out loans and its idle cash all live there and
//     are deliberately kept out of this pair. Same shape as the SGB rule above
//     (record lives in one store, a different surface counts it) and the same
//     shape as Dividends, which has a Home card and contributes nothing either.
//     DO NOT "fix" this by adding an Emergency Fund row — the parked holdings
//     would then be counted twice, and idle cash plus a family receivable would
//     enter the denominator at 0% and quietly drag the headline return down.
export async function homeInvestedBreakdown() {
  const parts = [];
  let totalInvested = 0, totalValue = 0;
  const add = (label, note, invested, value, count, opts) => {
    // pctBasis overrides what the row's % is computed against - for Bonds,
    // Invested (active principal) and Earned (closed-bond interest) describe
    // DIFFERENT bonds, so interest ÷ active-principal isn't a real return; the
    // matching denominator is the principal that actually earned that interest.
    // badges are EXTRA small pills beside the label, each independently
    // coloured (opts.badges: [{text, cls}]) - Stocks uses two for its India/US
    // holding counts, Metals two for its gold/silver gram totals. `count`
    // stays the plain single-badge case every other row still uses.
    parts.push({
      label, note, invested: invested || 0, value: value || 0, count: count || 0,
      badges: (opts && opts.badges) || [],
      pctBasis: (opts && opts.pctBasis != null) ? opts.pctBasis : null,
    });
    totalInvested += invested || 0;
    totalValue += value || 0;
  };
  // Exclusion counts, surfaced once in the sheet's footer note instead of
  // repeated per-row - each row's own description only says what IS in it.
  const skipped = { sgb: 0, fd: 0, bond: 0, ef: 0 };
  // Only the features the user chose count toward the Home totals.
  const enabled = (id) => modOn(_modsCache, id);
  try {
    // Stocks — Me-India (holdings, not sold; SGB gold bonds excluded, tracked
    // under Metals instead) + Me-US, converted to ₹ at the live USD→INR rate
    // and folded into the SAME row (one combined Invested/Value/% - the money
    // is one "Stocks" total regardless of which market it sits in). The two
    // portfolios' counts stay visible as two badges (count / count2) rather
    // than collapsing into one number.
    const [meInStocks, meUsStocks, liveRatesRow] = await Promise.all([
      DB.byPortfolio('stocks', 'me-in').catch(() => []),
      DB.byPortfolio('stocks', 'me-us').catch(() => []),
      DB.get('meta', 'homeLiveRates').catch(() => null),
    ]);
    const usdInr = liveRatesRow && liveRatesRow.value && liveRatesRow.value.usdInr
      ? Number(liveRatesRow.value.usdInr) : 0;
    let sInv = 0, sVal = 0, sN = 0;
    for (const s of (meInStocks || [])) {
      if (s.status !== 'holding') continue;
      if (isSgb(s)) { skipped.sgb++; continue; }
      sInv += Number(s.units || 0) * Number(s.buyPrice || 0);
      sVal += Number(s.units || 0) * Number(s.currentPrice || 0);
      sN++;
    }
    let usInv = 0, usVal = 0, usN = 0;
    if (usdInr > 0) {
      for (const s of (meUsStocks || [])) {
        if (s.status !== 'holding') continue;
        usInv += Number(s.units || 0) * Number(s.buyPrice || 0) * usdInr;
        usVal += Number(s.units || 0) * Number(s.currentPrice || 0) * usdInr;
        usN++;
      }
    }
    // Other people's profiles whose "In total" switch is on (Profiles sheet) - Pro/Beta only.
    let oInv = 0, oVal = 0, oN = 0, oUsd = false;
    const oNames = [];
    for (const p of await includedStockProfiles().catch(() => [])) {
      const rate = p.cur === 'USD' ? usdInr : 1;
      if (!rate) continue;
      let n = 0;
      for (const s of (await DB.byPortfolio('stocks', p.id).catch(() => [])) || []) {
        if (s.status !== 'holding') continue;
        if (isSgb(s)) { skipped.sgb++; continue; }
        oInv += Number(s.units || 0) * Number(s.buyPrice || 0) * rate;
        oVal += Number(s.units || 0) * Number(s.currentPrice || 0) * rate;
        n++;
      }
      if (n) { oN += n; oNames.push(p.label.split(' · ')[0]); if (p.cur === 'USD') oUsd = true; }
    }
    const who = ['Me · India'].concat(usN ? ['Me · US'] : [], oNames).join(' + ');
    if (enabled('stocks')) add('Stocks', who + ((usN || oUsd) ? ', US converted to ₹' : ' holdings'), sInv + usInv + oInv, sVal + usVal + oVal, 0, {
      badges: [
        sN ? { text: String(sN), title: 'Me · India' } : null,
        usN ? { text: String(usN), cls: 'brk-count-us', title: 'Me · US' } : null,
        oN ? { text: String(oN), cls: 'brk-count-other', title: oNames.join(', ') } : null,
      ].filter(Boolean),
    });

    // Mutual Funds — Investing only (exclude Sold)
    const funds = await DB.byIndex('funds', 'owner', 'me') || [];
    let fInv = 0, fVal = 0, fN = 0;
    for (const f of funds) {
      if (f.status === 'Sold' || f.soldDate) continue;
      // Linked to the Emergency Fund — that surface owns it, same as SGBs above
      // belong to Metals rather than Stocks.
      if (f.emergencyFund) { skipped.ef++; continue; }
      const c = await import('./mf.js').then(mod => mod.computeFund(f, Date.now())).catch(() => null);
      if (c) { fInv += c.invested || 0; fVal += c.value || 0; fN++; }
    }
    if (enabled('mf')) add('Mutual Funds', 'Active SIPs & lumpsums', fInv, fVal, fN);

    // Fixed Deposits — MATURED, but NOT superseded by a matured child
    const fds = (await DB.byIndex('fds', 'owner', 'me')) || [];
    let dInv = 0, dVal = 0, dN = 0;
    if (fds.length) {
      const fdMod = await import('./fd.js');
      const nowT = Date.now();
      const fdByIdH = new Map(fds.map((x) => [x.id, x]));
      const fdCacheH = new Map();
      const fdComp = new Map(fds.map((x) => [x.id, fdMod.resolveChain(x, fdByIdH, nowT, fdCacheH)]));
      const supersededIds = new Set();
      fds.forEach((x) => {
        if (fdComp.get(x.id).effectiveStatus === 'matured') fdMod.parentIdsOf(x).forEach((pid) => supersededIds.add(pid));
      });
      for (const fdRec of fds) {
        const c = fdComp.get(fdRec.id);
        if (fdRec.emergencyFund) { skipped.ef++; continue; }   // owned by the Emergency Fund surface
        if (c.effectiveStatus !== 'matured') { skipped.fd++; continue; }
        if (supersededIds.has(fdRec.id)) { skipped.fd++; continue; }
        dInv += c.principal; dVal += c.maturityValue; dN++;
      }
    }
    if (enabled('fd')) add('Fixed Deposits', 'Matured deposits', dInv, dVal, dN);

    // Metals — gold + silver (at current market prices)
    const metalData = await metalPortfolio();
    const mInv = (metalData.gold.invested || 0) + (metalData.silver.invested || 0);
    const mVal = (metalData.gold.value || 0) + (metalData.silver.value || 0);
    if (enabled('metal')) add('Metals', 'Digital gold & silver' + (metalData.gold.sgbCount ? ' + SGB (as gold)' : ''), mInv, mVal, 0, {
      badges: [
        metalData.gold.grams ? { text: _gramsShort(metalData.gold.grams) + 'g', cls: 'brk-count-gold', title: 'Gold' } : null,
        metalData.silver.grams ? { text: _gramsShort(metalData.silver.grams) + 'g', cls: 'brk-count-silver', title: 'Silver' } : null,
      ].filter(Boolean),
    });

    // Bonds — active principal as invested; realised interest from closed
    // (matured + sold) bonds as earned. Opposite basis from FDs above, on
    // purpose (see the header comment). `bVal` here is NOT "current value" of
    // the bonds - it's invested + realised interest, so that value − invested
    // reduces to exactly the realised-interest figure this row is meant to show.
    const bonds = (await DB.byIndex('bonds', 'owner', 'me')) || [];
    let bInv = 0, bVal = 0, bN = 0, bMaturedPrincipal = 0;
    if (bonds.length) {
      const bondMod = await import('./bonds.js');
      const nowB = Date.now();
      bonds.forEach((bRec) => {
        const c = bondMod.computeBond(bRec, nowB);
        // Linked to the Emergency Fund — that surface owns it, so it must not
        // land in either side of this row (not even its realised interest).
        if (bRec.emergencyFund) { skipped.ef++; return; }
        // outstandingPrincipal, not principal: an amortizing bond has already
        // handed part of its capital back, and that money is no longer invested
        // here. Identical to principal for every non-amortizing active bond.
        if (c.effectiveStatus === 'active') { bInv += c.outstandingPrincipal; bVal += c.outstandingPrincipal; bN++; }
        else { bVal += c.interestEarned; bMaturedPrincipal += c.principal; skipped.bond++; }
      });
    }
    // pctBasis: this row's Invested (active bonds) and Earned (closed bonds'
    // interest) describe DIFFERENT bonds, so interest ÷ active-principal isn't
    // a real return. The matching denominator is the principal of the closed
    // bonds that actually earned that interest.
    if (enabled('bond')) add('Bonds', 'Active principal + realised interest', bInv, bVal, bN, { pctBasis: bMaturedPrincipal });
  } catch (_) {}
  if (!enabled('stocks')) skipped.sgb = 0;
  if (!enabled('fd')) skipped.fd = 0;
  if (!enabled('bond')) skipped.bond = 0;
  return { parts, totalInvested, totalValue, skipped };
}

// ⓘ sheet behind the Home headline — shows exactly which buckets make up the
// Total Invested figure, and what is deliberately left out of it.
export function openInvestedBreakdown(bd) {
  // `basis` defaults to the row's own Invested figure, but a row can override
  // it (pctBasis) with a different denominator - Bonds' Invested is active
  // principal while Earned is closed-bond interest, so the % has to be
  // computed against the closed bonds' OWN principal to mean anything.
  const pctRow = (basis, earned) => {
    if (!(basis > 0)) return el('span', { class: 'brk-pct muted', text: '—' });
    const pct = (earned / basis) * 100;
    return el('span', { class: 'brk-pct ' + pctClass(pct), text: fmtPct(pct) });
  };
  // Each source's share of Total Invested - answers "where is the money
  // actually sitting", which the rupee figures alone make you compute in your
  // head. One decimal throughout so a small sliver (0.4%) never rounds away to
  // a meaningless 0%.
  const allocPct = (invested) => {
    if (!(bd.totalInvested > 0)) return '—';
    return ((invested / bd.totalInvested) * 100).toFixed(1) + '%';
  };
  const rows = bd.parts.map((p) => {
    const earned = p.value - p.invested;
    return el('div', { class: 'brk-row' }, [
      el('div', { class: 'brk-main' }, [
        el('div', { class: 'brk-name' }, [
          p.label,
          p.count ? el('span', { class: 'brk-count', text: String(p.count) }) : null,
          ...p.badges.map((b) => el('span', { class: 'brk-count ' + (b.cls || ''), title: b.title || '', text: b.text })),
        ].filter(Boolean)),
        el('div', { class: 'brk-note', text: p.note }),
      ]),
      el('div', { class: 'brk-nums' }, [
        el('div', { class: 'brk-inv' }, [
          fmtIntCur(p.invested),
          el('span', { class: 'brk-alloc', text: allocPct(p.invested) }),
        ]),
        el('div', { class: 'brk-earn ' + pctClass(earned) }, [
          (earned >= 0 ? '+' : '') + fmtIntCur(earned) + ' ', pctRow(p.pctBasis != null ? p.pctBasis : p.invested, earned),
        ]),
      ]),
    ]);
  });
  const totalEarned = bd.totalValue - bd.totalInvested;
  // Exclusions are stated ONCE here, with real counts when there are any to
  // report - each row above only describes what it includes.
  const sk = bd.skipped || {};
  const skipBits = [];
  if (sk.sgb) skipBits.push(sk.sgb + ' SGB' + (sk.sgb > 1 ? 's' : '') + ' (counted under Metals instead)');
  if (sk.fd) skipBits.push(sk.fd + ' FD' + (sk.fd > 1 ? 's' : '') + ' still running or renewed');
  if (sk.bond) skipBits.push(sk.bond + ' matured/sold bond' + (sk.bond > 1 ? 's' : '') + ' whose principal has been returned');
  if (sk.ef) skipBits.push(sk.ef + ' holding' + (sk.ef > 1 ? 's' : '') + ' linked to the Emergency Fund (tracked on its own page)');
  const footNote = 'Not counted: Wife · India stocks (a separate book), sold stocks and redeemed funds' +
    (skipBits.length ? ', ' + skipBits.join(', ') : '') +
    ' - that money is either tracked elsewhere, still locked in, or already back in hand.';
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'What makes up Total Invested' }),
    el('div', { class: 'brk-head' }, [
      el('span', { text: 'Source' }),
      el('span', { text: 'Invested · Share · Earned · Return' }),
    ]),
    el('div', { class: 'brk-list' }, rows),
    el('div', { class: 'brk-row brk-total' }, [
      el('div', { class: 'brk-main' }, [el('div', { class: 'brk-name', text: 'Total' })]),
      el('div', { class: 'brk-nums' }, [
        el('div', { class: 'brk-inv' }, [
          fmtIntCur(bd.totalInvested),
          el('span', { class: 'brk-alloc', text: bd.totalInvested > 0 ? '100.0%' : '—' }),
        ]),
        el('div', { class: 'brk-earn ' + pctClass(totalEarned) }, [
          (totalEarned >= 0 ? '+' : '') + fmtIntCur(totalEarned) + ' ', pctRow(bd.totalInvested, totalEarned),
        ]),
      ]),
    ]),
    el('p', { class: 'hint', text: footNote }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

// How far ahead Home's "Coming up this week" strip looks. One week: near enough
// that the money needs a decision now, far enough ahead to actually act on it.
export const UPCOMING_DAYS = 7;
// The live resize handler for Home's "Coming Up" strip, so a re-render can
// detach the previous one (see _homeUpcomingStrip).
let _upcomingResizeHandler = null;
