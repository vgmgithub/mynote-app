// Category Spend: one view, two homes. Expenses -> Category Spend reads household spends (counted in the month they
// were logged, the Tracker's rule); Personal Finance -> Category Spend reads your own personal spends (counted in the
// month Spends and Limits count them in - a card spend on the bill its cycle puts it on - and without spends made
// for somebody else). Nothing is stored here and no record is copied: it is read from what is already logged.
// The arithmetic is in category-core.js.
import { DB } from './db.js';
import { ui } from './state.js';
import { el, fmtSheetCur, fmtIntCur, catList, REFUND_CAT, explainRow, _mountMonthStrip, _attachMonthSwipe, _rvwMonthBars, _spendMonthLabel } from './app.js';
import { isForOthers, pfCountedYm } from './personal-ui.js';
import { todayISO } from './core.js';
import { categoryMonths, categoryView } from './category-core.js';

const _open = new Set();              // which category rows are expanded, per kind
const _clicked = { house: false, personal: false };

// kind 'house' | 'personal'; stale(token) drops a load that was navigated away from; rerender repaints the tab.
export async function renderCategorySpend(host, token, { kind, stale, rerender }) {
  const house = kind === 'house';
  const [rows, cards, mod] = await Promise.all([
    DB.all(house ? 'spends' : 'personalSpends').catch(() => []),
    house ? [] : DB.all('creditCards').catch(() => []),
    house ? null : import('./credit.js'),
  ]);
  if (stale(token)) return;
  const own = house ? (rows || []) : (rows || []).filter((r) => !isForOthers(r));
  const monthOf = house ? (r) => String((r && r.ym) || '').slice(0, 7) : (r) => pfCountedYm(r, cards || [], mod);
  const months = categoryMonths(own, monthOf, REFUND_CAT);

  if (!months.size) {
    host.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '\u{1F4CA}' }),
      el('p', { text: 'Nothing logged yet.' }),
      el('p', { class: 'hint', text: house ? 'Log household spends on the Tracker and they are totalled here by category.'
        : 'Log spends on Spends and they are totalled here by category.' }),
    ]));
    return;
  }

  const groupOfName = new Map();
  (catList(house ? 'spend' : 'pf') || []).forEach((g) => (g.items || []).forEach((n) => groupOfName.set(n, g.group)));
  const thisYm = todayISO().slice(0, 7);
  const list = [...new Set([...months.keys(), thisYm])].sort();
  const key = house ? '_catYmHouse' : '_catYmPf';
  if (!ui[key] || !list.includes(ui[key])) ui[key] = thisYm;
  const ym = ui[key];
  const pick = (k) => { ui[key] = k; _clicked[kind] = true; rerender(); };

  // Month strip, the one Credit Cards -> Category Spend uses: newest first, today marked, swipe to move.
  const appHeader = document.querySelector('.app-header');
  const wrap = el('div', { class: 'cc-timeline-scroll cc-timeline-sticky trk-timeline', style: 'top:' + (appHeader ? appHeader.offsetHeight : 0) + 'px' });
  wrap.appendChild(el('div', { class: 'cc-timeline' }, list.slice().reverse().map((k) => el('button', {
    type: 'button',
    class: 'cc-timeline-chip' + (k === ym ? ' active' : '') + (k === thisYm ? ' is-current' : '') + (months.has(k) ? ' has-data' : ''),
    text: _spendMonthLabel(k), onclick: () => { if (k !== ym) pick(k); },
  }))));
  host.appendChild(wrap);
  _mountMonthStrip('catsp-' + kind, wrap, _clicked[kind]);
  _clicked[kind] = false;
  _attachMonthSwipe(host, list, ym, pick);

  const v = categoryView(months, ym, { groupOf: (n) => groupOfName.get(n) || '' });

  // ---- The month in one line, against last month and against usual ----
  const vs = (label, base) => {
    if (base == null) return null;
    const d = Math.round(v.spent - base);
    return el('span', { class: 'catsp-vs' + (d > 0 ? ' is-up' : d < 0 ? ' is-down' : '') },
      [label + ' ' + fmtIntCur(base) + (d ? ' (' + (d > 0 ? '+' : '−') + fmtIntCur(Math.abs(d)) + ')' : '')]);
  };
  host.appendChild(el('div', { class: 'card catsp-head' }, [
    el('div', { class: 'pf-cc-top' }, [el('span', { class: 'pf-cc-name', text: _spendMonthLabel(ym) + ' spent' }), el('span', { class: 'pf-cc-billed', text: fmtSheetCur(v.spent) })]),
    el('div', { class: 'catsp-vsrow' }, [vs('Last month', v.prevSpent), vs('Usual', v.usualTotal)].filter(Boolean)),
    v.back > 0 ? el('p', { class: 'hint', style: 'margin:6px 0 0', text: fmtSheetCur(v.back) + ' came back as refunds, not counted as spending.' }) : null,
  ].filter(Boolean)));

  if (v.historyMonths < 2) {
    host.appendChild(el('p', { class: 'hint catsp-thin', text: 'Add more spending history to see meaningful category trends. Usual needs at least two earlier months.' }));
  } else if (v.up.length || v.down.length) {
    // What moved: the categories furthest from their usual, both ways.
    const moverRow = (c) => el('div', { class: 'catsp-mover' }, [
      el('span', { text: c.name }),
      el('b', { class: c.vsUsual > 0 ? 'is-up' : 'is-down', text: (c.vsUsual > 0 ? '+' : '−') + fmtIntCur(Math.abs(c.vsUsual)) }),
    ]);
    host.appendChild(el('div', { class: 'card catsp-movers' }, [
      el('h3', { text: 'Against usual' }),
      v.up.length ? el('div', {}, [el('p', { class: 'catsp-sub', text: 'Higher than usual' }), ...v.up.map(moverRow)]) : null,
      v.down.length ? el('div', {}, [el('p', { class: 'catsp-sub', text: 'Lower than usual' }), ...v.down.map(moverRow)]) : null,
    ].filter(Boolean)));
  }

  // ---- Groups (Fixed, Food, ...), when there is more than one ----
  if (v.groups.length > 1) {
    host.appendChild(el('div', { class: 'card catsp-groups' }, [
      el('h3', { text: 'By group' }),
      ...v.groups.map((g) => el('div', { class: 'catsp-grow' }, [
        el('div', { class: 'catsp-gtop' }, [el('span', { text: g.group }), el('span', { text: fmtIntCur(g.amount) + ' · ' + Math.round(g.share) + '%' })]),
        el('div', { class: 'pf-cc-track' }, [el('span', { class: 'pf-cc-fill is-' + (house ? 'house' : 'personal'), style: 'width:' + g.share.toFixed(1) + '%' })]),
      ])),
    ]));
  }

  // ---- Every category: amount, share, against usual; tap for its recent months ----
  host.appendChild(el('h3', { class: 'div-group-head', text: '\u{1F4CA} ' + _spendMonthLabel(ym) + ' by category' }));
  const shown = v.cats.filter((c) => c.amount !== 0 || (c.usual || 0) > 0);
  if (!shown.some((c) => c.amount > 0)) {
    host.appendChild(el('div', { class: 'empty' }, [el('p', { text: 'Nothing spent in ' + _spendMonthLabel(ym) + '.' })]));
  }
  shown.forEach((c) => {
    const id = kind + '|' + c.name;
    const open = _open.has(id);
    const body = el('div', { class: 'catsp-hist' + (open ? '' : ' hidden') }, open ? [_rvwMonthBars(c.history, c.usual || 0)] : []);
    const row = el('button', { type: 'button', class: 'pf-card-check catsp-row' + (open ? ' is-open' : '') }, [
      el('div', { class: 'pf-cc-top' }, [el('span', { class: 'pf-cc-name', text: c.name }), el('span', { class: 'pf-cc-billed', text: fmtSheetCur(c.amount) })]),
      el('div', { class: 'pf-cc-track' }, [el('span', { class: 'pf-cc-fill is-' + (house ? 'house' : 'personal'), style: 'width:' + c.share.toFixed(1) + '%' })]),
      el('div', { class: 'pf-cc-legend' }, [
        el('span', { text: Math.round(c.share) + '% of the month' + (c.group ? ' · ' + c.group : '') }),
        c.vsUsual == null ? null : el('span', { class: 'catsp-vs' + (c.vsUsual > 0 ? ' is-up' : c.vsUsual < 0 ? ' is-down' : ''),
          text: c.vsUsual === 0 ? 'as usual' : (c.vsUsual > 0 ? '+' : '−') + fmtIntCur(Math.abs(c.vsUsual)) + ' vs usual' }),
      ].filter(Boolean)),
    ]);
    row.addEventListener('click', () => {
      if (_open.has(id)) _open.delete(id); else _open.add(id);
      const now = _open.has(id);
      row.classList.toggle('is-open', now);
      body.innerHTML = '';
      if (now) body.appendChild(_rvwMonthBars(c.history, c.usual || 0));
      body.classList.toggle('hidden', !now);
    });
    host.appendChild(row);
    host.appendChild(body);
  });

  host.appendChild(explainRow('About this view', house
    ? 'Household spends from the Tracker, totalled by category for the month they were logged in. "Usual" is the middle value of the last few months that had spending, so one heavy month does not set it. Refunds are shown apart. Nothing is stored here: it is read from what you have already logged.'
    : 'Your own spends, totalled by category in the month Spends and Limits count them in (a card spend on the bill its cycle puts it on). Spends made for somebody else are left out, as on Limits. "Usual" is the middle value of the last few months that had spending. Nothing is stored here: it is read from what you have already logged.',
  'How this is counted'));
}
