import { DB } from './db.js';
import { fmtCur, pctClass, fmtPct, num, todayISO } from './core.js';
import { setAppMode, el, helpDot, $, updateMfNavActive, _mfTab, b, explainRow, daysSince, formatTimeDuration, MF_TYPES, MF_STATUS, field, appConfirm, closeModal, toast, moreOptions, openModal, _normName, showLoader, setLoader, hideLoader, appAlert } from './app.js';

// ---------- Mutual Funds surface ----------
let _mfFilter = 'investing'; // 'investing' | 'sold' (holding vs redeemed - not SIP status)
let _mfSort = 'ret';        // 'ret' | 'xirr' | 'inv' | 'name' (default: Return %)
let _mfBenchTab = 'returns';  // 'returns' | 'xirr' (sub-tabs within benchmark)
let _mfStatsTab = 'day';      // 'day' | 'month' | 'year' (sub-tabs within stats)
// Lazy-loaded: mf.js (logic + seed data) only loads when the user opens MF.
export async function openMF() {
  setAppMode('mf');
}

export const _mfCell = (k, v, cls, help) => el('div', { class: 'cell' }, [
  el('div', { class: 'k', text: k }, help ? [helpDot(help)] : null),
  el('div', { class: 'v ' + (cls || ''), text: v }),
]);

export async function renderMF() {
  const host = $('#mfView');
  host.innerHTML = '';
  const mod = await import('./mf.js');
  const funds = (await DB.byIndex('funds', 'owner', 'me')) || [];
  const now = Date.now();
  const rows = funds.map((f) => ({ f, c: mod.computeFund(f, now) }));

  // No funds at all → simple empty state (tabs would be pointless).
  if (!funds.length) {
    updateMfNavActive();
    host.appendChild(el('section', { class: 'summary' }, [
      el('div', { class: 'label', text: 'Current value' }),
      el('div', { class: 'big', text: fmtCur(0, 'INR') }),
    ]));
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '📊' }),
      el('p', { text: 'No funds yet.' }),
      el('p', { class: 'hint', text: 'Tap + to add your first mutual fund.' }),
    ]));
    return;
  }

  // Holding vs sold split (SIP state is irrelevant - a paused SIP is still held).
  const soldRows = rows.filter(({ c }) => c.sold);
  const heldRows = rows.filter(({ c }) => !c.sold);
  const viewSold = _mfFilter === 'sold';
  const list = (viewSold ? soldRows : heldRows).slice();

  // Totals over the funds currently shown. Emergency-Fund-linked funds stay in
  // the list (badged) but are excluded from every figure here — that surface owns
  // them now, and mixing an emergency Liquid fund into long-term equity return
  // and XIRR would misrepresent both. Same split SGBs have with Metals.
  let totInv = 0, totVal = 0, aboveBench = 0, benchCount = 0, wSum = 0, wW = 0;
  list.forEach(({ f, c }) => {
    if (f.emergencyFund) return;
    totInv += c.invested; totVal += c.value;
    if (c.benchStatus) { benchCount++; if (c.benchStatus === 'above') aboveBench++; }
    if (c.xirr != null && c.value > 0) { wSum += c.xirr * c.value; wW += c.value; }
  });
  const gainPct = totInv > 0 ? ((totVal - totInv) / totInv) * 100 : 0;
  const wXirr = wW > 0 ? (wSum / wW) * 100 : null;

  // Tab: Holdings (fund list) | Overview (summary + allocation) | Benchmark - the fixed
  // #mfBottomNav (built by setAppMode) drives the tab, this just syncs its active state.
  updateMfNavActive();

  // Show FABs only on Holdings tab (+ ☁️ NAV fetch also on Stats, since Stats
  // data is populated by that same fetch).
  $('#mfAddBtn').classList.toggle('hidden', _mfTab !== 'holdings');
  $('#mfFetchBtn').classList.toggle('hidden', _mfTab !== 'holdings' && _mfTab !== 'stats');
  // ☁️ is normally docked left of the + FAB (fab-secondary's fixed offset assumes
  // + is there). On Stats, + is hidden, so ☁️ would float with an empty gap where
  // + used to be - .solo docks it to the corner + would have occupied instead.
  $('#mfFetchBtn').classList.toggle('solo', _mfTab === 'stats');

  // Holdings tab content: fund list with filter/sort
  const holdContent = el('div', { class: 'tab-content' + (_mfTab === 'holdings' ? '' : ' hidden') });
  const ovrvContent = el('div', { class: 'tab-content' + (_mfTab === 'overview' ? '' : ' hidden') });
  const benchContent = el('div', { class: 'tab-content' + (_mfTab === 'benchmark' ? '' : ' hidden') });
  const statsContent = el('div', { class: 'tab-content' + (_mfTab === 'stats' ? '' : ' hidden') });

  // Summary (shown in Overview tab only)
  const cells = [
    _mfCell('Invested', fmtCur(totInv, 'INR')),
    _mfCell('Returns Earned', fmtCur(totVal - totInv, 'INR'), pctClass(gainPct)),
    _mfCell(viewSold ? 'Realized XIRR' : 'Portfolio XIRR', wXirr != null ? fmtPct(wXirr) : '-', wXirr != null ? pctClass(wXirr) : '', 'xirr'),
    _mfCell('Above benchmark', benchCount ? `${aboveBench} of ${benchCount}` : '-'),
  ];

  // Summary is common to Holdings/Overview tabs only (hidden for Benchmark/Stats tabs).
  // Current value + Current Return share the top row (value on the left,
  // gain % on the right).
  const summarySec = el('section', { class: 'summary' + (_mfTab === 'benchmark' || _mfTab === 'stats' ? ' hidden' : '') }, [
    el('div', { class: 'row-between summary-top' }, [
      el('div', {}, [
        el('div', { class: 'label', text: viewSold ? 'Realized value' : 'Current value' }),
        el('div', { class: 'big', text: fmtCur(totVal, 'INR') }),
      ]),
      el('div', { class: 'summary-earned' }, [
        el('div', { class: 'label', text: viewSold ? 'Realized gain' : 'Current Return' }),
        el('div', { class: 'v ' + pctClass(gainPct), text: fmtPct(gainPct) }),
      ]),
    ]),
    el('div', { class: 'grid' }, cells),
  ]);

  // Filter + Sort + Update button (top of holdings tab)
  const filterSeg = el('div', { class: 'seg' }, [['investing', `Investing (${heldRows.length})`], ['sold', `Sold (${soldRows.length})`]].map(([v, l]) =>
    el('button', { class: (_mfFilter === v ? 'active' : ''), 'data-filter': v, type: 'button', text: l, onclick: () => { _mfFilter = v; renderMF(); } })));
  const sortbar = el('div', { class: 'sortbar mf-sortbar' }, [['xirr', 'XIRR'], ['ret', 'Return'], ['inv', 'Invested'], ['name', 'Name']].map(([v, l]) =>
    el('button', { class: 'sort-btn' + (_mfSort === v ? ' active' : ''), type: 'button', text: l, onclick: () => { _mfSort = v; renderMF(); } })));
  const toolbarTop = el('div', { class: 'toolbar mf-toolbar-top' }, [filterSeg, sortbar]);

  holdContent.appendChild(toolbarTop);

  if (!list.length) {
    holdContent.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: viewSold ? '🧾' : '📈' }),
      el('p', { text: viewSold ? 'No sold funds.' : 'No funds you are holding.' }),
    ]));
  } else {
    list.sort((a, b) => {
      if (_mfSort === 'name') return (a.f.name || '').localeCompare(b.f.name || '');
      if (_mfSort === 'inv') return b.c.invested - a.c.invested;
      if (_mfSort === 'ret') return b.c.absReturnPct - a.c.absReturnPct;
      const av = a.c.xirr == null ? -Infinity : a.c.xirr, bv = b.c.xirr == null ? -Infinity : b.c.xirr;
      return bv - av;
    });

    const listWrap = el('section', { class: 'stock-list' });
    list.forEach(({ f, c }) => listWrap.appendChild(_mfCard(f, c)));
    holdContent.appendChild(listWrap);
  }

  holdContent.appendChild(explainRow('About XIRR', viewSold
    ? 'Sold funds show your realized XIRR - from your dated investments to the sold value. Not investment advice.'
    : 'XIRR is computed from your dated investments. Funds marked "(sheet)" still use your sheet\'s figure - add a real investment to switch to app-computed XIRR. Not investment advice.', 'How the return is worked out'));

  // Overview tab content: allocation (summary is common, rendered above both tabs).
  const byType = {};
  list.forEach(({ f, c }) => { const k = f.type || 'Other'; byType[k] = (byType[k] || 0) + c.invested; });
  const types = Object.keys(byType).sort((a, b) => byType[b] - byType[a]);
  if (types.length && totInv > 0) {
    const alloc = el('div', { class: 'chart-card' }, [el('h3', { text: 'Allocation by type' })]);
    types.forEach((t) => {
      const pct = (byType[t] / totInv) * 100;
      alloc.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: t }),
        el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: `width:${Math.max(2, pct).toFixed(1)}%` })]),
        el('span', { class: 'bn', text: pct.toFixed(2) + '%' }),
      ]));
    });
    ovrvContent.appendChild(alloc);
  }

  // Top/Bottom performers by return
  if (list.length > 0) {
    const sorted = [...list].sort((a, b) => b.c.absReturnPct - a.c.absReturnPct);
    const topBottom = el('div', { class: 'chart-card' }, [el('h3', { text: 'Top & bottom performers' })]);
    const top3 = sorted.slice(0, 3);
    const bottom3 = sorted.slice(-3).reverse();
    [['Top', top3, 'mf-perf-top'], ['Bottom', bottom3, 'mf-perf-bottom']].forEach(([label, funds, cls]) => {
      topBottom.appendChild(el('div', { class: 'mf-perf-section' }, [
        el('div', { class: 'mf-perf-label', text: label }),
        el('div', { class: cls }, funds.map(({ f, c }) =>
          el('div', { class: 'mf-perf-item' }, [
            el('span', { class: 'mf-perf-name', text: f.name.length > 25 ? f.name.substring(0, 22) + '…' : f.name }),
            el('span', { class: 'mf-perf-ret ' + pctClass(c.absReturnPct), text: fmtPct(c.absReturnPct) }),
          ]))),
      ]));
    });
    ovrvContent.appendChild(topBottom);
  }

  // Performance attribution: top gains in INR
  if (list.length > 0) {
    const byGain = [...list].map(({ f, c }) => ({ f, c, gain: c.value - c.invested })).sort((a, b) => b.gain - a.gain);
    const topGain = byGain.slice(0, 5);
    const attr = el('div', { class: 'chart-card' }, [el('h3', { text: 'Top contributors (absolute gain)' })]);
    topGain.forEach(({ f, c, gain }) => {
      attr.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: f.name.length > 20 ? f.name.substring(0, 17) + '…' : f.name }),
        el('span', { class: 'bar-track' }, [el('span', { class: 'bar-fill', style: `width:${Math.max(2, (gain / (byGain[0].gain || 1)) * 100).toFixed(1)}%` })]),
        el('span', { class: 'bn', text: fmtCur(gain, 'INR') }),
      ]));
    });
    ovrvContent.appendChild(attr);
  }

  // Goal progress: toward 2030 target
  if (!viewSold && totVal > 0) {
    let target2030 = 0;
    heldRows.forEach(({ c }) => {
      if (c.targetYear === 2030 && c.projCorpusStay != null) target2030 += c.projCorpusStay;
    });
    if (target2030 > 0) {
      const progress = Math.min(100, (totVal / target2030) * 100);
      const goalCard = el('div', { class: 'chart-card' }, [
        el('h3', { text: '2030 Goal progress' }),
        el('div', { class: 'mf-goal-row' }, [
          el('span', { class: 'mf-goal-current', text: fmtCur(totVal, 'INR') }),
          el('span', { class: 'mf-goal-track' }, [el('div', { class: 'mf-goal-fill', style: `width:${progress}%` })]),
          el('span', { class: 'mf-goal-target', text: fmtCur(target2030, 'INR') }),
        ]),
        el('div', { class: 'mf-goal-meta', text: progress.toFixed(2) + '% toward target' }),
      ]);
      ovrvContent.appendChild(goalCard);
    }
  }

  // Benchmark tab content: sub-tabs for Returns and XIRR with different color schemes
  const benchRetContent = el('div', { class: 'tab-content' + (_mfBenchTab === 'returns' ? '' : ' hidden') });
  const benchXirrContent = el('div', { class: 'tab-content' + (_mfBenchTab === 'xirr' ? '' : ' hidden') });

  // Interpolate the current-value badge colour along the same gradient the bar uses,
  // so a value near the low end reads light (light-green for Returns / yellow for XIRR)
  // and near the high end reads dark (dark-green / orange). Endpoints are read from the
  // --bench-*-light/dark CSS vars so both themes stay correct; text flips to dark on
  // light backgrounds for contrast.
  const readVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hexToRgb = (h) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((ch) => ch + ch).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  const badgeStyle = (scheme, t) => {
    const lo = hexToRgb(readVar('--bench-' + scheme + '-light') || '#86efac');
    const hi = hexToRgb(readVar('--bench-' + scheme + '-dark') || '#16a34a');
    const mix = lo.map((v, i) => Math.round(v + (hi[i] - v) * t));
    const lum = 0.299 * mix[0] + 0.587 * mix[1] + 0.114 * mix[2];
    return `background:rgb(${mix[0]},${mix[1]},${mix[2]});color:${lum > 150 ? '#0b1220' : '#fff'}`;
  };

  // Helper to create benchmark visualization with custom gradient.
  // `metricPct` must already be a percent NUMBER (e.g. 79.27 for 79.27%) — same unit
  // fmtPct expects. f.benchReturnLow/High and f.benchXirrLow/High are stored as
  // DECIMALS (e.g. 0.1 for 10%), so those need *100 to reach percent-number form;
  // metricPct (c.absReturnPct / c.xirrPct from mf.js) is percent-number already and
  // must NOT be multiplied or divided again — that double-conversion was the bug
  // behind "79.27% shows as 0.79%".
  // Low/high bound: the user's manual target wins when set (same priority as
  // mf.js's benchStatus); otherwise falls back to the fund's own auto-tracked
  // historical range. That range comes from `c.liveReturnLow/High` /
  // `c.liveXirrLow/High` (mf.js), NOT the raw stored f.returnLow/High - the
  // stored fields only move on the next save, so reading them straight would
  // show a stale high the moment current beats it, even though the status
  // badge already says "above" (the exact bug reported: current 20.25% vs a
  // stored high still showing 20.11%). The live fields fold today's reading
  // into the bound immediately, before any save persists it.
  const createBenchViz = (funds, metricPct, metricKey, colorScheme) => {
    const container = el('div', { class: 'mf-bench-list' });
    funds.forEach(({ f, c }) => {
      const manualLowKey = metricKey === 'return' ? 'benchReturnLow' : 'benchXirrLow';
      const manualHighKey = metricKey === 'return' ? 'benchReturnHigh' : 'benchXirrHigh';
      const manualLow = f[manualLowKey] != null ? f[manualLowKey] * 100 : null;
      const manualHigh = f[manualHighKey] != null ? f[manualHighKey] * 100 : null;
      const obsLow = metricKey === 'return' ? c.liveReturnLow : c.liveXirrLow;
      const obsHigh = metricKey === 'return' ? c.liveReturnHigh : c.liveXirrHigh;
      const current = metricPct || 0;
      let low = manualLow != null ? manualLow : (obsLow != null ? obsLow : 0);
      let high = manualHigh != null ? manualHigh : (obsHigh != null ? obsHigh : (metricKey === 'return' ? 30 : 15));
      // The drawn bar must always contain `current`. A MANUAL high/low is a fixed
      // target ("never changed automatically"), so when current shoots past it the
      // bound can't grow on its own — the marker would pin at the edge with its
      // badge dangling past the labelled bound (the reported bug: high shows 20.11
      // but current is 23.71). Expand the DISPLAYED range to swallow current so it
      // renders as the new peak/low instead. Stored manual target is untouched.
      if (current > high) high = current;
      if (current < low) low = current;
      // At the high threshold = all-time high (🏆, green). At the low threshold =
      // all-time low (🔻, red). Peak wins if somehow both (degenerate zero range).
      const isAtPeak = Math.abs(current - high) < 0.01;
      const isAtLow = !isAtPeak && Math.abs(current - low) < 0.01;
      const range = high - low;
      const position = range !== 0 ? ((current - low) / range) * 100 : 100;
      const clampedPct = Math.max(0, Math.min(100, position));
      const lowLabel = isAtLow
        ? el('span', { class: 'mf-bench-bottom', text: fmtPct(current) + ' 🔻', title: 'All-time low!' })
        : el('span', { class: 'mf-bench-low', text: fmtPct(low) });
      const highLabel = isAtPeak
        ? el('span', { class: 'mf-bench-peak', text: fmtPct(current) + ' 🏆', title: 'All-time high!' })
        : el('span', { class: 'mf-bench-high', text: fmtPct(high) });
      const trackChildren = [
        el('div', { class: 'mf-bench-fill', style: `width:${clampedPct}%` }),
        el('span', { class: 'mf-bench-marker', style: `left:${clampedPct}%`, title: 'Current: ' + fmtPct(current) }),
      ];
      // Current-value badge sits below the marker dot, colour-graded by position.
      // Skipped for peak/low rows since the value already shows in the 🏆/🔻 label.
      if (!isAtPeak && !isAtLow) {
        trackChildren.push(el('span', { class: 'mf-bench-value-badge', style: `left:${clampedPct}%;${badgeStyle(colorScheme, clampedPct / 100)}`, text: fmtPct(current) }));
      }
      const barElements = [
        lowLabel,
        el('div', { class: 'mf-bench-track ' + colorScheme }, trackChildren),
        highLabel,
      ];
      const rowChildren = [
        el('div', { class: 'mf-bench-name' }, f.name),
        el('div', { class: 'mf-bench-bar' }, barElements),
      ];
      const rowCls = 'mf-bench-row' + (isAtPeak ? ' mf-bench-peak-row' : isAtLow ? ' mf-bench-bottom-row' : ' mf-bench-row--badge');
      container.appendChild(el('div', { class: rowCls }, rowChildren));
    });
    return container;
  };

  // Returns tab (Red-Green gradient)
  if (heldRows.length > 0) {
    const retList = el('div');
    heldRows.forEach(({ f, c }) => {
      const vizNode = createBenchViz([{ f, c }], c.absReturnPct || 0, 'return', 'ret');
      retList.appendChild(vizNode.firstChild);
    });
    benchRetContent.appendChild(retList);
  }

  // XIRR tab (Orange-Yellow gradient)
  if (heldRows.length > 0) {
    const xirrList = el('div');
    heldRows.forEach(({ f, c }) => {
      const vizNode = createBenchViz([{ f, c }], c.xirrPct || 0, 'xirr', 'xirr');
      xirrList.appendChild(vizNode.firstChild);
    });
    benchXirrContent.appendChild(xirrList);
  }

  // Add sub-tabs to Benchmark tab
  const benchRetBtn = el('button', { class: 'sort-btn' + (_mfBenchTab === 'returns' ? ' active' : ''), type: 'button', text: 'Returns', onclick: () => { _mfBenchTab = 'returns'; renderMF(); } });
  const benchXirrBtn = el('button', { class: 'sort-btn' + (_mfBenchTab === 'xirr' ? ' active' : ''), type: 'button', text: 'XIRR', onclick: () => { _mfBenchTab = 'xirr'; renderMF(); } });
  benchContent.appendChild(el('div', { class: 'mf-bench-tabs' }, [benchRetBtn, benchXirrBtn]));
  benchContent.appendChild(benchRetContent);
  benchContent.appendChild(benchXirrContent);

  // Stats tab: Day / Month / Year NAV change per fund vs Nifty 50 (index-fund
  // proxy — mfapi.in has no direct Nifty index endpoint). Populated by the ☁️
  // NAV fetch (fetchMfNavs), which stores only the computed deltas per fund
  // (f.stats = {d1,m1,y1,asOf}) and one Nifty reading in meta.mfNiftyStats —
  // not raw daily history, so the on-device footprint stays negligible.
  const STATS_PERIODS = { day: 'd1', month: 'm1', year: 'y1' };
  const statsKey = STATS_PERIODS[_mfStatsTab];
  const niftyStatsMeta = await DB.get('meta', 'mfNiftyStats').catch(() => null);
  const niftyStats = niftyStatsMeta && niftyStatsMeta.value;
  const anyFundStats = heldRows.some(({ f }) => f.stats && f.stats[statsKey] != null);
  const badgeClassFor = (cls) => (cls === 'pos' ? 'good' : cls === 'neg' ? 'bad' : 'muted');

  const statsSubTabs = el('div', { class: 'mf-bench-tabs' }, [['day', 'Day'], ['month', 'Month'], ['year', 'Year']].map(([v, l]) =>
    el('button', { class: 'sort-btn' + (_mfStatsTab === v ? ' active' : ''), type: 'button', text: l, onclick: () => { _mfStatsTab = v; renderMF(); } })));
  statsContent.appendChild(statsSubTabs);

  if (!heldRows.length) {
    statsContent.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '⚖️' }),
      el('p', { text: 'No funds you are holding.' }),
    ]));
  } else if (!anyFundStats) {
    statsContent.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '⚖️' }),
      el('p', { text: 'No stats yet.' }),
      el('p', { class: 'hint', text: 'Tap ☁️ to fetch NAV history and compare against Nifty 50 (needs internet).' }),
    ]));
  } else {
    const niftyPct = niftyStats ? niftyStats[statsKey] : null;
    statsContent.appendChild(el('div', { class: 'mf-stats-nifty' }, [
      el('span', { text: 'Nifty 50 (index fund proxy)' }),
      el('span', { class: 'mf-stats-pct ' + (niftyPct != null ? pctClass(niftyPct) : 'flat'), text: niftyPct != null ? fmtPct(niftyPct) : '-' }),
    ]));

    const sortedFunds = heldRows.slice().sort((a, b2) => {
      const av = a.f.stats && a.f.stats[statsKey] != null ? a.f.stats[statsKey] : -Infinity;
      const bv = b2.f.stats && b2.f.stats[statsKey] != null ? b2.f.stats[statsKey] : -Infinity;
      return bv - av;
    });
    const statsList = el('section', { class: 'stock-list' });
    sortedFunds.forEach(({ f }) => {
      const pct = f.stats && f.stats[statsKey] != null ? f.stats[statsKey] : null;
      const delta = pct != null && niftyPct != null ? pct - niftyPct : null;
      const rowChildren = [
        el('span', { class: 'mf-stats-pct ' + (pct != null ? pctClass(pct) : 'flat'), text: pct != null ? fmtPct(pct) : '—' }),
      ];
      if (delta != null) {
        const dCls = pctClass(delta);
        rowChildren.push(el('span', { class: 'badge ' + badgeClassFor(dCls), text: (delta >= 0 ? '+' : '') + delta.toFixed(2) + '% vs Nifty' }));
      }
      statsList.appendChild(el('div', { class: 'card mf-stats-row', onclick: () => openFundForm(f) }, [
        el('div', { class: 'mf-stats-name', text: f.name }),
        el('div', { class: 'mf-stats-vals' }, rowChildren),
      ]));
    });
    statsContent.appendChild(statsList);

    const asOfFundRow = heldRows.find(({ f }) => f.stats && f.stats.asOf);
    const asOfTxt = (niftyStats && niftyStats.asOf) || (asOfFundRow && asOfFundRow.f.stats.asOf);
    statsContent.appendChild(el('p', { class: 'hint mf-foot', text: (asOfTxt ? 'As of ' + asOfTxt + '. ' : '') +
      'Nifty 50 is approximated via a Nifty 50 index fund\'s NAV — mfapi.in has no direct index endpoint reachable from the browser. Not investment advice.' }));
  }

  // Assemble the view — summary common (both tabs), then the active tab's content.
  host.appendChild(summarySec);
  host.appendChild(holdContent);
  host.appendChild(ovrvContent);
  host.appendChild(benchContent);
  host.appendChild(statsContent);
}

export function _mfValueCard(value, invested, sold, fmtFn) {
  const gain = value - invested;
  const isPositive = gain >= 0;
  const cardClass = 'mf-value-card ' + (isPositive ? 'positive' : 'negative');
  return el('span', { class: cardClass }, (fmtFn || ((v) => fmtCur(v, 'INR')))(value));
}

function _mfCard(f, c) {
  const xirrTxt = c.xirrPct != null ? fmtPct(c.xirrPct) : '-';
  // Benchmark status badge (user-defined thresholds → Below / Within / Above).
  const benchBadge = c.benchStatus === 'above' ? el('span', { class: 'badge good mf-beat', text: 'above bench' })
    : c.benchStatus === 'below' ? el('span', { class: 'badge bad mf-beat', text: 'below bench' })
    : c.benchStatus === 'within' ? el('span', { class: 'badge muted mf-beat', text: 'within bench' }) : null;
  const statusTxt = c.sold ? ('Sold' + (c.soldDate ? ' · ' + c.soldDate : '')) : (f.status || '');
  const catLine = el('div', { class: 'cat mf-catline' }, [(f.type || '') + (statusTxt ? ' · ' + statusTxt : '')]);
  if (c.sold) catLine.appendChild(el('span', { class: 'badge muted mf-beat', text: 'sold' }));
  // Still listed here, but its money is counted on the Emergency Fund page.
  if (f.emergencyFund) catLine.appendChild(el('span', { class: 'badge ef-badge mf-beat', text: 'EF' }));
  if (benchBadge) catLine.appendChild(benchBadge);
  const xirrLabel = c.xirrSource === 'sheet' ? 'XIRR (sheet)' : c.xirrSource === 'realized' ? 'Realized XIRR' : 'XIRR';

  // Calculate fund start date and last invested date
  const contribDates = (f.contributions || []).filter(c => c.date).map(c => c.date).sort();
  const fundStartDays = contribDates.length ? daysSince(contribDates[0]) : null;
  const lastInvestDays = contribDates.length ? daysSince(contribDates[contribDates.length - 1]) : null;
  const fundStartTxt = fundStartDays != null ? formatTimeDuration(fundStartDays) : '-';
  const lastInvestTxt = lastInvestDays != null ? formatTimeDuration(lastInvestDays) : '-';

  // Balanced card: name + status badge, Return headline (the intuitive number),
  // then Value/XIRR + Invested. Everything else (units, avg/latest NAV, observed
  // range, remarks) lives in the fund form which opens on tap.
  const card = el('div', { class: 'card', onclick: () => openFundForm(f) }, [
    el('div', { class: 'top' }, [
      el('div', { class: 'card-left' }, [
        el('div', { class: 'name', text: f.name }),
        catLine,
      ]),
      el('div', { class: 'card-right' }, [
        el('div', { class: 'pct ' + pctClass(c.absReturnPct), text: fmtPct(c.absReturnPct) }),
        el('div', { class: 'meta-line' }, [xirrLabel + ' ', el('b', { class: pctClass(c.xirrPct || 0) }, [xirrTxt])]),
      ]),
    ]),
    el('div', { class: 'sub mf-sub2' }, [
      el('span', {}, [el('div', {}, ['Invested ', b(fmtCur(c.invested, 'INR'))]), el('div', { class: 'mf-meta-mini' }, ['Started ', b(fundStartTxt), ' | Last Invested ', b(lastInvestTxt)])]),
      el('span', { class: 'value-emphasis' }, [(c.sold ? 'Sold for ' : 'Value '), _mfValueCard(c.value, c.invested, c.sold)]),
    ]),
  ]);
  return card;
}

// Dated-investment editor: rows of { date, amount, units, nav, type }, type is
// 'buy' (default) or 'sell'. Units + amount drive total-units and invested (a
// sell reduces both, via average-cost-basis in mf.js); NAV is per-unit
// (auto-derived from amount/units when left blank). Powers XIRR and the
// units × latest-NAV value. Buy and Sell are separate sub-tabs (Buy default) -
// one shared `refs` array backs both so collect() sees a single combined log.
function buildContribEditor(contributions, getSip, onChange) {
  const buyRowsWrap = el('div', { class: 'hist-rows mf-txn-rows' });
  const sellRowsWrap = el('div', { class: 'hist-rows mf-txn-rows' });
  const buySummary = el('div', { class: 'mf-txn-summary' });
  const sellSummary = el('div', { class: 'mf-txn-summary' });
  const buyEmpty = el('div', { class: 'mf-txn-empty', text: 'No investments logged yet.' });
  const sellEmpty = el('div', { class: 'mf-txn-empty', text: 'No sales logged yet.' });
  const refs = [];

  // Row count + running ₹ total above each list, and a dashed empty-state
  // placeholder instead of a blank box when a fund has no buys/sells yet.
  const refreshSummary = (type) => {
    const rows = refs.filter((r) => !r.removed && r.type === type);
    const wrap = type === 'sell' ? sellRowsWrap : buyRowsWrap;
    const summaryEl = type === 'sell' ? sellSummary : buySummary;
    const emptyEl = type === 'sell' ? sellEmpty : buyEmpty;
    const has = rows.length > 0;
    wrap.classList.toggle('hidden', !has);
    summaryEl.classList.toggle('hidden', !has);
    emptyEl.classList.toggle('hidden', has);
    if (has) {
      const total = rows.reduce((s, r) => s + (num(r.amt.value) || 0), 0);
      const noun = type === 'sell' ? (rows.length === 1 ? 'sale' : 'sales') : (rows.length === 1 ? 'investment' : 'investments');
      summaryEl.innerHTML = '';
      summaryEl.appendChild(el('span', { text: rows.length + ' ' + noun }));
      summaryEl.appendChild(el('span', { text: (type === 'sell' ? 'Proceeds ' : 'Invested ') + fmtCur(total, 'INR') }));
    }
    // Deferred: refreshSummary also fires while buildContribEditor is still
    // constructing (seeding existing rows, before it's even been assigned to
    // its `const` in the caller) - onChange (the caller's live-recompute)
    // typically closes over that binding, so calling it synchronously here
    // would hit a TDZ error. A macrotask tick guarantees the caller's own
    // synchronous setup has finished first.
    if (typeof onChange === 'function') setTimeout(onChange, 0);
  };

  const addRow = (date, amount, units, nav, type, opts) => {
    const isSell = type === 'sell';
    const d = el('input', { class: 'txn-date', type: 'date', value: date || todayISO() });
    const amt = el('input', { class: 'txn-amt', type: 'number', inputmode: 'decimal', step: 'any', value: amount != null ? amount : '', placeholder: isSell ? 'Proceeds received ₹' : 'Amount invested ₹' });
    const u = el('input', { class: 'txn-units', type: 'number', inputmode: 'decimal', step: 'any', value: units != null ? units : '', placeholder: isSell ? 'Units sold' : 'Units purchased' });
    const nv = el('input', { class: 'txn-nav', type: 'number', inputmode: 'decimal', step: 'any', value: nav != null ? nav : '', placeholder: 'NAV' });
    const del = el('button', { class: 'icon-btn', type: 'button', text: '×' });
    const ref = { d, amt, u, nv, type: isSell ? 'sell' : 'buy', removed: false };
    // Convenience: derive whichever of amount/units/NAV is left blank from the
    // other two, so the user only ever has to type two of the three numbers.
    amt.addEventListener('blur', () => { autofill(); refreshSummary(ref.type); });
    u.addEventListener('blur', () => { autofill(); refreshSummary(ref.type); });
    nv.addEventListener('blur', () => { autofill(); refreshSummary(ref.type); });
    function autofill() {
      const a = num(amt.value), uu = num(u.value), vv = num(nv.value);
      if (a != null && uu != null && uu > 0 && vv == null) nv.value = Math.round((a / uu) * 10000) / 10000;
      else if (a != null && vv != null && vv > 0 && uu == null) u.value = Math.round((a / vv) * 10000) / 10000;
      else if (uu != null && vv != null && a == null) amt.value = Math.round(uu * vv * 100) / 100;
    }
    // Two tidy lines: (date · amount) then (units · NAV); delete sits on line 1.
    const row = el('div', { class: 'mf-txn-row' + (isSell ? ' mf-txn-row--sell' : '') }, [
      el('div', { class: 'txn-line' }, [d, amt, del]),
      el('div', { class: 'txn-line' }, [u, nv]),
    ]);
    del.addEventListener('click', () => { row.remove(); ref.removed = true; refreshSummary(ref.type); });
    refs.push(ref);
    // Rows load newest-first (see the initial sort below), so a freshly added
    // transaction - almost always the latest one there is - goes to the top
    // with them instead of the bottom, where it would read as the oldest.
    const wrap = isSell ? sellRowsWrap : buyRowsWrap;
    if (opts && opts.toTop) wrap.prepend(row); else wrap.appendChild(row);
    refreshSummary(ref.type);
  };
  (contributions || []).slice().sort((a, b2) => (b2.date || '').localeCompare(a.date || '')).forEach((c) => addRow(c.date, c.amount, c.units, c.nav, c.type));
  refreshSummary('buy'); refreshSummary('sell'); // covers the empty-fund case (no addRow calls above)

  const lastDateOf = (type) => refs.reduce((max, r) => (!r.removed && r.type === type && r.d.value && r.d.value > (max || '')) ? r.d.value : max, null);

  const addBuyBtn = el('button', {
    class: 'icon-btn', type: 'button', text: '+', title: 'Add investment',
    onclick: () => {
      // Default the new row's date to the latest transaction already logged
      // (not today) - most adds are "the next SIP month", so this saves a tap.
      addRow(lastDateOf('buy'), null, null, null, 'buy', { toTop: true });
    },
  });
  const addSellBtn = el('button', {
    class: 'icon-btn', type: 'button', text: '×', title: 'Add sale',
    onclick: () => addRow(lastDateOf('sell'), null, null, null, 'sell', { toTop: true }),
  });

  const buyTabBtn = el('button', { type: 'button', text: 'Buy', class: 'active' });
  const sellTabBtn = el('button', { type: 'button', text: 'Sell' });
  const buyPane = el('div', { class: 'mf-txn-pane' }, [buySummary, buyEmpty, buyRowsWrap, el('div', { class: 'mf-txn-btn-row' }, [addBuyBtn])]);
  const sellPane = el('div', { class: 'mf-txn-pane hidden' }, [sellSummary, sellEmpty, sellRowsWrap, el('div', { class: 'mf-txn-btn-row' }, [addSellBtn])]);
  buyTabBtn.addEventListener('click', () => {
    buyTabBtn.classList.add('active'); sellTabBtn.classList.remove('active');
    buyPane.classList.remove('hidden'); sellPane.classList.add('hidden');
  });
  sellTabBtn.addEventListener('click', () => {
    sellTabBtn.classList.add('active'); buyTabBtn.classList.remove('active');
    sellPane.classList.remove('hidden'); buyPane.classList.add('hidden');
  });

  const node = el('div', {}, [el('div', { class: 'seg' }, [buyTabBtn, sellTabBtn]), buyPane, sellPane]);
  const collect = () => {
    const out = [];
    for (const r of refs) {
      if (r.removed) continue;
      const dv = r.d.value;
      let av = num(r.amt.value), uu = num(r.u.value), vv = num(r.nv.value);
      if (r.type === 'sell') {
        if (!dv || uu == null) continue; // units sold is the one required field for a sale
        if (vv == null && av != null && uu > 0) vv = Math.round((av / uu) * 10000) / 10000;
        if (av == null && vv != null) av = Math.round(uu * vv * 100) / 100;
        if (av == null) continue; // no proceeds figure derivable yet - skip incomplete row
        out.push({ date: dv, amount: Math.round(av * 100) / 100, units: uu, nav: vv, type: 'sell' });
      } else {
        if (!dv || av == null) continue;
        if (uu == null && vv != null && vv > 0) uu = Math.round((av / vv) * 10000) / 10000;
        if (vv == null && uu != null && uu > 0) vv = Math.round((av / uu) * 10000) / 10000;
        out.push({ date: dv, amount: Math.round(av * 100) / 100, units: uu != null ? uu : null, nav: vv != null ? vv : null, type: 'buy' });
      }
    }
    out.sort((a, b2) => (b2.date || '').localeCompare(a.date || ''));
    return out;
  };
  return { node, collect };
}

// Widen the user's benchmark bands outward when a freshly computed value crosses
// them, so a new all-time high/low that lands on a NAV update becomes the band
// permanently (the user's request: "set the higher/lower band if current touches
// it, on NAV update"). Expand-ONLY — a reading that stays inside the band leaves
// it untouched, and a blank band (null = ignore) is never created here. Units:
// benchReturn* are decimals vs c.absReturnPct is a percent number (÷100 to match);
// benchXirr* are decimals vs c.xirr is already a decimal rate.
function widenBenchBands(rec, c) {
  const retDec = c.absReturnPct != null ? c.absReturnPct / 100 : null;
  if (retDec != null) {
    if (rec.benchReturnHigh != null && rec.benchReturnHigh !== '' && retDec > Number(rec.benchReturnHigh)) rec.benchReturnHigh = retDec;
    if (rec.benchReturnLow != null && rec.benchReturnLow !== '' && retDec < Number(rec.benchReturnLow)) rec.benchReturnLow = retDec;
  }
  const xr = c.xirr;
  if (xr != null) {
    if (rec.benchXirrHigh != null && rec.benchXirrHigh !== '' && xr > Number(rec.benchXirrHigh)) rec.benchXirrHigh = xr;
    if (rec.benchXirrLow != null && rec.benchXirrLow !== '' && xr < Number(rec.benchXirrLow)) rec.benchXirrLow = xr;
  }
}

export async function openFundForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const f = Object.assign({ owner: 'me', status: 'Investing', targetYear: 2030, sip: 0 }, existing || {});
  const mod = await import('./mf.js');

  const name = el('input', { type: 'text', value: f.name || '', placeholder: 'e.g. Quant Small Cap Fund' });
  const typeList = el('datalist', { id: 'mftypelist' }, MF_TYPES.map((t) => el('option', { value: t })));
  const type = el('input', { type: 'text', value: f.type || '', list: 'mftypelist', placeholder: 'Multi Cap, Small Cap…' });
  const category = el('input', { type: 'text', value: f.category || 'Equity', placeholder: 'Equity / Debt / Hybrid' });
  const status = el('select', {}, MF_STATUS.map((s) => { const o = el('option', { value: s, text: s }); if (s === f.status) o.selected = true; return o; }));
  const numInput = (v, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v != null && v !== '' ? v : '', placeholder: ph });
  const pctInput = (dec, ph) => numInput(dec != null && dec !== '' ? Math.round(Number(dec) * 10000) / 100 : '', ph);
  const sip = numInput(f.sip, 'Monthly SIP ₹ (0 if lumpsum)');
  const targetYear = numInput(f.targetYear || 2030, '2030');
  const goodReturn = el('input', { type: 'text', value: f.goodReturn || '', placeholder: 'e.g. 15%+ XIRR' });
  const remarks = el('textarea', { placeholder: 'Your notes' });
  remarks.value = f.remarks || '';

  // Latest NAV drives current value (units × NAV). Replaces the old manual value.
  const latestNav = numInput(f.latestNav, 'Latest NAV ₹');
  const navAsOf = el('input', { type: 'date', value: f.navAsOf || f.valueAsOf || todayISO() });

  // Linking a fund to the Emergency Fund hands ownership of it to that surface:
  // it stays listed here with an "EF" badge and keeps its live NAV fetch, but
  // leaves this page's totals and Home's Total Invested.
  const efChk = el('input', { type: 'checkbox' });
  efChk.checked = !!f.emergencyFund;
  const efSwitch = el('label', { class: 'switch' }, [
    efChk,
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
  ]);

  // Benchmark thresholds (user-defined %, stored as decimals; never auto-modified).
  const benchRetLo = pctInput(f.benchReturnLow, 'Low return %');
  const benchRetHi = pctInput(f.benchReturnHigh, 'High return %');
  const benchXirrLo = pctInput(f.benchXirrLow != null ? f.benchXirrLow : f.benchXirr, 'Low XIRR %');
  const benchXirrHi = pctInput(f.benchXirrHigh, 'High XIRR %');

  // Sold funds (Option 2): a single sold value + sold date drives the realized XIRR.
  const soldValue = numInput(f.soldValue, 'Sold value ₹');
  const soldDate = el('input', { type: 'date', value: f.soldDate || '' });
  const soldRow = el('div', { class: 'field-row' + (f.status === 'Sold' ? '' : ' hidden') }, [field('Sold value', soldValue), field('Sold on', soldDate)]);
  status.addEventListener('change', () => { soldRow.classList.toggle('hidden', status.value !== 'Sold'); });

  // Live units-held / avg-NAV readout, shown above the Buy/Sell sub-tabs on the
  // Fund Holdings tab - recomputed from the log itself (not the full computeFund
  // record) so it stays in sync as buys/sells are added, edited or removed.
  const unitsInfo = el('div', { class: 'mf-units-info' });
  const contribEditor = buildContribEditor(f.contributions, () => num(sip.value) || 0, () => refreshUnitsInfo());
  const refreshUnitsInfo = () => {
    const tmp = { contributions: contribEditor.collect() };
    const units = mod.totalUnitsOf(tmp);
    const avgNav = mod.avgNavOf(tmp);
    unitsInfo.innerHTML = '';
    if (units > 0) {
      unitsInfo.appendChild(el('span', {}, ['Units held ', b(units.toFixed(3))]));
      unitsInfo.appendChild(el('span', {}, ['Avg NAV ', b(avgNav != null ? fmtCur(avgNav, 'INR') : '—')]));
    } else {
      unitsInfo.appendChild(el('span', { class: 'hint', text: 'No units held yet — log a buy below.' }));
    }
  };
  refreshUnitsInfo();

  // Build a fund record from the current form inputs (used for save + live preview).
  const buildRec = () => {
    const contributions = contribEditor.collect();
    const isSold = status.value === 'Sold';
    const sv = num(soldValue.value);
    const ln = num(latestNav.value);
    const asOf = navAsOf.value || todayISO();
    const toDec = (inp) => { const v = num(inp.value); return v != null ? v / 100 : null; };
    return {
      owner: 'me',
      name: name.value.trim(),
      type: type.value.trim(),
      category: category.value.trim() || 'Equity',
      benchmark: f.benchmark || '',       // field removed from form; stored value preserved
      status: status.value,
      emergencyFund: efChk.checked,
      sip: num(sip.value) || 0,
      targetYear: num(targetYear.value) || 2030,
      latestNav: ln != null ? ln : null,
      navAsOf: ln != null ? asOf : (f.navAsOf || null),
      benchReturnLow: toDec(benchRetLo), benchReturnHigh: toDec(benchRetHi),
      benchXirrLow: toDec(benchXirrLo), benchXirrHigh: toDec(benchXirrHi),
      goodReturn: goodReturn.value.trim(),
      judgeAfter: f.judgeAfter || '',     // field removed from form; stored value preserved
      remarks: remarks.value.trim(),
      contributions,
      valueHistory: (f.valueHistory || []).slice(),   // preserved as the fallback value
      valueAsOf: f.valueAsOf || asOf,
      soldValue: isSold ? (sv != null ? sv : null) : null,
      soldDate: isSold ? (soldDate.value || null) : null,
      seedXirrRef: f.seedXirrRef != null ? f.seedXirrRef : null,
      seeded: false,
      createdAt: f.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  };

  const del = async () => {
    if (!(await appConfirm('Delete this fund? This cannot be undone.'))) return;
    await DB.del('funds', f.id);
    closeModal();
    toast('Fund deleted');
    renderMF();
  };
  const save = async () => {
    if (!name.value.trim()) { toast('Enter a fund name'); return; }
    const rec = buildRec();
    const c2 = mod.computeFund(rec, Date.now());
    // Auto-track observed low/high (distinct from the user's benchmark thresholds).
    const lo = (prev, v) => v == null ? (prev != null ? prev : null) : (prev == null ? v : Math.min(prev, v));
    const hi = (prev, v) => v == null ? (prev != null ? prev : null) : (prev == null ? v : Math.max(prev, v));
    rec.xirrLow = lo(f.xirrLow, c2.xirrPct); rec.xirrHigh = hi(f.xirrHigh, c2.xirrPct);
    rec.returnLow = lo(f.returnLow, c2.absReturnPct); rec.returnHigh = hi(f.returnHigh, c2.absReturnPct);
    widenBenchBands(rec, c2);
    if (isEdit) rec.id = f.id;
    await DB.put('funds', rec);
    closeModal();
    toast(isEdit ? 'Fund updated' : 'Fund added');
    renderMF();
  };

  // ---------- three tabs: Edit fund | Fund Holdings | Benchmark ----------
  const editTabBtn = el('button', { class: 'active', type: 'button', text: 'Edit fund' });
  const holdTabBtn = el('button', { type: 'button', text: 'Fund Holdings' });
  const benchTabBtn = el('button', { type: 'button', text: 'Benchmark' });

  const editTabContent = el('div', { class: 'tab-content' }, [
    typeList,
    field('Fund name', name),
    el('div', { class: 'field-row' }, [field('Type', type), field('Category', category)]),
    el('div', { class: 'field-row' }, [field('Status', status), field('Monthly SIP', sip, 'sip')]),
    el('div', { class: 'field-row' }, [field('Latest NAV', latestNav, 'nav'), field('NAV as of', navAsOf)]),
    soldRow,
    moreOptions([
      el('div', { class: 'field-row' }, [field('Good return', goodReturn), field('Target year', targetYear)]),
      field('Part of Emergency Fund — moves it to that page and out of these totals', efSwitch),
      field('Remarks', remarks),
    ], !!(existing && (existing.goodReturn || existing.remarks || existing.emergencyFund))),
  ]);
  editTabContent.appendChild(explainRow('About these figures', 'Current value = total units × latest NAV. Log each buy (with units) on the Fund Holdings tab, then just refresh the latest NAV here to update value, return, XIRR and benchmark status.', 'How value is worked out'));

  const holdTabContent = el('div', { class: 'tab-content hidden' }, [
    unitsInfo,
    contribEditor.node,
  ]);

  // Benchmark tab: 4 optional thresholds + a live status readout.
  const benchReadout = el('div', { class: 'mf-bench-readout' });
  const refreshBenchReadout = () => {
    benchReadout.innerHTML = '';
    const c = mod.computeFund(buildRec(), Date.now());
    const retTxt = c.invested > 0 ? fmtPct(c.absReturnPct) : '—';
    const xirrTxt = c.xirrPct != null ? fmtPct(c.xirrPct) : '—';
    const st = c.benchStatus;
    const badge = st ? el('span', { class: 'badge mf-bench-badge ' + (st === 'above' ? 'good' : st === 'below' ? 'bad' : 'muted'), text: st === 'above' ? 'Above benchmark' : st === 'below' ? 'Below benchmark' : 'Within benchmark' }) : el('span', { class: 'hint', text: 'Set at least one threshold to get a status.' });
    benchReadout.appendChild(el('div', { class: 'mf-bench-now' }, [
      el('span', {}, ['Current return ', b(retTxt)]),
      el('span', {}, ['Current XIRR ', b(xirrTxt)]),
    ]));
    benchReadout.appendChild(el('div', { class: 'mf-bench-status' }, [badge]));
  };
  [benchRetLo, benchRetHi, benchXirrLo, benchXirrHi, latestNav].forEach((inp) => inp.addEventListener('input', refreshBenchReadout));

  const benchTabContent = el('div', { class: 'tab-content hidden' }, [
    el('p', { class: 'hint', text: 'Your own targets. They only ever widen: when a NAV update pushes the current return/XIRR past a band, that band expands to the new value (a set band is never narrowed on its own). Status is Below if current return is under its low bound, Above if over its high bound, else Within. Leave any blank to ignore it.' }),
    el('div', { class: 'field-row' }, [field('Low return %', benchRetLo), field('High return %', benchRetHi)]),
    el('div', { class: 'field-row' }, [field('Low XIRR %', benchXirrLo), field('High XIRR %', benchXirrHi)]),
    benchReadout,
  ]);

  const tabs = [
    { btn: editTabBtn, content: editTabContent },
    { btn: holdTabBtn, content: holdTabContent },
    { btn: benchTabBtn, content: benchTabContent },
  ];
  // Delete is only meaningful while looking at the fund's identity/status, so it
  // only shows on the Edit fund tab - Fund Holdings/Benchmark just show Save/Cancel.
  const deleteBtn = isEdit ? el('button', { class: 'btn danger', text: 'Delete', onclick: del }) : null;
  const showTab = (which) => {
    tabs.forEach((t) => {
      const on = t === which;
      t.btn.classList.toggle('active', on);
      t.content.classList.toggle('hidden', !on);
    });
    if (which.btn === benchTabBtn) refreshBenchReadout();
    if (deleteBtn) deleteBtn.classList.toggle('hidden', which.btn !== editTabBtn);
  };
  editTabBtn.addEventListener('click', () => showTab(tabs[0]));
  holdTabBtn.addEventListener('click', () => showTab(tabs[1]));
  benchTabBtn.addEventListener('click', () => showTab(tabs[2]));

  const scrollChildren = [
    el('h2', { text: isEdit ? (f.name || 'Edit fund') : 'Add fund' }),
    el('div', { class: 'seg' }, [editTabBtn, holdTabBtn, benchTabBtn]),
    editTabContent,
    holdTabContent,
    benchTabContent,
  ];

  const btns = [el('button', { class: 'btn primary', text: 'Save', onclick: save })];
  if (deleteBtn) btns.push(deleteBtn);
  btns.push(el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }));
  const footer = el('div', { class: 'sheet-footer' }, [el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, btns)]);

  // Save/Cancel stay fixed at the bottom (long investment logs shouldn't bury them);
  // everything above scrolls in its own region instead of the whole sheet.
  openModal(el('div', { class: 'sheet has-fixed-footer' }, [
    el('div', { class: 'sheet-scroll' }, scrollChildren),
    footer,
  ]));
}

function _findFundMatch(parsedName, funds) {
  const t = _normName(parsedName);
  if (!t) return null;
  let best = null;
  for (const f of funds) {
    const nn = _normName(f.name);
    if (!nn) continue;
    if (nn === t) return f;
    if (nn.includes(t) || t.includes(nn)) {
      const s = Math.min(nn.length, t.length) / Math.max(nn.length, t.length);
      if (!best || s > best.s) best = { f, s };
      continue;
    }
    let k = 0; const lim = Math.min(nn.length, t.length);
    while (k < lim && nn.charCodeAt(k) === t.charCodeAt(k)) k++;
    if (k >= 4) { const s = k / Math.max(nn.length, t.length); if (!best || s > best.s) best = { f, s }; }
  }
  return best && best.s >= 0.35 ? best.f : null;
}

// Periodic update: bulk "update latest NAV" sheet. Lists every held fund with its
// latest-NAV input; value/return/XIRR/benchmark-status all recompute from it. A
// holdings screenshot can pre-fill by dividing each parsed current value by the
// fund's known total units (NAV = value ÷ units). Saving stores latestNav + navAsOf
// and refreshes the auto-tracked low/high.
async function openMfValueSheet() {
  const mod = await import('./mf.js');
  const funds = ((await DB.byIndex('funds', 'owner', 'me')) || []).filter((f) => !(f.status === 'Sold' || f.soldDate));
  if (!funds.length) { toast('No holding funds to update'); return; }
  const asOf = el('input', { type: 'date', value: todayISO() });
  const refs = funds.map((f) => ({
    f,
    units: mod.totalUnitsOf(f),
    inp: el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: f.latestNav != null && f.latestNav !== '' ? f.latestNav : '', placeholder: 'Latest NAV ₹' }),
  }));
  const rowsWrap = el('div', { class: 'mf-value-list' }, refs.map(({ f, inp, units }) => {
    const cap = el('div', { class: 'mf-value-cap' });
    const refreshCap = () => {
      const nv = num(inp.value);
      cap.textContent = units > 0
        ? (nv != null ? `${units.toFixed(3)} units → ${fmtCur(units * nv, 'INR')}` : `${units.toFixed(3)} units held`)
        : 'no units logged — add units on the fund to derive value';
    };
    inp.addEventListener('input', refreshCap);
    refreshCap();
    return el('div', { class: 'mf-value-row' }, [
      el('div', { class: 'mf-value-name' }, [el('div', { text: f.name }), cap]),
      inp,
    ]);
  }));
  const scan = () => {
    const input = el('input', { type: 'file', accept: 'image/*', multiple: '' });
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      showLoader('Loading OCR engine…');
      try {
        const ocr = await import('./ocr.js');
        const texts = await ocr.ocrImages(files, (m) => {
          if (!m || !m.status) return;
          const pct = (m.progress != null && !isNaN(m.progress)) ? Math.round(m.progress * 100) : null;
          setLoader(m.status.charAt(0).toUpperCase() + m.status.slice(1) + (pct != null ? ' · ' + pct + '%' : ''));
        });
        const holdings = [];
        for (const t of texts) holdings.push(...mod.parsePaytmHoldings(t));
        hideLoader();
        let filled = 0;
        for (const h of holdings) {
          const match = _findFundMatch(h.name, funds);
          if (!match) continue;
          const ref = refs.find((r) => r.f.id === match.id);
          // The holdings screen shows current value; convert to NAV via known units.
          if (ref && ref.units > 0 && h.value > 0) {
            ref.inp.value = Math.round((h.value / ref.units) * 10000) / 10000;
            ref.inp.dispatchEvent(new Event('input'));
            filled++;
          }
        }
        if (!filled) console.warn('MF holdings OCR - raw text:\n', texts.join('\n----- next -----\n'));
        toast(filled ? `${filled} NAV${filled > 1 ? 's' : ''} pre-filled - review & Save` : 'No funds matched (need units logged) - enter NAV manually');
      } catch (e) { hideLoader(); appAlert('OCR failed: ' + e.message); }
    });
    input.click();
  };
  const save = async () => {
    const asOfV = asOf.value || todayISO();
    let n = 0;
    for (const { f, inp } of refs) {
      const nv = num(inp.value);
      if (nv == null) continue;
      const rec = Object.assign({}, f, { latestNav: nv, navAsOf: asOfV, seeded: false, updatedAt: new Date().toISOString() });
      const c = mod.computeFund(rec, Date.now());
      const lo = (p, x) => x == null ? (p != null ? p : null) : (p == null ? x : Math.min(p, x));
      const hi = (p, x) => x == null ? (p != null ? p : null) : (p == null ? x : Math.max(p, x));
      rec.xirrLow = lo(f.xirrLow, c.xirrPct); rec.xirrHigh = hi(f.xirrHigh, c.xirrPct);
      rec.returnLow = lo(f.returnLow, c.absReturnPct); rec.returnHigh = hi(f.returnHigh, c.absReturnPct);
      widenBenchBands(rec, c);
      await DB.put('funds', rec);
      n++;
    }
    closeModal();
    toast(n ? `Updated ${n} fund${n > 1 ? 's' : ''}` : 'Nothing to update');
    renderMF();
  };
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Update latest NAV' }),
    el('p', { class: 'hint', text: 'Enter each fund\'s latest NAV from Paytm Money. Current value (units × NAV), return, XIRR and benchmark status recompute automatically. A holdings screenshot pre-fills NAV for funds that have units logged.' }),
    el('div', { class: 'field' }, [el('label', { text: 'NAV as of' }), asOf]),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', type: 'button', text: '📷 Scan holdings screenshot', onclick: scan })]),
    rowsWrap,
    el('div', { class: 'btn-row', style: 'flex-wrap:wrap' }, [
      el('button', { class: 'btn primary', text: 'Save all', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ]),
  ]));
}

// ---------- online NAV fetch (AMFI via mfapi.in — free, no key, no rate limit) ----------
// Marketaux can't do Indian MF NAV; AMFI (official) publishes daily and mfapi.in
// wraps it as CORS-friendly JSON. We resolve each held fund's AMFI scheme code from
// its name once (preferring Direct + Growth, rejecting IDCW/Regular), cache it on
// the fund, then pull the latest NAV. One network run per calendar day.
const MFAPI = 'https://api.mfapi.in';

// dd-mm-yyyy (AMFI) → yyyy-mm-dd.
function _ddmmyyyyToIso(s) {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Score an mfapi search hit against a fund name. Reject IDCW/dividend plans; prefer
// Direct + Growth; add core-name token overlap. Higher = better.
function _scoreScheme(fundName, schemeName) {
  const s = (schemeName || '').toLowerCase();
  if (/idcw|dividend|payout|reinvest/.test(s)) return -Infinity;
  let score = 0;
  score += /\bdirect\b/.test(s) ? 3 : -3;
  score += /\bgrowth\b/.test(s) ? 2 : -1;
  if (/\bregular\b/.test(s)) score -= 3;
  const strip = (x) => (x || '').toLowerCase().replace(/direct|regular|growth|idcw|dividend|plan|option|fund|the/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const a = new Set(strip(fundName));
  for (const t of strip(schemeName)) if (a.has(t)) score += 1;
  return score;
}

async function _resolveSchemeCode(fund) {
  const q = (fund.name || '').replace(/direct|regular|growth|plan|option|[-–—]/gi, ' ').replace(/\s+/g, ' ').trim();
  const r = await fetch(`${MFAPI}/mf/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) return null;
  const list = await r.json();
  if (!Array.isArray(list) || !list.length) return null;
  let best = null, bestScore = -Infinity;
  for (const it of list) {
    const sc = _scoreScheme(fund.name, it.schemeName || '');
    if (sc > bestScore) { bestScore = sc; best = it; }
  }
  return best && bestScore > 0 ? { code: best.schemeCode, name: best.schemeName } : null;
}

// ---------- Stats tab: Day/Month/Year NAV change vs Nifty 50 ----------
// mfapi.in only wraps AMFI mutual-fund NAVs - there is no Nifty 50 INDEX endpoint
// reachable from the browser (NSE's own API needs session cookies + blocks CORS;
// Yahoo's ^NSEI is CORS-blocked too). A Nifty 50 INDEX FUND's NAV tracks the index
// within a small tracking error and lives on this same mfapi.in endpoint, so it's
// used as the benchmark proxy. UTI Nifty 50 Index Fund - Direct Growth.
const NIFTY50_PROXY = '120716';

// mfapi's /mf/{code} full-history payload → [{t: <ms>, nav: <number>}], newest-first.
function _parseNavHistory(json) {
  const data = json && Array.isArray(json.data) ? json.data : [];
  const out = [];
  for (const d of data) {
    const t = Date.parse(_ddmmyyyyToIso(d.date) || '');
    const nav = parseFloat(d.nav);
    if (!isNaN(t) && nav > 0) out.push({ t, nav });
  }
  return out; // already newest-first, matching mfapi's own ordering
}

// % change between the newest NAV and the nearest reading at-or-before `daysBack`
// days earlier. Returns null when history doesn't reach back far enough.
function navChangePct(hist, daysBack) {
  if (!hist || hist.length < 2) return null;
  const latest = hist[0];
  const targetT = latest.t - daysBack * 86400000;
  let past = null;
  for (const h of hist) { if (h.t <= targetT) { past = h; break; } }
  if (!past && daysBack === 1) past = hist[1]; // day change: just the previous entry
  if (!past || !(past.nav > 0)) return null;
  return ((latest.nav - past.nav) / past.nav) * 100;
}

export async function fetchMfNavs() {
  const today = todayISO();
  const funds = ((await DB.byIndex('funds', 'owner', 'me')) || []).filter((f) => !(f.status === 'Sold' || f.soldDate));
  if (!funds.length) { toast('No holding funds to update'); return; }
  showLoader('Fetching latest NAV…');
  const mod = await import('./mf.js');
  let updated = 0; const unmatched = [];
  try {
    for (let i = 0; i < funds.length; i++) {
      const f = funds[i];
      setLoader(`Fetching NAV… ${i + 1}/${funds.length}`);
      let code = f.schemeCode, schemeName = f.schemeName;
      if (!code) {
        const m = await _resolveSchemeCode(f).catch(() => null);
        if (!m) { unmatched.push(f.name); continue; }
        code = m.code; schemeName = m.name;
      }
      // Full history (not just /latest) - one call now feeds both the current
      // NAV and the Stats tab's day/month/year deltas; only the deltas are
      // persisted (rec.stats), not the history itself.
      let hist = [];
      try {
        const r = await fetch(`${MFAPI}/mf/${code}`);
        if (r.ok) hist = _parseNavHistory(await r.json());
      } catch (_) {}
      const navVal = hist.length ? hist[0].nav : null;
      const navDate = hist.length ? new Date(hist[0].t).toISOString().slice(0, 10) : null;
      if (navVal == null || !(navVal > 0)) { unmatched.push(f.name); continue; }
      const rec = Object.assign({}, f, {
        schemeCode: code, schemeName: schemeName || f.schemeName || '',
        latestNav: navVal, navAsOf: navDate || today, seeded: false,
        stats: { d1: navChangePct(hist, 1), m1: navChangePct(hist, 30), y1: navChangePct(hist, 365), asOf: navDate || today },
        updatedAt: new Date().toISOString(),
      });
      const c = mod.computeFund(rec, Date.now());
      const lo = (p, x) => x == null ? (p != null ? p : null) : (p == null ? x : Math.min(p, x));
      const hi = (p, x) => x == null ? (p != null ? p : null) : (p == null ? x : Math.max(p, x));
      rec.xirrLow = lo(f.xirrLow, c.xirrPct); rec.xirrHigh = hi(f.xirrHigh, c.xirrPct);
      rec.returnLow = lo(f.returnLow, c.absReturnPct); rec.returnHigh = hi(f.returnHigh, c.absReturnPct);
      widenBenchBands(rec, c);
      await DB.put('funds', rec);
      updated++;
    }
    // Nifty 50 proxy (index fund NAV) - one extra call, cached in meta so the
    // Stats tab has a benchmark reading without re-fetching per fund.
    try {
      const r = await fetch(`${MFAPI}/mf/${NIFTY50_PROXY}`);
      if (r.ok) {
        const hist = _parseNavHistory(await r.json());
        if (hist.length) {
          const asOf = new Date(hist[0].t).toISOString().slice(0, 10);
          await DB.put('meta', { key: 'mfNiftyStats', value: { d1: navChangePct(hist, 1), m1: navChangePct(hist, 30), y1: navChangePct(hist, 365), asOf } });
        }
      }
    } catch (_) {}
  } catch (e) {
    hideLoader();
    appAlert('NAV fetch failed: ' + e.message + '\n\nAre you online? NAV comes from AMFI via mfapi.in.');
    return;
  }
  hideLoader();
  if (unmatched.length) console.warn('MF NAV fetch — unmatched funds (set NAV manually):', unmatched);
  if (!updated) { toast('Could not fetch any NAV — check connection or set manually'); return; }
  toast(`${updated} NAV${updated === 1 ? '' : 's'} updated${unmatched.length ? ` · ${unmatched.length} unmatched` : ''}`);
  renderMF();
}
