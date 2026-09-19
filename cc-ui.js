import { DB } from './db.js';
import { ui } from './state.js';
import { el, $, state, modOn, _modsCache, _mountMonthStrip, _attachMonthSwipe, fmtSheetCur, round2, explainRow, expRenderStale } from './app.js';
import { renderCreditCards } from './cards-ui.js';
import { renderPfCardCheck } from './personal-ui.js';

// ---------- Credit Cards: its own screen (Credit Card | Heatmap | Category Spend | Card Check) ----------
// Manage > Analyse > Understand > Reconcile. Nothing here has storage of its own:
// every tab is a view over the creditCards, spends and personalSpends stores.
const TABS = [['cc', '\u{1F4B3}', 'Credit Card'], ['heat', '\u{1F525}', 'Heatmap'], ['cat', '\u{1F4CA}', 'Category Spend'], ['chk', '\u{1F9FE}', 'Card Check']];
const LOCK_TEXT = {
  cat: 'Select Expenses + Personal Finance to analyse your card spending by category.',
  chk: 'Select Expenses + Personal Finance to compare your card statements with your logged spending.',
};
// Category Spend and Card Check read both trackers, so they need both features.
export const ccLinked = () => modOn(_modsCache, 'expense') && modOn(_modsCache, 'personal');
const isLocked = (v) => (v === 'cat' || v === 'chk') && !ccLinked();

export function buildCcBottomNav() {
  const nav = $('#ccBottomNav');
  nav.innerHTML = '';
  TABS.forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, class: isLocked(v) ? 'is-locked' : '', onclick: () => { if (ui._ccTab === v) return; ui._ccTab = v; renderCc(); } },
      [el('span', { class: 'bn-ico', text: isLocked(v) ? '\u{1F512}' : ico }), label]));
  });
  updateCcNavActive();
}
function updateCcNavActive() {
  $('#ccBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._ccTab));
}

export async function renderCc() {
  if (state.appMode !== 'cc') return;
  const host = $('#ccView');
  host.innerHTML = '';
  updateCcNavActive();
  $('#ccAddBtn').classList.toggle('hidden', ui._ccTab !== 'cc');
  const token = ++ui._expRenderToken;
  const tab = ui._ccTab;
  if (isLocked(tab)) {
    host.appendChild(el('div', { class: 'empty cc-locked' }, [
      el('div', { class: 'e-icon', text: '\u{1F512}' }),
      el('p', { text: LOCK_TEXT[tab] }),
    ]));
    return;
  }
  if (tab === 'heat') { await renderCreditCards(host, token, 'heat'); return; }
  if (tab === 'cat') { await renderCcCategory(host, token); return; }
  if (tab === 'chk') { await renderPfCardCheck(host, token, { rerender: renderCc, stale: expRenderStale }); return; }
  await renderCreditCards(host, token);
}

// Card spending by category for one statement month, household and personal
// together. Attribution is the same as everywhere else: a spend belongs to the bill
// its own card's cycle puts it on (statementYmFor), so the totals agree with the
// Card Check. Refunds are negative amounts and simply net off.
async function renderCcCategory(host, token) {
  const mod = await import('./credit.js');
  const [cards, house, personal] = await Promise.all([
    DB.all('creditCards').then((r) => r || []),
    DB.all('spends').catch(() => []),
    DB.all('personalSpends').catch(() => []),
  ]);
  if (expRenderStale(token)) return;
  if (!cards.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\u{1F4B3}' }),
      el('p', { text: 'No credit cards yet.' }),
      el('p', { class: 'hint', text: 'Add a card on the Credit Card tab, then log spends against it.' }),
    ]));
    return;
  }
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const stmt = (r) => { const c = cardById.get(r.cardId); return r.method === 'Card' && c ? mod.statementYmFor(r.date, c) : null; };
  const rows = [];
  house.forEach((r) => { const k = stmt(r); if (k) rows.push({ r, k, kind: 'house' }); });
  personal.forEach((r) => { const k = stmt(r); if (k) rows.push({ r, k, kind: 'personal' }); });

  const thisYm = new Date().toISOString().slice(0, 7);
  const months = [...new Set(rows.map((x) => x.k).concat([thisYm]))].sort();
  if (!ui._ccYm || !months.includes(ui._ccYm)) ui._ccYm = thisYm;
  const ym = ui._ccYm;
  if (ui._ccCardId && !cardById.has(ui._ccCardId)) ui._ccCardId = null;
  const cardId = ui._ccCardId;

  const appHeader = document.querySelector('.app-header');
  const wrap = el('div', { class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline', style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px' });
  const hasData = new Set(rows.map((x) => x.k));
  wrap.appendChild(el('div', { class: 'cc-timeline' }, months.slice().reverse().map((k) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip' + (k === ym ? ' active' : '') + (k === thisYm ? ' is-current' : '') + (hasData.has(k) ? ' has-data' : ''),
    text: mod.monthLabel(k),
    onclick: () => { if (k === ym) return; ui._ccYm = k; ui._ccTimelineClicked = true; renderCc(); },
  }))));
  host.appendChild(wrap);
  _mountMonthStrip('cccat', wrap, ui._ccTimelineClicked);
  ui._ccTimelineClicked = false;
  _attachMonthSwipe(host, months, ym, (k) => { ui._ccYm = k; ui._ccTimelineClicked = true; renderCc(); });

  host.appendChild(el('div', { class: 'cc-timeline cc-cardchips' }, [{ id: null, name: 'All cards' }].concat(cards).map((c) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip' + ((c.id || null) === cardId ? ' active' : ''),
    text: c.name || 'Card',
    onclick: () => { ui._ccCardId = c.id || null; renderCc(); },
  }))));
  host.appendChild(el('h3', { class: 'div-group-head', text: '\u{1F4CA} ' + mod.monthLabel(ym) + ' by category' }));

  const inScope = rows.filter((x) => x.k === ym && (!cardId || x.r.cardId === cardId));
  if (!inScope.length) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('p', { text: 'No card spends on this month’s bill.' }),
      el('p', { class: 'hint', text: 'Log a spend with the Card method and it shows up here, under the bill it lands on.' }),
    ]));
  } else {
    const by = new Map();
    inScope.forEach(({ r, kind }) => {
      const name = r.category || 'Uncategorised';
      const e = by.get(name) || { name, house: 0, personal: 0 };
      e[kind] += Number(r.amount) || 0;
      by.set(name, e);
    });
    const list = [...by.values()].map((e) => Object.assign(e, { total: round2(e.house + e.personal) })).sort((a, b) => b.total - a.total);
    const grand = round2(list.reduce((s, e) => s + e.total, 0));
    const max = Math.max(1, ...list.map((e) => Math.abs(e.total)));
    host.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'pf-cc-top' }, [el('span', { class: 'pf-cc-name', text: cardId ? (cardById.get(cardId).name || 'Card') : 'All cards' }), el('span', { class: 'pf-cc-billed', text: fmtSheetCur(grand) })]),
    ]));
    list.forEach((e) => {
      host.appendChild(el('div', { class: 'pf-card-check' }, [
        el('div', { class: 'pf-cc-top' }, [el('span', { class: 'pf-cc-name', text: e.name }), el('span', { class: 'pf-cc-billed', text: fmtSheetCur(e.total) })]),
        el('div', { class: 'pf-cc-track' }, [el('span', { class: 'pf-cc-fill is-house', style: 'width:' + (Math.max(0, e.total) / max * 100).toFixed(1) + '%' })]),
        el('div', { class: 'pf-cc-legend' }, [
          el('span', {}, [el('i', { class: 'rvw-dot is-house' }), 'household ' + fmtSheetCur(round2(e.house))]),
          el('span', {}, [el('i', { class: 'rvw-dot is-personal' }), 'personal ' + fmtSheetCur(round2(e.personal))]),
        ]),
      ]));
    });
  }
  host.appendChild(explainRow('About this view', 'Household spends from the Tracker and personal ones from Personal Finance, each counted on the bill its card’s cycle puts it on, so the totals match the Card Check. Refunds net off their category. Nothing is stored here: it is read from what you have already logged.', 'How this is counted'));
}
