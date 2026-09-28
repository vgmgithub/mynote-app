// The quick-entry pieces both spend forms share, household (Kitty) and Personal: recent categories first with the
// full list folded away, one-tap usual amounts, Today / Yesterday, a live "left after this" line and an inline
// "this is missing". The choices behind them are worked out in spend-quick.js.
import { el } from './app.js';
import { dayShift } from './spend-quick.js';

const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// "Recent" chips over the full category list. With enough history (`fold`) the full list folds behind "All
// categories", so the usual pick is one tap and the sheet is shorter. Without recents it is the full list, as before.
export function quickCategories({ recents, grid, current, onPick, fold, hueOf = catHue }) {
  const btns = (recents || []).map((name) => el('button', {
    type: 'button', class: 'spend-cat-btn quick-cat' + (name === current ? ' active' : ''), text: name,
    style: '--h:' + hueOf(name), onclick: () => onPick(name),
  }));
  const row = btns.length ? el('div', { class: 'quick-cats' }, [
    el('span', { class: 'quick-cats-label', text: 'Recent' }),
    el('div', { class: 'quick-cats-row' }, btns),
  ]) : null;
  const folded = !!(fold && row);
  const all = el('div', { class: 'quick-all' + (folded ? '' : ' open') }, [grid]);
  const toggle = row ? el('button', { type: 'button', class: 'quick-all-toggle', 'aria-expanded': folded ? 'false' : 'true' }, [
    el('span', { text: 'All categories' }),
    el('span', { class: 'quick-all-chev', 'aria-hidden': 'true', text: '▾' }),
  ]) : null;
  const setOpen = (open) => {
    all.classList.toggle('open', open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  if (toggle) toggle.addEventListener('click', () => setOpen(!all.classList.contains('open')));
  return {
    node: el('div', { class: 'quick-cat-wrap' }, [row, toggle, all].filter(Boolean)),
    mark: (name) => btns.forEach((b) => b.classList.toggle('active', b.textContent === name)),
  };
}

// The usual amounts for the chosen category, as chips under the amount. Empty hides the row.
export function amountChips(onPick) {
  const node = el('div', { class: 'quick-amts hidden', role: 'group', 'aria-label': 'Usual amounts' });
  const show = (amounts) => {
    node.innerHTML = '';
    (amounts || []).forEach((a) => node.appendChild(el('button', {
      type: 'button', class: 'quick-amt', text: inr(a), onclick: () => onPick(a),
    })));
    node.classList.toggle('hidden', !(amounts && amounts.length));
  };
  return { node, show };
}

// Today and Yesterday beside the date box. A chip sets the box and fires its change event, so whatever already
// follows the date (the closed-month card note, the month a spend is counted in) follows the chip too.
export function dateChips(input, today) {
  const yest = dayShift(today, -1);
  const chip = (label, iso) => el('button', {
    type: 'button', class: 'quick-day', text: label,
    onclick: () => { input.value = iso; input.dispatchEvent(new Event('change')); },
  });
  const tBtn = chip('Today', today), yBtn = chip('Yesterday', yest);
  const sync = () => {
    const v = input.value;
    tBtn.classList.toggle('active', v === today);
    yBtn.classList.toggle('active', v === yest);
    input.classList.toggle('is-picked', !!v && v !== today && v !== yest);
  };
  input.addEventListener('change', sync);
  input.addEventListener('input', sync);
  sync();
  return el('div', { class: 'quick-days' }, [tBtn, yBtn, input]);
}

// The big amount box: a ₹ in front, and the keyboard's Done key saves.
export function bigAmount(input, onDone) {
  input.classList.add('quick-amount-in');
  input.setAttribute('enterkeyhint', 'done');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onDone(); } });
  return el('div', { class: 'quick-amount' }, [el('span', { class: 'quick-amount-cur', 'aria-hidden': 'true', text: '₹' }), input]);
}

// One quiet line that says what is left, and turns red when this entry takes it over.
export function leftLine() {
  const node = el('p', { class: 'quick-left hidden', 'aria-live': 'polite' });
  return {
    node,
    set: (text, over) => {
      node.textContent = text || '';
      node.classList.toggle('hidden', !text);
      node.classList.toggle('is-over', !!over);
    },
  };
}
// "₹2,300 left" or "₹200 over".
export const leftWords = (fmt, n) => (n < 0 ? fmt(-n) + ' over' : fmt(n) + ' left');
// "₹2,050 after this" or "₹200 over after this".
export const afterWords = (fmt, n) => (n < 0 ? fmt(-n) + ' over after this' : fmt(n) + ' after this');

// Points at what is missing instead of only saying it in a toast: a short red pulse, scrolled into view.
export function markMissing(node) {
  if (!node) return;
  node.classList.remove('is-missing');
  void node.offsetWidth;
  node.classList.add('is-missing');
  try { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { /* older browsers */ }
  setTimeout(() => node.classList.remove('is-missing'), 1600);
}

// A stable soft hue per category name, so each chip keeps its own pastel ("milk") tint everywhere it appears.
export function catHue(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// One hue per category GROUP, so every chip in a group shares a colour. Matched on words in the group's name
// (groups are the user's to rename); anything unrecognised still gets a stable hue of its own.
const GROUP_HUES = [
  [/fix|bill|rent|util|emi|loan/i, 215],
  [/home|house/i, 170],
  [/grocer|food|milk|kitchen/i, 125],
  [/shop|cloth|fashion/i, 288],
  [/life|fun|entertain|dining|leisure/i, 250],
  [/health|medic|doctor|pharm/i, 352],
  [/travel|transport|fuel|commute|car|bike/i, 20],
  [/kid|child|school|educat/i, 55],
  [/other|misc/i, 48],
];
export function groupHue(group) {
  const hit = GROUP_HUES.find(([re]) => re.test(String(group || '')));
  return hit ? hit[1] : catHue(group);
}

// "Left this month" card: what is left of the budget, a bar of how much is spent, and per day for the rest of it.
// The bar's colours sit on the FULL track (green, blue, yellow, red at 0/35/65/100%), so the fill shows only as far
// as it has reached; over budget the whole bar is red.
export function budgetCard({ fmt, budget, left, daysLeft, label, overLabel }) {
  const pct = budget > 0 ? ((budget - left) / budget) * 100 : 0;
  const over = left < 0;
  const w = over ? 100 : Math.max(0, Math.min(100, pct));
  const fill = el('span', { class: 'bcard-fill' + (over ? ' is-over' : ''),
    style: 'width:' + w.toFixed(1) + '%' + (!over && w > 0 ? ';background-size:' + (10000 / w).toFixed(1) + '% 100%' : '') });
  const perDay = !over && daysLeft > 0 ? fmt(Math.floor(left / daysLeft)) + ' a day' : '';
  const days = daysLeft > 0 ? daysLeft + (daysLeft === 1 ? ' day left' : ' days left') : '';
  return el('div', { class: 'bcard' + (over ? ' is-over' : '') }, [
    el('div', { class: 'bcard-top' }, [
      el('span', { text: over ? (overLabel || 'Over budget this month') : (label || 'Left this month') }),
      el('b', { text: fmt(Math.abs(left)) }),
    ]),
    el('div', { class: 'bcard-bar' }, [fill]),
    el('div', { class: 'bcard-foot' }, [
      el('span', { text: [perDay, days].filter(Boolean).join(' · ') }),
      el('span', { text: Math.round(pct) + '% of ' + fmt(budget) }),
    ]),
  ]);
}

// The form as a vertical timeline: one step open at a time, every other step collapsed to its label with what was
// chosen underneath in small type. Picking something moves on by itself; tapping a step's header goes back to it.
// steps: [{ key, label, body, summary: () => string, optional }]
export function stepFlow(steps, start) {
  const items = steps.map((s, i) => {
    const sum = el('span', { class: 'step-sum' });
    const head = el('button', { type: 'button', class: 'step-head' }, [
      el('span', { class: 'step-dot', text: String(i + 1) }),
      el('span', { class: 'step-txt' }, [el('span', { class: 'step-label', text: s.label }), sum]),
      el('span', { class: 'step-chev', 'aria-hidden': 'true', text: '›' }),
    ]);
    const node = el('section', { class: 'step', 'data-step': s.key }, [head, el('div', { class: 'step-body' }, [s.body])]);
    head.addEventListener('click', () => open(node.classList.contains('is-open') ? null : s.key));
    return { s, node, sum, head };
  });
  const refresh = () => items.forEach((it) => {
    const v = it.s.summary();
    it.sum.textContent = v || (it.s.optional ? 'Optional' : 'Choose');
    it.node.classList.toggle('is-done', !!v);
  });
  const open = (key) => {
    items.forEach((it) => {
      const on = it.s.key === key;
      it.node.classList.toggle('is-open', on);
      it.head.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    refresh();
    const it = items.find((x) => x.s.key === key);
    if (it) requestAnimationFrame(() => { try { it.node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) { /* older browsers */ } });
  };
  const next = (key) => {
    const i = items.findIndex((x) => x.s.key === key);
    if (i < 0 || !items[i].node.classList.contains('is-open')) { refresh(); return; }
    open(items[i + 1] ? items[i + 1].s.key : null);
  };
  const node = el('div', { class: 'step-flow' }, items.map((it) => it.node));
  ['input', 'change', 'click'].forEach((ev) => node.addEventListener(ev, refresh));
  open(start);
  return { node, open, next, refresh, stepNode: (key) => (items.find((x) => x.s.key === key) || {}).node };
}

// "✓ 2 added" beside the title while adding one after another.
export const addedPill = (n) => (n > 0 ? el('span', { class: 'quick-added', text: '✓ ' + n + ' added' }) : null);
