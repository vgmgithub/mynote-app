import { DB } from './db.js';
import { fmtPct, pctClass, num } from './core.js';
import { setAppMode, $, updateDivNavActive, _divTab, el, explainRow, b, closeModal, toast, field, openModal } from './app.js';

// ---------- Dividends surface ----------
let _divMarket = 'in';       // 'in' | 'us' (Me-India / Me-US)
// Lazy-loaded: dividend.js (pure logic) only loads when the user opens Dividends.
// Membership is driven live by each stock's `divAvailable` toggle (set on the
// Stocks edit form) — there's no manual add/delete here. Every render re-joins
// the eligible Me-India / Me-US holdings against the 'dividends' store, linked
// by stockId, auto-creating a record for a newly-toggled-on stock and hiding
// (not deleting) the record for one that's been toggled off, sold, or removed —
// so re-enabling later restores its history.
export async function _eligibleDividendRecords(mod, { write } = {}) {
  const [meIn, meUs, divs] = await Promise.all([
    DB.byPortfolio('stocks', 'me-in').catch(() => []),
    DB.byPortfolio('stocks', 'me-us').catch(() => []),
    DB.all('dividends').catch(() => []),
  ]);
  const eligible = [...meIn, ...meUs].filter((s) => s.status === 'holding' && s.divAvailable && (s.name || '').trim());
  const byStockId = new Map(divs.filter((d) => d.stockId != null).map((d) => [d.stockId, d]));
  // Legacy fallback: records seeded before stockId linking existed, matched by
  // name+market. Backfilled with stockId (write mode only) so future joins are exact.
  const byNameMarket = new Map(divs.map((d) => [(d.market || '') + '|' + (d.name || '').trim().toLowerCase(), d]));
  const nowIso = new Date().toISOString();
  const curYear = new Date().getFullYear();
  const out = [];
  for (const s of eligible) {
    const market = s.portfolio === 'me-us' ? 'us' : 'in';
    let rec = byStockId.get(s.id);
    if (!rec) {
      const legacy = byNameMarket.get(market + '|' + (s.name || '').trim().toLowerCase());
      if (legacy && legacy.stockId == null) {
        if (write) { legacy.stockId = s.id; await DB.put('dividends', legacy); }
        rec = legacy;
      }
    }
    if (!rec) {
      if (!write) continue; // read-only pass (Home stats): skip stocks with no record yet
      rec = mod.buildSeedRecord(s, market, curYear, nowIso);
      rec.id = await DB.put('dividends', rec);
    }
    // `name` is kept fresh from the stock; `_startYear` rides along purely for
    // display (which years to show) and is NEVER persisted — openDivForm's
    // save() strips it, so the dividend record keeps no stale copy of a field
    // the stock owns.
    out.push(Object.assign({}, rec, {
      name: (s.name || '').trim(),
      _startYear: Number.isFinite(Number(s.startYear)) ? Number(s.startYear) : null,
    }));
  }
  return out;
}

export function openDividend() {
  setAppMode('div');
}

export async function renderDividend() {
  const host = $('#divView');
  host.innerHTML = '';
  updateDivNavActive();
  const mod = await import('./dividend.js');
  const all = await _eligibleDividendRecords(mod, { write: true });
  if (_divTab === 'overview') return renderDivOverview(host, all, mod);
  if (_divTab === 'calendar') return renderDivCalendar(host, all, mod);
  return renderDivStocks(host, all, mod);
}

// ---- Stocks tab: India/US filter + grouping by current-year status ----
function renderDivStocks(host, all, mod) {
  const curYear = new Date().getFullYear();
  const rows = all.filter((d) => d.market === _divMarket);
  const cur = mod.curOfMarket(_divMarket);

  // Calculate stats for all markets
  const inRows = all.filter((d) => d.market === 'in');
  const usRows = all.filter((d) => d.market === 'us');
  const inEarning = inRows.filter((rec) => mod.yearTotal(rec, curYear) > 0);
  const usEarning = usRows.filter((rec) => mod.yearTotal(rec, curYear) > 0);
  const inTotal = inEarning.reduce((sum, rec) => sum + (mod.yearTotal(rec, curYear) || 0), 0);
  const usTotal = usEarning.reduce((sum, rec) => sum + (mod.yearTotal(rec, curYear) || 0), 0);

  // Stats bar doubles as the India/US switch — tap a side to select that
  // market instead of a separate tab row above it.
  const statsCont = el('div', { class: 'div-stats-bar' }, [
    el('div', {
      class: 'div-stat-item' + (_divMarket === 'in' ? ' active' : ''),
      onclick: () => { if (_divMarket === 'in') return; _divMarket = 'in'; renderDividend(); },
    }, [
      el('div', { class: 'div-stat-label', text: 'India Stocks' }),
      el('div', { class: 'div-stat-count', text: String(inEarning.length) }),
      el('div', { class: 'div-stat-total', text: mod.fmtDiv(inTotal, 'INR') }),
    ]),
    el('div', { class: 'div-stat-sep' }),
    el('div', {
      class: 'div-stat-item' + (_divMarket === 'us' ? ' active' : ''),
      onclick: () => { if (_divMarket === 'us') return; _divMarket = 'us'; renderDividend(); },
    }, [
      el('div', { class: 'div-stat-label', text: 'US Stocks' }),
      el('div', { class: 'div-stat-count', text: String(usEarning.length) }),
      el('div', { class: 'div-stat-total', text: mod.fmtDiv(usTotal, 'USD') }),
    ]),
  ]);
  host.appendChild(statsCont);

  if (!rows.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '💰' }),
      el('p', { text: 'No dividend-tracked stocks here yet.' }),
      el('p', { class: 'hint', text: 'Open a stock, edit it, and turn on "Dividend available". It then shows up here.' }),
      el('button', { class: 'btn primary empty-cta', type: 'button', text: 'Go to Stocks', onclick: () => setAppMode('stocks') }),
    ]));
    return;
  }

  // Helper to get most recent year total for sorting.
  const sortKey = (rec) => {
    const recentYear = mod.yearsOf(rec)[0];
    return recentYear ? mod.yearTotal(rec, recentYear) : 0;
  };

  // Group by current-year status, sort each group by most recent year total (desc).
  const withCurYear = rows.filter((rec) => mod.yearTotal(rec, curYear) > 0).sort((a, b2) => sortKey(b2) - sortKey(a));
  const withoutCurYear = rows.filter((rec) => mod.yearTotal(rec, curYear) <= 0).sort((a, b2) => sortKey(b2) - sortKey(a));

  const wrap = el('section', { class: 'stock-list' });

  // Stocks with current-year data.
  if (withCurYear.length) {
    const heading = el('h3', { class: 'div-group-head', text: '📊 Noted for ' + curYear });
    wrap.appendChild(heading);
    withCurYear.forEach((rec) => wrap.appendChild(_divCard(rec, mod, curYear, cur)));
  }

  // Stocks without current-year data.
  if (withoutCurYear.length) {
    const heading = el('h3', { class: 'div-group-head', text: '📋 Pending ' + curYear });
    wrap.appendChild(heading);
    withoutCurYear.forEach((rec) => wrap.appendChild(_divCard(rec, mod, curYear, cur)));
  }

  host.appendChild(wrap);
}

function _divCard(rec, mod, curYear, cur) {
  const months = mod.parseMonths(rec.months);
  const curTotal = mod.yearTotal(rec, curYear);
  const isUs = rec.market === 'us';
  // Top 3 years, ignoring any that predate the stock's Started year (see
  // dividend.js visibleYears).
  const recentYears = mod.visibleYears(rec, rec._startYear).slice(0, 3);
  const breakdown = el('div', { class: 'div-years' });
  // Months from this point in the year onward (inclusive of the current
  // month) get the highlighted "upcoming" chip style on the consolidated
  // months line below.
  const curMonthIx = new Date().getMonth();

  recentYears.forEach((y) => {
    const yr = (rec.years || []).find((r) => Number(r.year) === y) || {};
    const yearTotal = mod.yearTotal(rec, y);
    const calcTxt = isUs ? '' : `${Number(yr.units) || 0} × ${yr.perUnit != null && yr.perUnit !== '' ? mod.fmtDiv(Number(yr.perUnit), cur) : '—'}`;
    const isCurrentYear = y === curYear;
    // This year's own payout months (falls back to nothing for records
    // saved before per-year months existed — the calc/total still show).
    // Each chip carries that month's own figure when one was entered, so the
    // card shows what actually landed in each month, not just which months paid.
    const yrMonths = Array.isArray(yr.months) ? yr.months : [];
    const chips = el('div', { class: 'div-year-month-chips' }, yrMonths.map((m) => {
      const v = yr.perMonth ? Number(yr.perMonth[m]) : null;
      // Month name plain, its own figure in a blue pill beside it — a stock
      // typically pays in only ~3 months, so these ride on the year's line
      // rather than taking a second row each.
      return el('span', { class: 'div-month-chip' + (v ? ' has-amt' : '') }, [
        el('span', { text: m }),
        v ? el('span', { class: 'div-chip-amt', text: mod.fmtDiv(v, cur) }) : document.createTextNode(''),
      ]);
    }));

    breakdown.appendChild(el('div', { class: 'div-year-entry' + (isCurrentYear ? ' current-year' : '') }, [
      el('div', { class: 'div-year-entry-top' }, [
        el('span', { class: 'div-year-entry-k', text: String(y) }),
        el('span', { class: 'div-year-entry-v', text: mod.fmtDiv(yearTotal, cur) }),
        chips,
        el('span', { class: 'div-year-entry-calc', text: calcTxt }),
      ]),
    ]));
  });

  // The consolidated payout months — every month this stock has EVER paid in,
  // pooled from all years. Kept in its own grey panel spanning the card rather
  // than tucked beside the name: it's a different kind of fact from the
  // per-year rows below (which months, ever — not what any one year paid), and
  // now that those rows carry month chips of their own the two need visibly
  // separating. Labelled for the same reason.
  const monthChipsTop = el('div', { class: 'div-card-months' },
    months.length
      ? months.map((m) => el('span', {
          class: 'div-month-chip' + (mod.MONTHS.indexOf(m) >= curMonthIx ? ' upcoming' : ''),
          text: m,
        }))
      : [el('span', { class: 'hint', text: '— No payout months' })]);
  const monthsPanel = el('div', { class: 'div-months-panel' }, [
    el('span', { class: 'div-months-panel-label', text: 'Payout months' }),
    monthChipsTop,
  ]);

  return el('div', { class: 'card div-card-enhanced', onclick: () => openDivForm(rec) }, [
    el('div', { class: 'top' }, [
      el('div', { class: 'div-card-header' }, [
        el('div', { class: 'div-card-name-section' }, [
          el('div', { class: 'name', text: rec.name || 'Stock' }),
        ]),
        el('div', { class: 'card-right' }, [
          el('div', { class: 'kv-val div-cur-total', text: mod.fmtDiv(curTotal, cur) }),
          el('div', { class: 'kv-label', text: String(curYear) }),
        ]),
      ]),
    ]),
    monthsPanel,
    breakdown,
  ]);
}

// ---- Overview tab: year-wise analysis, India (₹) and US ($) kept separate ----
function renderDivOverview(host, all, mod) {
  const build = (market) => {
    const cur = mod.curOfMarket(market);
    const rows = mod.annualAnalysis(all.filter((d) => d.market === market));
    const card = el('div', { class: 'chart-card' }, [
      el('h3', { text: (market === 'in' ? '🇮🇳 India (₹)' : '🇺🇸 US ($)') + ' · Annual analysis' }),
    ]);
    if (!rows.length) { card.appendChild(el('p', { class: 'hint', text: 'No dividends recorded yet — add per-year figures on the Stocks tab.' })); return card; }
    const table = el('div', { class: 'div-table div-annual' });
    table.appendChild(el('div', { class: 'div-trow div-thead' }, [
      el('span', { text: 'Year' }), el('span', { text: 'Total' }), el('span', { text: 'Per mo' }), el('span', { text: 'FY total' }), el('span', { text: 'YoY' }),
    ]));
    rows.forEach((r) => {
      const incTxt = r.incrementPct == null ? '—' : fmtPct(r.incrementPct);
      const profitTxt = r.profit == null ? '' : (r.profit >= 0 ? '+' : '') + mod.fmtDiv(r.profit, cur);
      table.appendChild(el('div', { class: 'div-trow' }, [
        el('span', { class: 'div-tyear', text: String(r.year) }),
        el('span', { text: mod.fmtDiv(r.total, cur) }),
        el('span', { text: mod.fmtDiv(r.monthly, cur) }),
        el('span', {}, [
          el('div', { text: mod.fmtDiv(r.fyTotal, cur) }),
          el('div', { class: 'div-fy-sub', text: 'FY ' + r.fyLabel }),
        ]),
        el('span', { class: 'div-yoy ' + (r.incrementPct == null ? '' : pctClass(r.incrementPct)) }, [
          el('div', { text: incTxt }),
          profitTxt ? el('div', { class: 'div-profit', text: profitTxt }) : el('span'),
          // Only years with a figure are listed, so two rows can sit next to
          // each other across a gap. Naming the year being compared against
          // stops a two-year jump reading as one year's growth.
          r.prevYear != null && r.prevYear !== r.year - 1
            ? el('div', { class: 'div-fy-sub', text: 'vs ' + r.prevYear }) : el('span'),
        ]),
      ]));
    });
    card.appendChild(table);
    card.appendChild(explainRow('About these years', 'Only years with a dividend recorded are listed. '
      + 'FY total = financial year (Apr–Mar), e.g. FY 25-26 = Apr 2025 – Mar 2026. Each calendar year is split across its payout months to fill the Apr–Mar buckets.', 'Which years are listed'));
    return card;
  };
  host.appendChild(build('in'));
  host.appendChild(build('us'));
}

// ---- Calendar tab: which months each stock has historically paid ----
function renderDivCalendar(host, all, mod) {
  const grouped = mod.byMonth(all);
  const curMonthIx = new Date().getMonth();
  host.appendChild(el('p', { class: 'hint', style: 'margin:2px 0 10px', text: 'Months each stock has paid before — a guide to what may credit this month. India (₹) and US ($) shown together.' }));
  mod.MONTHS.forEach((m, ix) => {
    const list = grouped[m];
    if (!list.length) return;
    const isCur = ix === curMonthIx;
    const card = el('div', { class: 'chart-card div-month' + (isCur ? ' div-month-cur' : '') }, [
      el('h3', { text: m + (isCur ? ' · this month' : '') }),
    ]);
    list.forEach(({ rec, expected }) => {
      const cur = mod.curOfMarket(rec.market);
      card.appendChild(el('div', { class: 'bar-row div-cal-row' }, [
        el('span', { class: 'bl', text: (rec.market === 'us' ? '🇺🇸 ' : '🇮🇳 ') + (rec.name || 'Stock') }),
        el('span', { class: 'bn', text: expected ? '≈ ' + mod.fmtDiv(expected, cur) : '—' }),
      ]));
    });
    host.appendChild(card);
  });
  if (!host.querySelector('.div-month')) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '🗓️' }),
      el('p', { text: 'No payout months set yet.' }),
      el('p', { class: 'hint', text: 'Open a stock on the Stocks tab and tap the months it usually pays.' }),
    ]));
  }
}

// ---- Edit a dividend-tracked stock's payout months + per-year figures ----
// Name/market come from the linked stock (not editable here — change the name
// on the Stocks edit form) and there's no delete: untrack by turning off
// "Dividend available" on that same form.
async function openDivForm(rec) {
  const mod = await import('./dividend.js');
  const isUs = rec.market === 'us';
  // Fetched for both markets: India uses the current unit count so a
  // freshly-added year row starts pre-filled instead of blank (past years'
  // saved units are untouched — this only seeds NEW rows); both markets use
  // `startYear` (see below) to reach further back than any year with
  // existing dividend data — there's no "+ Add year" button any more.
  const linkedStock = await DB.get('stocks', rec.stockId).catch(() => null);
  const currentUnits = linkedStock ? (Number(linkedStock.units) || 0) : '';

  // Per-year rows with embedded month toggles. India: year / months / units /
  // dividend-per-unit. US: year / months / direct dividend amount (no units).
  const yearRowsWrap = el('div', { class: 'div-year-editor' });
  const yearRefs = [];
  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });

  let addYearRow = (year, a, b2, preSelectMonths = [], presetPerMonth = null) => {
    // The year is already shown (and changed) via the ◀ ▶ slider above, whose
    // range is built from the years that have entries plus the linked stock's
    // "Started (year)" — so a second, independently-editable year box on this
    // row was redundant, and typing into it could put a row on a year the
    // slider can't reach. Kept in the DOM (collectYears() still reads its
    // value) but hidden, so the month picker sits where it used to be. Both
    // markets: US had it visible while it lacked a per-month editor.
    const yy = el('input', { type: 'number', inputmode: 'numeric', step: '1', value: year != null ? year : '', placeholder: 'Year', class: 'hidden' });
    const rm = el('button', { class: 'icon-btn', type: 'button', text: '×' });

    // Per-year month toggles (compact 3-col grid).
    const yearMonths = new Set();
    // {month: amount} — per-unit for India, the received figure for US.
    const monthlyInputs = {};

    // Stub, replaced below by the market's own breakdown renderer. Declared
    // here because the month-toggle handlers close over it.
    let updateBreakdown = () => {};

    const monthsGrid = el('div', { class: 'div-year-months' }, mod.MONTHS.map((m) => {
      // Pre-select months from the record (for existing years) or from user's selection
      const isPreSelected = preSelectMonths.includes(m);
      if (isPreSelected) {
        yearMonths.add(m);
        monthlyInputs[m] = '';
      }
      const btn = el('button', {
        type: 'button', class: 'div-year-mon-btn' + (isPreSelected ? ' active' : ''), text: m.slice(0, 1),
        title: m, 'data-month': m,
      });
      btn.addEventListener('click', () => {
        if (yearMonths.has(m)) {
          yearMonths.delete(m);
          delete monthlyInputs[m];
          btn.classList.remove('active');
        } else {
          yearMonths.add(m);
          monthlyInputs[m] = '';
          btn.classList.add('active');
        }
        updateBreakdown();
      });
      return btn;
    }));

    let row, ref;
    if (isUs) {
      // Same per-month breakdown as India, minus the units column — a US
      // dividend is read straight off the broker as one figure per month, so
      // the year total is just the sum of those boxes.
      const breakdownWrap = el('div', { class: 'div-india-breakdown' });
      const monthInputsWrap = el('div', { class: 'div-india-month-inputs' });
      const calcSpan = el('span', { class: 'div-breakdown-calc' });
      const totalSpan = el('span', { class: 'div-breakdown-total' });
      breakdownWrap.appendChild(monthInputsWrap);
      breakdownWrap.appendChild(el('div', { class: 'div-breakdown-summary' }, [calcSpan, totalSpan]));

      const updateTotal = () => {
        const vals = Object.values(monthlyInputs).map((v) => Number(v) || 0);
        const sum = vals.reduce((x, y) => x + y, 0);
        calcSpan.textContent = vals.length ? vals.join(' + ') : '—';
        totalSpan.textContent = mod.fmtDiv(sum, 'USD');
      };

      updateBreakdown = () => {
        monthInputsWrap.innerHTML = '';
        [...yearMonths].sort((m1, m2) => mod.MONTHS.indexOf(m1) - mod.MONTHS.indexOf(m2)).forEach((m) => {
          const inp = numInput(monthlyInputs[m], m.slice(0, 3));
          monthlyInputs[m] = inp.value;
          monthInputsWrap.appendChild(el('label', { class: 'div-month-input' }, [
            el('span', { text: m + ':' }),
            inp,
          ]));
          inp.addEventListener('change', () => { monthlyInputs[m] = inp.value; updateTotal(); });
        });
        updateTotal();
      };

      ref = { yy, yearMonths, monthlyInputs, removed: false };
      row = el('div', { class: 'div-yedit-row div-yedit-row-us' }, [
        el('div', { class: 'div-year-input-group' }, [yy, monthsGrid]),
        breakdownWrap,
        rm,
      ]);

      // Restore what was actually saved per month. Older rows only have a flat
      // year amount (`a`) — spread it evenly as a best-effort starting point.
      if (presetPerMonth) {
        Object.keys(presetPerMonth).forEach((m) => {
          if (yearMonths.has(m)) monthlyInputs[m] = presetPerMonth[m];
        });
      } else if (a != null && a !== '' && yearMonths.size > 0) {
        const per = (Number(a) || 0) / yearMonths.size;
        [...yearMonths].forEach((m) => { monthlyInputs[m] = per; });
      }

      updateBreakdown();
    } else {
      // India: show units + per-month breakdown with live total calculation.
      const uu = numInput(a, 'Units');
      const breakdownWrap = el('div', { class: 'div-india-breakdown' });
      const monthInputsWrap = el('div', { class: 'div-india-month-inputs' });

      // Summary nodes are created ONCE and updated in place (textContent only)
      // on every change — never recreated/re-appended. Recreating on each
      // keystroke/fetch was appending a fresh copy on top of the old one every
      // time instead of replacing it, so the calculation appeared to pile up.
      const calcSpan = el('span', { class: 'div-breakdown-calc' });
      const totalSpan = el('span', { class: 'div-breakdown-total' });
      breakdownWrap.appendChild(monthInputsWrap);
      breakdownWrap.appendChild(el('div', { class: 'div-breakdown-summary' }, [calcSpan, totalSpan]));

      const updateTotal = () => {
        const units = Number(uu.value) || 0;
        const perMonthVals = Object.values(monthlyInputs).map((v) => Number(v) || 0);
        const sum = perMonthVals.reduce((a, b) => a + b, 0);
        const yearTotal = units * sum;
        calcSpan.textContent = perMonthVals.length ? perMonthVals.join(' + ') + ' = ' + sum.toFixed(2) : '—';
        totalSpan.textContent = units + ' × ' + sum.toFixed(2) + ' = ' + mod.fmtDiv(yearTotal, 'INR');
      };

      // Reassigns the outer `let updateBreakdown` stub — must NOT be `const`
      // here. The month-button click handler above (outside this market-
      // specific block) closes over that OUTER binding; a `const` here would
      // shadow it with a separate variable the click handler never sees, so
      // clicking a month would keep calling the do-nothing stub forever —
      // toggling a month wouldn't add/remove its box or recalculate anything,
      // despite the button's own active state still visibly changing.
      updateBreakdown = () => {
        monthInputsWrap.innerHTML = '';
        [...yearMonths].sort((m1, m2) => mod.MONTHS.indexOf(m1) - mod.MONTHS.indexOf(m2)).forEach((m) => {
          const inp = numInput(monthlyInputs[m], m.slice(0, 3) + '/u');
          monthlyInputs[m] = inp.value;
          const label = el('label', { class: 'div-month-input' }, [
            el('span', { text: m + ':' }),
            inp,
          ]);
          monthInputsWrap.appendChild(label);
          inp.addEventListener('change', () => { monthlyInputs[m] = inp.value; updateTotal(); });
        });
        updateTotal();
      };

      uu.addEventListener('change', updateTotal);

      // Last fetched date display
      const lastFetchedSpan = el('span', { class: 'div-fetch-date', text: '—' });

      // Fetch button to get latest units from linked stock (only for current year)
      const curYear = new Date().getFullYear();
      const isCurYear = year === curYear;
      const fetchBtn = el('button', {
        class: 'btn ghost small' + (isCurYear ? '' : ' hidden'), type: 'button', text: '↻',
        onclick: () => {
          if (linkedStock) {
            uu.value = linkedStock.units || '';
            const now = new Date().toLocaleDateString('en-IN', { year: '2-digit', month: '2-digit', day: '2-digit' });
            lastFetchedSpan.textContent = now;
            if (typeof updateTotal === 'function') updateTotal();
          }
        },
      });

      ref = { yy, uu, yearMonths, monthlyInputs, removed: false };
      row = el('div', { class: 'div-yedit-row div-yedit-row-india' }, [
        el('div', { class: 'div-year-left-col' }, [
          el('div', { class: 'div-year-input-group' }, [yy, monthsGrid]),
          el('div', { class: 'div-units-group' }, [
            el('div', { class: 'div-units-row' }, [
              el('span', { class: 'div-units-label-text', text: 'Units' }),
              el('div', { class: 'div-units-input-row' }, [
                uu,
                fetchBtn,
              ]),
            ]),
            el('div', { class: 'div-fetch-info' }, [
              el('span', { text: 'Fetched: ' }),
              lastFetchedSpan,
            ]),
          ]),
        ]),
        el('div', { class: 'div-year-right-col' }, [
          breakdownWrap,
        ]),
        rm,
      ]);

      // Pre-populate the actual per-month values saved for this year. Records
      // saved before per-month storage existed only have a flat perUnit total
      // (b2) with no breakdown — for those only, fall back to splitting it
      // evenly across this year's months as a best-effort guess.
      if (presetPerMonth) {
        Object.keys(presetPerMonth).forEach((m) => {
          if (yearMonths.has(m)) monthlyInputs[m] = presetPerMonth[m];
        });
      } else if (b2 != null && b2 !== '') {
        const perUnit = Number(b2) || 0;
        if (yearMonths.size > 0) {
          const perMonth = perUnit / yearMonths.size;
          [...yearMonths].forEach((m) => { monthlyInputs[m] = perMonth; });
        }
      }

      // Initial render.
      updateBreakdown();
    }
    rm.addEventListener('click', () => { row.remove(); ref.removed = true; });
    yearRefs.push(ref);
    yearRowsWrap.appendChild(row);
  };

  const usAmountOf = (y) => (y.amount != null ? y.amount : (y.units != null && y.perUnit != null ? (Number(y.units) || 0) * (Number(y.perUnit) || 0) : ''));
  const curYear = new Date().getFullYear();

  const rawStartYear = linkedStock && Number.isFinite(Number(linkedStock.startYear)) ? Number(linkedStock.startYear) : null;
  const startYear = rawStartYear != null ? Math.min(Math.max(rawStartYear, curYear - 50), curYear) : null;

  // Saved years, minus any that predate the stock's Started year and hold
  // nothing (see dividend.js visibleYears) — a stock started in 2026 shouldn't
  // offer a 2025 row. Dropping them from the slider also drops them from the
  // record on the next save, since collectYears() only reads rows on screen.
  const keepYears = new Set(mod.visibleYears(rec, startYear));
  const sortedYears = (rec.years || [])
    .filter((y) => keepYears.has(Number(y.year)))
    .sort((x, y) => Number(y.year) - Number(x.year));

  // Collect all years: every year with saved data, the current year, and —
  // since there's no "+ Add year" button any more — every year from the
  // linked stock's "Started (year)" field (set on the Stocks edit form)
  // through the current year, so a stock held since e.g. 2020 can still
  // have its 2020-2025 dividends entered even with nothing saved for them
  // yet. Ignored if unset, later than this year, or absurdly early (a typo
  // like "202" instead of "2020" would otherwise generate ~1800 empty rows).
  let allYears = sortedYears.map((y) => y.year);
  if (!allYears.includes(curYear)) allYears.push(curYear);
  if (startYear) {
    for (let y = startYear; y <= curYear; y++) allYears.push(y);
  }
  allYears = [...new Set(allYears)].sort((a, b) => b - a); // unique, newest first

  // Whether this stock already had a current-year entry before opening the form
  // (used only for the pending notice below — the row itself is always created).
  const hasCurYear = sortedYears.some(y => y.year === curYear);

  // Track which year is currently being viewed in the slider
  let sliderCurrentYear = curYear;

  // Store row elements by year for toggling visibility
  const rowsByYear = new Map();

  // Override addYearRow to track rows by year and manage slider visibility
  const originalAddYearRow = addYearRow;
  addYearRow = (year, a, b2, preSelectMonths = [], presetPerMonth = null) => {
    originalAddYearRow(year, a, b2, preSelectMonths, presetPerMonth);
    const lastRow = yearRowsWrap.lastChild;
    if (lastRow) {
      rowsByYear.set(year, lastRow);
      lastRow.classList.add('div-year-row-item');
      lastRow.setAttribute('data-year', year);
    }
  };

  // Load every saved year into the slider, using THAT year's own saved months
  // (and, for India, its own per-month breakdown) — not a global list shared
  // across every year, which previously meant unchecking a month in one year
  // didn't stick (it kept reappearing from other years' months on reload) and
  // reopening a year always re-split its total evenly instead of restoring
  // what was actually entered per month. Records saved before this fix have
  // no per-year `months`/`perMonth` yet — fall back to the old record-level
  // `rec.months` list for those only, with no per-month breakdown to restore.
  sortedYears.forEach((y) => addYearRow(
    y.year,
    isUs ? usAmountOf(y) : y.units,
    isUs ? undefined : y.perUnit,
    y.months ? y.months : (isUs ? [] : mod.parseMonths(rec.months)),
    y.perMonth || null,
  ));

  // Every OTHER year in allYears (the current year, plus anything opened up
  // by the stock's Started-year range) gets an empty row too, so it's
  // reachable via the slider — there's no "+ Add year" button to create it
  // on demand any more. Default months guess from the most recent prior
  // year that actually has data (a reasonable bet the stock keeps paying in
  // the same months), falling back to the legacy record-level list.
  const yearsWithData = new Set(sortedYears.map((y) => y.year));
  const priorMonths = (sortedYears[0] && sortedYears[0].months) ? sortedYears[0].months
    : (isUs ? [] : mod.parseMonths(rec.months));
  allYears.filter((y) => !yearsWithData.has(y)).sort((a, b) => a - b).forEach((y) => {
    addYearRow(y, isUs ? '' : currentUnits, '', priorMonths, null);
  });

  // Create slider navigation
  const showYear = (year) => {
    sliderCurrentYear = year;
    rowsByYear.forEach((row, y) => {
      row.classList.toggle('hidden', y !== year);
    });
    yearLabel.textContent = String(year);
    prevBtn.disabled = allYears.indexOf(year) >= allYears.length - 1;
    nextBtn.disabled = allYears.indexOf(year) <= 0;
  };

  const prevBtn = el('button', { class: 'icon-btn', type: 'button', text: '◀', onclick: () => {
    const idx = allYears.indexOf(sliderCurrentYear);
    if (idx < allYears.length - 1) showYear(allYears[idx + 1]);
  }});
  const nextBtn = el('button', { class: 'icon-btn', type: 'button', text: '▶', onclick: () => {
    const idx = allYears.indexOf(sliderCurrentYear);
    if (idx > 0) showYear(allYears[idx - 1]);
  }});
  const yearLabel = el('span', { class: 'div-year-label', text: String(curYear), style: 'font-weight:700; min-width:40px; text-align:center' });

  const sliderNav = el('div', { class: 'div-slider-nav', style: 'display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:10px' }, [prevBtn, yearLabel, nextBtn]);
  yearRowsWrap.insertBefore(sliderNav, yearRowsWrap.firstChild);

  // Current year always has a row (created above), so open straight on it.
  showYear(curYear);

  const collectYears = () => {
    const map = new Map();
    for (const r of yearRefs) {
      if (r.removed) continue;
      const y = parseInt(r.yy.value, 10);
      if (!Number.isFinite(y)) continue;
      // This year's own months — saved per-year so unchecking a month here
      // doesn't get overwritten by another year's selection on next open.
      const yearMonthsArr = [...r.yearMonths].sort((m1, m2) => mod.MONTHS.indexOf(m1) - mod.MONTHS.indexOf(m2));
      // The slider hands every year in range a row whether or not it's been
      // filled in, so skip the untouched ones — otherwise merely OPENING the
      // form writes a blank entry for every year offered, which is how records
      // ended up listing years the stock never paid in (and, before the
      // Started-year filter, years it wasn't even held for). A year with
      // months ticked but no figures yet is deliberate, so it's kept.
      const anyFigure = Object.values(r.monthlyInputs || {}).some((v) => (Number(v) || 0) !== 0);
      if (!yearMonthsArr.length && !anyFigure) continue;
      if (isUs) {
        // Per-month figures are the source of truth; `amount` is their sum,
        // kept so the older flat-amount readers keep working.
        let perMonth = null, amount = null;
        if (r.monthlyInputs && Object.keys(r.monthlyInputs).length > 0) {
          perMonth = {};
          let sum = 0;
          Object.keys(r.monthlyInputs).forEach((m) => {
            const v = Number(r.monthlyInputs[m]) || 0;
            perMonth[m] = v;
            sum += v;
          });
          amount = sum;
        }
        map.set(y, { year: y, amount, months: yearMonthsArr, perMonth });
      } else {
        // India: keep the exact per-month breakdown (so reopening restores
        // what was actually typed, not an evenly-split guess) alongside the
        // summed perUnit (still needed by yearTotal()'s units*perUnit math).
        let perUnit = null;
        let perMonth = null;
        if (r.monthlyInputs && Object.keys(r.monthlyInputs).length > 0) {
          perMonth = {};
          let sum = 0;
          Object.keys(r.monthlyInputs).forEach((m) => {
            const v = Number(r.monthlyInputs[m]) || 0;
            perMonth[m] = v;
            sum += v;
          });
          perUnit = sum > 0 ? sum : null;
        }
        map.set(y, { year: y, units: num(r.uu.value) || 0, perUnit, months: yearMonthsArr, perMonth });
      }
    }
    return [...map.values()].sort((x, y) => x.year - y.year);
  };

  const save = async () => {
    // Collect all unique months from all year rows.
    const allMonths = new Set();
    for (const r of yearRefs) {
      if (!r.removed) r.yearMonths.forEach((m) => allMonths.add(m));
    }
    const out = Object.assign({}, rec, {
      months: [...allMonths].sort((a, b2) => mod.MONTHS.indexOf(a) - mod.MONTHS.indexOf(b2)),
      years: collectYears(),
      updatedAt: new Date().toISOString(),
    });
    // Display-only, owned by the stock — never store a copy that can go stale.
    delete out._startYear;
    await DB.put('dividends', out);
    closeModal(); toast('Saved'); renderDividend();
  };

  const yearHead = isUs
    ? el('div', { class: 'div-yedit-head div-yedit-head-us' }, [el('span', { text: 'Year & months' }), el('span', { text: 'Dividend per month' }), el('span')])
    : el('div', { class: 'div-yedit-head' }, [el('span', { text: 'Year & months' }), el('span', { text: 'Units' }), el('span', { text: 'Div/unit' }), el('span')]);
  const content = el('div', {}, [
    field(isUs ? 'Per-year months & dividend received' : 'Per-year months, units & dividend per unit', el('div', {}, [
      el('p', { class: 'hint', style: 'margin:0 0 8px', text: 'Tap month initials to mark which months this year paid. Global months list updates from all years.' }),
      yearHead,
      yearRowsWrap,
    ])),
  ]);
  const headerContent = [
    el('h2', { text: rec.name || 'Edit stock' }),
    el('p', { class: 'hint', text: (isUs ? 'US ($)' : 'India (₹)') + ' · name and market are set on the Stocks edit form.' }),
  ];

  headerContent.push(content);

  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, headerContent),
    el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ])]),
  ]));
}
