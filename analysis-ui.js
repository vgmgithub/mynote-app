// Analysis: the analytical layer over what is already logged. It has no data of its own - every tab reads the
// existing stores - so switching it on or off changes nothing stored.
//   Household  the Review that used to be a tab of Expenses (renderReview, unchanged)          needs Expenses
//   Personal   the Review that used to be a tab of Personal Finance (renderPfReview, unchanged)  needs Personal Spending
//   Combined   household and personal side by side, and cards against what was logged        needs both
//   AI Prompt  turns the data into a prompt to paste into any AI assistant (ai-prompt.js)       always
import { DB } from './db.js';
import { ui } from './state.js';
import { el, $, state, modOn, _modsCache, setAppMode, fmtIntCur, fmtSheetCur, toast, explainRow, _pfGroupOf, REFUND_CAT, _reviewAnalysis, _reviewSavings, rvwKeepList, renderTagAnalysis,
  isRefund, _kittyFor, _reviewForecast, _pfCardLimit, REVIEW_MIN_HISTORY, includedStockProfiles } from './app.js';
import { renderReview, _recurringDue, sheetLoanSummary } from './expense-ui.js';
import { renderPfReview, pfLoad, pfOwnMap, pfSpendsOnly, isForOthers, cardCheckIcon } from './personal-ui.js';
import { todayISO } from './core.js';
import { categoryMonths } from './category-core.js';
import { DATA_ITEMS, PURPOSES, summarise, availableItems, buildPrompt, PRIVACY_NOTE } from './ai-prompt.js';

// Household wears the cart (as on the Home Expense card) and Personal the money-note image (as on Personal Finance).
// AI Prompt wears the brain, with a tiny node running along its folds (icons/brain-nodes.svg, laid over it in styles.css).
const ALL_TABS = [['house', '\u{1F6D2}', 'Household'], ['personal', 'icons/personal-finance.png', 'Personal'], ['both', '\u{1F517}', 'Combined'], ['tags', '\u{1F3F7}️', 'Tags'], ['prompt', 'icons/brain.png', 'AI Prompt']];
function tabsNow() {
  const h = modOn(_modsCache, 'expense'), p = modOn(_modsCache, 'personal');
  return ALL_TABS.filter(([v]) => (v === 'house' ? h : v === 'personal' ? p : (v === 'both' || v === 'tags') ? h && p : true));
}

export function buildAnalysisBottomNav() {
  const nav = $('#analysisBottomNav');
  nav.innerHTML = '';                    // rebuilt each time: which tabs exist follows the features chosen
  tabsNow().forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, type: 'button', onclick: () => { if (ui._anTab === v) return; ui._anTab = v; renderAnalysis(); } },
      [el('span', { class: 'bn-ico' }, [ico.indexOf('icons/') === 0 ? el('img', { src: ico, alt: '', class: 'mod-ico-img' }) : document.createTextNode(ico)]), label]));
  });
  updateNav();
}
function updateNav() {
  $('#analysisBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._anTab));
}

let _anToken = 0;
const anStale = (t) => t !== _anToken || state.appMode !== 'analysis';

export async function renderAnalysis() {
  if (state.appMode !== 'analysis') return;
  const tabs = tabsNow();
  if (!tabs.some(([v]) => v === ui._anTab)) ui._anTab = tabs[0][0];
  updateNav();
  const host = $('#analysisView');
  host.innerHTML = '';
  const token = ++_anToken;
  // The two Reviews check their own section's render token; taking a fresh one here makes this the latest render.
  if (ui._anTab === 'house') { await renderReview(host, ++ui._expRenderToken); return; }
  if (ui._anTab === 'personal') { await renderPfReview(host, ++ui._pfRenderToken); return; }
  if (ui._anTab === 'both') { await renderCombined(host, token); return; }
  if (ui._anTab === 'tags') { await renderTags(host, token); return; }
  await renderPrompt(host, token);
}

// ---------- Combined ----------
async function renderCombined(host, token) {
  const mod = await import('./credit.js');
  const [house, pf, cards] = await Promise.all([DB.all('spends').catch(() => []), pfLoad(), DB.all('creditCards').catch(() => [])]);
  if (anStale(token)) return;
  const thisYm = todayISO().slice(0, 7);
  const byYmOf = (rows, monthOf) => {
    const m = new Map();
    (rows || []).forEach((r) => { const k = monthOf(r); if (!/^\d{4}-\d{2}$/.test(k || '')) return; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    return m;
  };
  // Spending only: refunds (negative amounts) are left out of every figure on Analysis, so no total here is a
  // mix of money out and money back - the same rule as the Household and Personal tabs.
  const spend = (rows) => (rows || []).filter((r) => (Number(r && r.amount) || 0) > 0);
  const houseSpend = spend(house);
  const houseByYm = byYmOf(houseSpend, (r) => String(r.ym || '').slice(0, 7));
  const pfByYm = pfSpendsOnly(pfOwnMap(pf.byYm));
  const hm = categoryMonths(houseSpend, (r) => String(r.ym || '').slice(0, 7), REFUND_CAT);
  const pm = categoryMonths(spend(pf.rows).filter((r) => !isForOthers(r)), pf.countedYm, REFUND_CAT);

  if (!hm.size && !pm.size) {
    host.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '\u{1F517}' }), el('p', { text: 'Nothing logged yet.' }),
      el('p', { class: 'hint', text: 'Log household spends on the Tracker and personal ones on Spends, and this page puts them side by side.' })]));
    return;
  }

  // ---- Household against personal, six months ----
  const months = [...new Set([...hm.keys(), ...pm.keys(), thisYm])].filter((k) => k <= thisYm).sort().slice(-6);
  const hOf = (k) => (hm.get(k) ? hm.get(k).spent : 0), pOf = (k) => (pm.get(k) ? pm.get(k).spent : 0);
  const peak = Math.max(1, ...months.map((k) => hOf(k) + pOf(k)));
  const BAR_H = 72, SEG_MIN = 9;   // px - BAR_H is kept equal to .an-stack-bar's height in styles.css
  // The app's own month names (en-IN renders September as "Sept", every other screen says "Sep").
  const label = (k) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(k.slice(5, 7)) - 1] || k;
  const nowH = hOf(thisYm), nowP = pOf(thisYm), nowT = nowH + nowP;
  // Usual month, like for like with "this month": only earlier months that have BOTH household and personal
  // spends (a month from before personal was being logged would otherwise count as a ₹0 personal month and
  // drag it down), the last 6 of those at most, and their middle value so one heavy month cannot set it.
  // Needs 2 such months; until then there is no usual to show.
  const both = [...new Set([...hm.keys(), ...pm.keys()])].filter((k) => k < thisYm && hOf(k) > 0 && pOf(k) > 0).sort().slice(-6);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
  const usual = both.length >= 2 ? med(both.map((k) => hOf(k) + pOf(k))) : null;
  const pct = (v) => (nowT ? Math.round(v / nowT * 100) + '%' : '0%');
  // Under the chart: household in the left half, personal in the right, each with its amount and share badge.
  const legendHalf = (cls, name, v) => el('div', { class: 'an-leg-half ' + cls }, [
    el('span', { class: 'an-leg-name' }, [el('i', { class: 'rvw-dot ' + cls }), document.createTextNode(name)]),
    el('span', { class: 'an-leg-fig' }, [el('b', { text: fmtIntCur(v) }), el('span', { class: 'an-sum-pct', text: pct(v) })]),
  ]);
  host.appendChild(el('div', { class: 'card an-both' }, [
    el('h3', { text: 'Spending at a glance' }),
    el('div', { class: 'an-sum' }, [
      el('div', { class: 'an-sum-main' }, [
        el('span', { class: 'an-sum-k', text: 'This month' }),
        // This month and the usual month side by side, with how far this one is above (red) or below (green) usual.
        el('div', { class: 'an-sum-line' }, [
          el('b', { class: 'an-sum-big', text: fmtIntCur(nowT) }),
          usual != null ? el('span', { class: 'an-sum-usual' }, [
            document.createTextNode('Usual '), el('b', { text: fmtIntCur(usual) + '*' }),
            usual > 0 ? (() => {
              const d = Math.round((nowT - usual) / usual * 100);
              return el('span', { class: 'an-sum-vs ' + (d > 0 ? 'is-up' : d < 0 ? 'is-down' : 'is-flat'),
                title: 'This month against a usual month', text: (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d) + '%' });
            })() : null,
          ].filter(Boolean)) : null,
        ].filter(Boolean)),
        el('div', { class: 'an-sum-foot', title: usual != null
          ? 'Middle of the last ' + both.length + ' months that have both household and personal spends. Refunds are not counted.'
          : 'A usual month shows once 2 earlier months have both household and personal spends.',
          text: usual != null ? '* middle of last ' + both.length + ' months with both spends · no refunds'
            : '* usual month shows after 2 months with both spends' }),
      ].filter(Boolean)),
    ]),
    el('div', { class: 'an-stack' }, months.map((k) => {
      const hv = hOf(k), pv = pOf(k), tot = hv + pv;
      // Each month's own split, as a share of that month. Household is rounded and personal is the rest, so the
      // two always add to 100; a side that exists never reads 0%.
      let hP = tot ? Math.round(hv / tot * 100) : 0;
      if (hv > 0 && pv > 0) hP = Math.min(99, Math.max(1, hP));
      const pP = tot ? 100 - hP : 0;
      // Segment heights in px, each at least SEG_MIN so its % always has room inside it; what a short side gains is
      // taken off the taller one, so a month never grows past the bar.
      let hPx = hv / peak * BAR_H, pPx = pv / peak * BAR_H;
      if (pv > 0 && pPx < SEG_MIN) { const d = SEG_MIN - pPx; pPx = SEG_MIN; if (hv > 0) hPx = Math.max(SEG_MIN, hPx - d); }
      if (hv > 0 && hPx < SEG_MIN) { const d = SEG_MIN - hPx; hPx = SEG_MIN; if (pv > 0) pPx = Math.max(SEG_MIN, pPx - d); }
      const seg = (cls, px, pct) => el('i', { class: cls, style: 'height:' + (px / BAR_H * 100).toFixed(1) + '%' }, [
        el('span', { class: 'an-seg-pct', text: pct + '%' })]);
      return el('div', { class: 'an-stack-col' + (k === thisYm ? ' is-now' : '') }, [
        el('span', { class: 'an-stack-bar' }, [
          pv > 0 ? seg('is-personal', pPx, pP) : null,
          hv > 0 ? seg('is-house', hPx, hP) : null,
        ].filter(Boolean)),
        el('span', { class: 'an-stack-k', text: label(k) }),
      ]);
    })),
    el('div', { class: 'an-leg' }, [legendHalf('is-house', 'Household', nowH), legendHalf('is-personal', 'Personal', nowP)]),
  ]));

  // ---- What needs attention, from both Reviews' own findings ----
  const now = new Date();
  const aH = houseByYm.size ? _reviewAnalysis(thisYm, houseByYm, thisYm, 0, now) : null;
  const aP = pfByYm.size ? _reviewAnalysis(thisYm, pfByYm, thisYm, 0, now, _pfGroupOf) : null;
  const look = [...(aH ? aH.actionable.map((x) => ({ ...x, side: 'house' })) : []), ...(aP ? aP.actionable.map((x) => ({ ...x, side: 'personal' })) : [])]
    .sort((a, b) => b.over - a.over).slice(0, 6);
  const saves = [...(aH ? _reviewSavings(aH, null, null, null).rows.map((x) => ({ ...x, side: 'house' })) : []),
    ...(aP ? _reviewSavings(aP, null, null, null).rows.map((x) => ({ ...x, side: 'personal' })) : [])].sort((a, b) => b.save - a.save).slice(0, 5);
  const sideDot = (s) => el('i', { class: 'rvw-dot ' + (s === 'house' ? 'is-house' : 'is-personal') });
  host.appendChild(el('div', { class: 'card an-attn' }, [
    el('h3', { text: 'Worth a look, on both sides' }),
    look.length ? el('div', {}, look.map((x) => el('div', { class: 'an-row' }, [
      el('span', {}, [sideDot(x.side), x.name]),
      el('b', { class: 'is-up', text: '+' + fmtIntCur(x.over) + ' over usual' }),
    ]))) : el('p', { class: 'hint', text: (aH && aH.historyMonths >= 2) || (aP && aP.historyMonths >= 2)
      ? 'Nothing is running above its usual this month.' : 'Add more spending history (at least two earlier months) to see what is unusual.' }),
    saves.length ? el('p', { class: 'catsp-sub', text: 'Where money could be kept' }) : null,
    // Cards that open onto the spends behind each line (each from its own side's month).
    saves.length ? rvwKeepList(saves, { scope: 'both', dot: (x) => sideDot(x.side), groupClass: () => 'an-keep-plain',
      rowsFor: (x) => (x.side === 'house' ? houseByYm : pfByYm).get(thisYm) || [] }) : null,
  ].filter(Boolean)));

  // ---- Cards: what was billed against what was logged on them ----
  if (cards.length) {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const logged = new Map();
    const addLogged = (r) => {
      const c = r.method === 'Card' ? byId.get(r.cardId) : null;
      if (!c) return;
      const k = mod.statementYmFor(r.date, c);
      logged.set(k, (logged.get(k) || 0) + (Number(r.amount) || 0));
    };
    (house || []).forEach(addLogged); (pf.rows || []).forEach(addLogged);
    const billed = new Map();
    cards.forEach((c) => (c.months || []).forEach((m) => { if (Number(m.billed) > 0) billed.set(m.ym, (billed.get(m.ym) || 0) + Number(m.billed)); }));
    const ks = [...billed.keys()].sort().slice(-4).reverse();
    host.appendChild(el('div', { class: 'card an-cards' }, [
      el('h3', { text: 'Card bills against logged spending' }),
      ks.length ? el('div', {}, ks.map((k) => {
        const gap = Math.round((billed.get(k) || 0) - (logged.get(k) || 0));
        return el('div', { class: 'an-row' }, [
          el('span', { text: label(k) + ' bill ' + fmtIntCur(billed.get(k)) + ' · logged ' + fmtIntCur(logged.get(k) || 0) }),
          el('b', { class: Math.abs(gap) > 1 ? 'is-up' : 'is-down', text: Math.abs(gap) <= 1 ? 'matches' : (gap > 0 ? fmtIntCur(gap) + ' not logged' : fmtIntCur(-gap) + ' more logged') }),
        ]);
      })) : el('p', { class: 'hint', text: 'No card bills recorded yet. Add them on Credit Cards and this compares them with what you logged.' }),
      el('button', { class: 'btn ghost small an-open-chk', type: 'button', onclick: () => {
        if (modOn(_modsCache, 'cc')) { ui._ccTab = 'chk'; setAppMode('cc'); } else { ui._pfTab = 'cards'; setAppMode('personal'); }
      } }, [cardCheckIcon('is-sm'), document.createTextNode('Open Card Check')]),
    ]));
  }

  host.appendChild(explainRow('About this view', 'Household spends (Tracker, month logged) and your own personal spends (the month Spends counts them in, without spends made for somebody else), read side by side. Refunds are left out everywhere on Analysis - it reads spending only (the card-bill check alone counts card refunds, because the bank takes them off the bill). Usual month is the middle of the last 6 months (at most) that have both household and personal spends. Nothing is stored here: it is read from what you have already logged.', 'How this is counted'));
}

// ---------- Tags (across household and personal; its own tab, split off from Combined) ----------
async function renderTags(host, token) {
  host.appendChild(el('h3', { class: 'div-group-head', text: '\u{1F3F7}️ Tags across both' }));
  const tagHost = el('div');
  host.appendChild(tagHost);
  await renderTagAnalysis(tagHost, token, { rerender: renderAnalysis, stale: anStale });
}

// ---------- AI Prompt ----------
// This month's budget, month-end estimate and flagged categories for the prompt, worked out exactly as the
// Household and Personal tabs do (renderReview / renderPfReview) so the prompt quotes the figures they show.
function promptReview(spends, pf, allocs, efLoans) {
  const now = new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  // Both tabs estimate the month only once something is logged and there are enough earlier months to go on.
  const judged = (a) => a.spent > 0 && a.historyMonths >= REVIEW_MIN_HISTORY;
  const pack = (a, f) => ({
    budget: a.kitty, estimate: f ? f.forecast : null, lo: f ? f.lo : null, hi: f ? f.hi : null, grade: f ? f.grade : null,
    usualByNow: f ? f.usualByNow : null, flagged: judged(a) ? a.actionable.slice(0, 3) : [],
  });
  const out = {};
  if (modOn(_modsCache, 'expense')) {
    const byYm = new Map();
    (spends || []).forEach((r) => {
      const k = String(r.ym || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(k) || isRefund(r)) return;
      if (!byYm.has(k)) byYm.set(k, []);
      byYm.get(k).push(r);
    });
    const kitty = _kittyFor(thisYm, allocs, efLoans);
    const a = _reviewAnalysis(thisYm, byYm, thisYm, kitty, now);
    const dueTotal = _recurringDue(thisYm, byYm).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    out.house = pack(a, judged(a) ? _reviewForecast(thisYm, byYm, now, dueTotal, kitty) : null);
  }
  if (modOn(_modsCache, 'personal') && pf) {
    const ownByYm = pfSpendsOnly(pfOwnMap(pf.byYm)), ownByYmCal = pfSpendsOnly(pfOwnMap(pf.byYmCal));
    const limit = _pfCardLimit(thisYm, pf.allocs) + (Number(pf.upiLimit) || 0);
    const a = _reviewAnalysis(thisYm, ownByYm, thisYm, limit, now, _pfGroupOf);
    out.personal = pack(a, judged(a) ? _reviewForecast(thisYm, ownByYmCal, now, 0, limit) : null);
  }
  return out;
}

// The Balance tab's existing loans, as the latest month's sheet up to now holds them (a new month carries the
// unpaid ones over from it): how many, and what is still owed. Never their labels.
function promptLoans(sheets) {
  const ym = todayISO().slice(0, 7);
  const last = (sheets || []).filter((x) => x && typeof x.ym === 'string' && x.ym <= ym).sort((a, b) => a.ym.localeCompare(b.ym)).pop();
  return last ? sheetLoanSummary(last) : null;
}

async function renderPrompt(host, token) {
  const [spends, allocations, creditCards, bankSavings, stocks, funds, fds, metals, bonds, sheets, rates, efLoans, pf, profiles] = await Promise.all(
    ['spends', 'allocations', 'creditCards', 'bankSavings', 'stocks', 'funds', 'fds', 'metals', 'bonds', 'monthlySheet'].map((s) => DB.all(s).catch(() => []))
      .concat([DB.get('meta', 'homeLiveRates').catch(() => null), DB.byIndex('emergency', 'kind', 'loan').catch(() => []),
        pfLoad().catch(() => null), includedStockProfiles().catch(() => [])]));
  let ef = null;
  if (modOn(_modsCache, 'ef')) { try { ef = (await (await import('./ef.js')).efLoad()).c; } catch (_) { ef = null; } }
  if (anStale(token)) return;
  // The cached rates only (no fetch): USD for US holdings, gold / silver per gram for the metals.
  const rv = (rates && rates.value) || {};
  const usdInr = Number(rv.usdInr) > 0 ? Number(rv.usdInr) : 0;
  const summary = summarise({
    spends, allocations, creditCards, bankSavings, stocks, funds, fds, metals, bonds, ef, usdInr,
    // The Personal tab's own list and its rule for which month a spend counts in.
    personalSpends: pf ? pf.rows : [], personalMonthOf: pf ? pf.countedYm : null,
    rates: { gold: Number(rv.gold) || 0, silver: Number(rv.silver) || 0, asOf: rv.asOf || null },
    // Your own two portfolios, plus any other profile counted "In total" (as on Home) - ids only, never names.
    portfolios: [{ id: 'me-in', cur: 'INR' }, { id: 'me-us', cur: 'USD' }].concat((profiles || []).map((p) => ({ id: p.id, cur: p.cur }))),
    review: promptReview(spends, pf, allocations, efLoans),
    loans: promptLoans(sheets),
    today: todayISO(),
  });
  const avail = availableItems(summary, (id) => modOn(_modsCache, id));
  const purposes = PURPOSES.filter((p) => p.id === 'custom' || p.items.some((i) => avail.includes(i)));
  if (!purposes.some((p) => p.id === ui._aiPurpose)) ui._aiPurpose = purposes[0].id;
  if (!ui._aiItems) ui._aiItems = new Set((PURPOSES.find((p) => p.id === ui._aiPurpose) || {}).items || []);
  // Income, when ticked, as the exact salary (default - unchanged from before this existed) or as a range the
  // person types, so they can include it for the ratios it drives without the prompt carrying the exact figure.
  // Session-only, like every other _ai* field here - never saved to a backup.
  if (!ui._aiIncomeMode) ui._aiIncomeMode = 'exact';
  if (!ui._aiIncomeRange) ui._aiIncomeRange = { lo: '', hi: '' };

  host.appendChild(el('div', { class: 'card an-prompt-head' }, [
    el('h3', { text: 'Turn your MyNotes data into an AI prompt' }),
    el('p', { class: 'hint', text: 'Your financial data is already here. Create a ready-to-use prompt, edit it if you want, and paste it into any AI assistant you choose.' }),
  ]));

  const purposeRow = el('div', { class: 'pf-filter an-purposes' }, purposes.map((p) => el('button', {
    type: 'button', class: 'pf-filter-chip' + (p.id === ui._aiPurpose ? ' active' : ''), text: p.label,
    onclick: () => { if (p.id === ui._aiPurpose) return; ui._aiPurpose = p.id; ui._aiItems = new Set(p.items); ui._aiText = null; renderAnalysis(); },
  })));
  host.appendChild(el('p', { class: 'catsp-sub', text: 'What is it for?' }));
  host.appendChild(purposeRow);

  const question = el('textarea', { class: 'an-question', rows: '3', placeholder: ui._aiPurpose === 'custom' ? 'Type your question' : 'Add your own question or context (optional)' });
  question.value = ui._aiQuestion || '';
  question.addEventListener('input', () => { ui._aiQuestion = question.value; });
  host.appendChild(question);

  host.appendChild(el('p', { class: 'catsp-sub', text: 'What to include' }));
  if (!avail.length) {
    host.appendChild(el('p', { class: 'hint', text: 'There is no data to include yet. Log some spending, or add savings or investments, and they can be included here.' }));
  }
  const incomeExtra = el('div', { class: 'an-income-extra hidden' });
  const paintIncomeExtra = () => {
    incomeExtra.innerHTML = '';
    const on = ui._aiItems.has('income');
    incomeExtra.classList.toggle('hidden', !on);
    if (!on) return;
    incomeExtra.appendChild(el('p', { class: 'hint', text: 'Income: the exact figure, or give a range instead to keep it less specific.' }));
    incomeExtra.appendChild(el('div', { class: 'pf-filter an-income-mode' }, [
      el('button', { type: 'button', class: 'pf-filter-chip' + (ui._aiIncomeMode !== 'range' ? ' active' : ''), text: 'Exact amount',
        onclick: () => { if (ui._aiIncomeMode === 'exact') return; ui._aiIncomeMode = 'exact'; ui._aiText = null; paintIncomeExtra(); } }),
      el('button', { type: 'button', class: 'pf-filter-chip' + (ui._aiIncomeMode === 'range' ? ' active' : ''), text: 'A range instead',
        onclick: () => { if (ui._aiIncomeMode === 'range') return; ui._aiIncomeMode = 'range'; ui._aiText = null; paintIncomeExtra(); } }),
    ]));
    if (ui._aiIncomeMode === 'range') {
      const lo = el('input', { type: 'number', inputmode: 'decimal', min: '0', placeholder: 'Lowest, e.g. 50000', value: ui._aiIncomeRange.lo });
      const hi = el('input', { type: 'number', inputmode: 'decimal', min: '0', placeholder: 'Highest, e.g. 75000', value: ui._aiIncomeRange.hi });
      lo.addEventListener('input', () => { ui._aiIncomeRange.lo = lo.value; ui._aiText = null; });
      hi.addEventListener('input', () => { ui._aiIncomeRange.hi = hi.value; ui._aiText = null; });
      incomeExtra.appendChild(el('div', { class: 'an-income-range' }, [lo, el('span', { 'aria-hidden': 'true', text: '–' }), hi, el('span', { class: 'hint', text: '/month' })]));
    }
  };
  const checks = el('div', { class: 'an-items' }, DATA_ITEMS.filter((it) => avail.includes(it.id)).map((it) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = ui._aiItems.has(it.id);
    box.addEventListener('change', () => {
      if (box.checked) ui._aiItems.add(it.id); else ui._aiItems.delete(it.id);
      if (it.id === 'income') paintIncomeExtra();
    });
    return el('label', { class: 'an-item' }, [box, el('span', { text: it.label })]);
  }));
  host.appendChild(checks);
  paintIncomeExtra();
  host.appendChild(incomeExtra);
  host.appendChild(el('p', { class: 'hint', text: 'Never included: names, notes and tags, card, bank, fund, loan and profile names, account or payment ids, Health Check and your passwords.' }));

  const editor = el('textarea', { class: 'an-editor', rows: '16', spellcheck: 'false', 'aria-label': 'Your prompt' });
  const make = () => buildPrompt({ summary, items: [...ui._aiItems].filter((i) => avail.includes(i)), purpose: ui._aiPurpose, question: ui._aiQuestion,
    incomeMode: ui._aiIncomeMode, incomeRange: ui._aiIncomeRange });
  editor.value = ui._aiText != null ? ui._aiText : '';
  editor.addEventListener('input', () => { ui._aiText = editor.value; });
  const out = el('div', { class: 'an-output' + (ui._aiText != null ? '' : ' hidden') }, [
    el('div', { class: 'an-privacy' }, [el('b', { text: 'Review before sharing' }), el('p', { text: PRIVACY_NOTE })]),
    editor,
    el('div', { class: 'btn-row an-actions' }, [
      el('button', { class: 'btn primary', type: 'button', text: 'Copy Prompt', onclick: () => copyPrompt(editor.value) }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Regenerate', onclick: () => { ui._aiText = make(); editor.value = ui._aiText; } }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Clear', onclick: () => { ui._aiText = ''; editor.value = ''; editor.focus(); } }),
    ]),
  ]);
  host.appendChild(el('div', { class: 'btn-row' }, [el('button', { class: 'btn primary', type: 'button', text: 'Generate prompt', onclick: () => {
    if (ui._aiPurpose === 'custom' && !String(ui._aiQuestion || '').trim()) { toast('Type your question first'); question.focus(); return; }
    ui._aiText = make(); editor.value = ui._aiText; out.classList.remove('hidden');
    try { editor.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) { /* older browsers */ }
  } })]));
  // A disclaimer, so it sits under the button that creates the prompt rather than in the intro.
  host.appendChild(el('p', { class: 'hint an-disclaimer' }, [
    el('b', { text: 'Disclaimer: ' }),
    document.createTextNode('MyNotes does not give financial advice and sends nothing anywhere: the prompt is built on this phone, and you decide where it goes.'),
  ]));
  host.appendChild(out);
}

async function copyPrompt(text) {
  if (!String(text || '').trim()) { toast('Nothing to copy yet'); return; }
  try { await navigator.clipboard.writeText(text); toast('Prompt copied. Review it before you paste it anywhere.'); return; } catch (_) { /* fall back below */ }
  try {
    const t = el('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove(); toast('Prompt copied. Review it before you paste it anywhere.');
  } catch (_) { toast('Could not copy. Select the text and copy it by hand.'); }
}
