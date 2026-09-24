// Analysis: the analytical layer over what is already logged. It has no data of its own - every tab reads the
// existing stores - so switching it on or off changes nothing stored.
//   Household  the Review that used to be a tab of Expenses (renderReview, unchanged)          needs Expenses
//   Personal   the Review that used to be a tab of Personal Finance (renderPfReview, unchanged)  needs Personal Spending
//   Combined   household and personal side by side, and cards against what was logged        needs both
//   AI Prompt  turns the data into a prompt to paste into any AI assistant (ai-prompt.js)       always
import { DB } from './db.js';
import { ui } from './state.js';
import { el, $, state, modOn, _modsCache, setAppMode, fmtIntCur, fmtSheetCur, toast, explainRow, _pfGroupOf, REFUND_CAT, _reviewAnalysis, _reviewSavings, renderTagAnalysis } from './app.js';
import { renderReview } from './expense-ui.js';
import { renderPfReview, pfLoad, pfOwnMap, isForOthers } from './personal-ui.js';
import { todayISO } from './core.js';
import { categoryMonths } from './category-core.js';
import { DATA_ITEMS, PURPOSES, summarise, availableItems, buildPrompt, PRIVACY_NOTE } from './ai-prompt.js';

const ALL_TABS = [['house', '\u{1F3E0}', 'Household'], ['personal', '\u{1F45B}', 'Personal'], ['both', '\u{1F517}', 'Combined'], ['prompt', '✨', 'AI Prompt']];
function tabsNow() {
  const h = modOn(_modsCache, 'expense'), p = modOn(_modsCache, 'personal');
  return ALL_TABS.filter(([v]) => (v === 'house' ? h : v === 'personal' ? p : v === 'both' ? h && p : true));
}

export function buildAnalysisBottomNav() {
  const nav = $('#analysisBottomNav');
  nav.innerHTML = '';                    // rebuilt each time: which tabs exist follows the features chosen
  tabsNow().forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, type: 'button', onclick: () => { if (ui._anTab === v) return; ui._anTab = v; renderAnalysis(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
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
  const houseByYm = byYmOf(house, (r) => String(r.ym || '').slice(0, 7));
  const pfByYm = pfOwnMap(pf.byYm);
  const hm = categoryMonths(house, (r) => String(r.ym || '').slice(0, 7), REFUND_CAT);
  const pm = categoryMonths((pf.rows || []).filter((r) => !isForOthers(r)), pf.countedYm, REFUND_CAT);

  if (!hm.size && !pm.size) {
    host.appendChild(el('div', { class: 'empty' }, [el('div', { class: 'e-icon', text: '\u{1F517}' }), el('p', { text: 'Nothing logged yet.' }),
      el('p', { class: 'hint', text: 'Log household spends on the Tracker and personal ones on Spends, and this page puts them side by side.' })]));
    return;
  }

  // ---- Household against personal, six months ----
  const months = [...new Set([...hm.keys(), ...pm.keys(), thisYm])].filter((k) => k <= thisYm).sort().slice(-6);
  const hOf = (k) => (hm.get(k) ? hm.get(k).spent : 0), pOf = (k) => (pm.get(k) ? pm.get(k).spent : 0);
  const peak = Math.max(1, ...months.map((k) => hOf(k) + pOf(k)));
  const label = (k) => { const d = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1); return d.toLocaleString('en-IN', { month: 'short' }); };
  const nowH = hOf(thisYm), nowP = pOf(thisYm), nowT = nowH + nowP;
  const earlier = months.filter((k) => k < thisYm && hOf(k) + pOf(k) > 0);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
  const usual = earlier.length >= 2 ? med(earlier.map((k) => hOf(k) + pOf(k))) : null;
  host.appendChild(el('div', { class: 'card an-both' }, [
    el('h3', { text: 'Household and personal, together' }),
    el('div', { class: 'an-kpis' }, [
      el('div', {}, [el('span', { text: 'This month' }), el('b', { text: fmtIntCur(nowT) })]),
      el('div', {}, [el('span', { text: 'Household' }), el('b', { text: fmtIntCur(nowH) + (nowT ? ' · ' + Math.round(nowH / nowT * 100) + '%' : '') })]),
      el('div', {}, [el('span', { text: 'Personal' }), el('b', { text: fmtIntCur(nowP) + (nowT ? ' · ' + Math.round(nowP / nowT * 100) + '%' : '') })]),
      el('div', {}, [el('span', { text: 'Usual month' }), el('b', { text: usual == null ? '—' : fmtIntCur(usual) })]),
    ]),
    el('div', { class: 'an-stack' }, months.map((k) => el('div', { class: 'an-stack-col' + (k === thisYm ? ' is-now' : '') }, [
      el('span', { class: 'an-stack-bar' }, [
        el('i', { class: 'is-personal', style: 'height:' + (pOf(k) / peak * 100).toFixed(1) + '%' }),
        el('i', { class: 'is-house', style: 'height:' + (hOf(k) / peak * 100).toFixed(1) + '%' }),
      ]),
      el('span', { class: 'an-stack-k', text: label(k) }),
    ]))),
    el('div', { class: 'pf-cc-legend' }, [el('span', {}, [el('i', { class: 'rvw-dot is-house' }), 'household']), el('span', {}, [el('i', { class: 'rvw-dot is-personal' }), 'personal']),
      usual == null ? el('span', { class: 'hint', text: 'Add more spending history to see what a usual month is.' }) : null].filter(Boolean)),
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
    ...saves.map((x) => el('div', { class: 'an-row' }, [el('span', {}, [sideDot(x.side), x.name + ' · ' + x.how]), el('b', { text: fmtIntCur(x.save) })])),
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
      el('button', { class: 'btn ghost small', type: 'button', text: 'Open Card Check', onclick: () => {
        if (modOn(_modsCache, 'cc')) { ui._ccTab = 'chk'; setAppMode('cc'); } else { ui._pfTab = 'cards'; setAppMode('personal'); }
      } }),
    ]));
  }

  // ---- Tags across both (the "Both" view that used to live in Personal Finance -> Tags) ----
  host.appendChild(el('h3', { class: 'div-group-head', text: '\u{1F3F7}️ Tags across both' }));
  const tagHost = el('div');
  host.appendChild(tagHost);
  await renderTagAnalysis(tagHost, token, { rerender: renderAnalysis, stale: anStale });
  if (anStale(token)) return;
  host.appendChild(explainRow('About this view', 'Household spends (Tracker, month logged) and your own personal spends (the month Spends counts them in, without spends made for somebody else), read side by side. Refunds are left out of the totals. Nothing is stored here: it is read from what you have already logged.', 'How this is counted'));
}

// ---------- AI Prompt ----------
async function renderPrompt(host, token) {
  const [spends, personalSpends, allocations, creditCards, bankSavings, stocks, funds, fds, metals, bonds, rates] = await Promise.all(
    ['spends', 'personalSpends', 'allocations', 'creditCards', 'bankSavings', 'stocks', 'funds', 'fds', 'metals', 'bonds'].map((s) => DB.all(s).catch(() => []))
      .concat([DB.get('meta', 'homeLiveRates').catch(() => null)]));
  let ef = null;
  if (modOn(_modsCache, 'ef')) { try { ef = (await (await import('./ef.js')).efLoad()).c; } catch (_) { ef = null; } }
  if (anStale(token)) return;
  const usdInr = rates && rates.value && Number(rates.value.usdInr) > 0 ? Number(rates.value.usdInr) : 0;
  const summary = summarise({ spends, personalSpends, allocations, creditCards, bankSavings, stocks, funds, fds, metals, bonds, ef, usdInr, today: todayISO() });
  const avail = availableItems(summary, (id) => modOn(_modsCache, id));
  const purposes = PURPOSES.filter((p) => p.id === 'custom' || p.items.some((i) => avail.includes(i)));
  if (!purposes.some((p) => p.id === ui._aiPurpose)) ui._aiPurpose = purposes[0].id;
  if (!ui._aiItems) ui._aiItems = new Set((PURPOSES.find((p) => p.id === ui._aiPurpose) || {}).items || []);

  host.appendChild(el('div', { class: 'card an-prompt-head' }, [
    el('h3', { text: 'Turn your MyNotes data into an AI prompt' }),
    el('p', { class: 'hint', text: 'Your financial data is already here. Create a ready-to-use prompt, edit it if you want, and paste it into any AI assistant you choose.' }),
    el('p', { class: 'hint', text: 'MyNotes does not give financial advice and sends nothing anywhere: the prompt is built on this phone, and you decide where it goes.' }),
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
  const checks = el('div', { class: 'an-items' }, DATA_ITEMS.filter((it) => avail.includes(it.id)).map((it) => {
    const box = el('input', { type: 'checkbox' });
    box.checked = ui._aiItems.has(it.id);
    box.addEventListener('change', () => { if (box.checked) ui._aiItems.add(it.id); else ui._aiItems.delete(it.id); });
    return el('label', { class: 'an-item' }, [box, el('span', { text: it.label })]);
  }));
  host.appendChild(checks);
  host.appendChild(el('p', { class: 'hint', text: 'Never included: names, notes and tags, card, bank and fund names, account or payment ids, Health Check and your passwords.' }));

  const editor = el('textarea', { class: 'an-editor', rows: '16', spellcheck: 'false', 'aria-label': 'Your prompt' });
  const make = () => buildPrompt({ summary, items: [...ui._aiItems].filter((i) => avail.includes(i)), purpose: ui._aiPurpose, question: ui._aiQuestion });
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
