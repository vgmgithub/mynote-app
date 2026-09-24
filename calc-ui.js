// Financial Calculators: its own screen (FD | Compound | Inflation | Decide). Took the place of the one-screen
// Inflation Calculator, which is now its third tab. Nothing here touches the user's records: every figure is typed
// in, and only the inflation rate is remembered (meta.inflationRatePct, the key the old calculator used).
// The maths is in calc-core.js.
import { DB } from './db.js';
import { ui } from './state.js';
import { el, $, state, field, fmtIntCur } from './app.js';
import { num, todayISO } from './core.js';
import { fdCalc, compoundGrowth, PER_YEAR, presentValue, futureCost, moneyOptions, GOALS, DEFAULT_INFLATION_PCT, DECISION_DISCLAIMER } from './calc-core.js';

const TABS = [['fd', '\u{1F3E6}', 'FD'], ['compound', '\u{1F4C8}', 'Compound'], ['inflation', '\u{1F4C9}', 'Inflation'], ['decide', '\u{1F9ED}', 'Decide']];
const TAB_IDS = TABS.map(([v]) => v);
// What was typed, per tab, kept while switching tabs (not saved: these are what-ifs).
const S = { fd: {}, compound: {}, inflation: {}, decide: {} };

export function buildCalcBottomNav() {
  const nav = $('#calcBottomNav');
  if (nav.childElementCount) { updateCalcNavActive(); return; }
  TABS.forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, type: 'button', onclick: () => { if (ui._calcTab === v) return; ui._calcTab = v; renderCalc(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateCalcNavActive();
}
function updateCalcNavActive() {
  $('#calcBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._calcTab));
}

export async function renderCalc() {
  if (state.appMode !== 'calc') return;
  if (!TAB_IDS.includes(ui._calcTab)) ui._calcTab = 'fd';
  const host = $('#calcView');
  host.innerHTML = '';
  updateCalcNavActive();
  // Get Started's "try the calculators" step is done the first time any of them is opened.
  DB.get('meta', 'calcUsed').then((r) => { if (!r) DB.put('meta', { key: 'calcUsed', value: true }); }).catch(() => {});
  const tab = ui._calcTab;
  if (tab === 'compound') return renderCompound(host);
  if (tab === 'inflation') return renderInflation(host);
  if (tab === 'decide') return renderDecide(host);
  return renderFd(host);
}

// ---------- small building blocks ----------
const numIn = (st, key, attrs, onInput) => {
  const i = el('input', { type: 'number', inputmode: 'decimal', step: 'any', ...attrs });
  if (st[key] != null && st[key] !== '') i.value = st[key];
  i.addEventListener('input', () => { st[key] = i.value; onInput(); });
  return i;
};
const seg = (opts, cur, onPick) => el('div', { class: 'seg calc-seg', role: 'group' }, opts.map(([v, label]) =>
  el('button', { type: 'button', class: v === cur ? 'active' : '', text: label, onclick: () => onPick(v) })));
const card = (title, children, cls) => el('div', { class: 'chart-card calc-card' + (cls ? ' ' + cls : '') }, [title ? el('h3', { text: title }) : null, ...children].filter(Boolean));
const big = (label, value, hint) => el('div', { class: 'ef-proj-big' }, [
  el('div', { class: 'label', text: label }), el('div', { class: 'big', text: value }), hint ? el('div', { class: 'hint', text: hint }) : null,
].filter(Boolean));
const line = (k, v) => el('div', { class: 'calc-line' }, [el('span', { text: k }), el('b', { text: v })]);
const pctText = (n) => (Math.round(n * 100) / 100).toFixed(2) + '%';
const empty = (text) => el('p', { class: 'hint calc-empty', text });

// ---------- FD ----------
function renderFd(host) {
  const st = S.fd;
  st.comp = st.comp || 'quarterly';
  st.payout = !!st.payout;
  const out = el('div');
  const refresh = () => {
    out.innerHTML = '';
    const months = (num(st.years) || 0) * 12 + (num(st.months) || 0);
    const r = fdCalc({ principal: num(st.principal), ratePct: num(st.rate), months, compounding: st.comp, payout: st.payout, today: todayISO() });
    if (!r) { out.appendChild(empty('Enter the deposit, the interest rate and how long to see what it grows to.')); return; }
    if (st.payout) {
      out.appendChild(big('Interest paid to you each month', fmtIntCur(r.monthlyIncome), 'The deposit itself (' + fmtIntCur(r.principal) + ') comes back at maturity.'));
    } else {
      out.appendChild(big('Maturity value', fmtIntCur(r.maturityValue), 'on ' + new Date(r.maturityDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })));
    }
    out.appendChild(el('div', { class: 'calc-lines' }, [
      line('Deposit', fmtIntCur(r.principal)),
      line('Interest earned', fmtIntCur(r.interest)),
      st.payout ? null : line('Effective yield per year', pctText(r.effectivePct)),
    ].filter(Boolean)));
    out.appendChild(el('p', { class: 'hint', text: 'The same calculation the Fixed Deposits screen uses. Banks may round differently by a few rupees; interest is taxable at your slab.' }));
  };
  host.appendChild(card('FD calculator', [
    el('p', { class: 'hint', text: 'What a fixed deposit grows to, or pays you each month.' }),
    field('Deposit (₹)', numIn(st, 'principal', { placeholder: 'e.g. 100000' }, refresh)),
    field('Interest rate (% per year)', numIn(st, 'rate', { placeholder: 'e.g. 7.5' }, refresh)),
    el('div', { class: 'field-row' }, [
      field('Years', numIn(st, 'years', { inputmode: 'numeric', step: '1', placeholder: '0' }, refresh)),
      field('Months', numIn(st, 'months', { inputmode: 'numeric', step: '1', placeholder: '0' }, refresh)),
    ]),
    field('Compounding', seg([['quarterly', 'Quarterly'], ['monthly', 'Monthly'], ['half-yearly', 'Half-yearly'], ['yearly', 'Yearly']], st.comp, (v) => { st.comp = v; renderCalc(); })),
    field('Interest', seg([[false, 'Reinvested'], [true, 'Paid out monthly']], st.payout, (v) => { st.payout = v; renderCalc(); })),
    out,
  ]));
  refresh();
}

// ---------- Compound interest ----------
function renderCompound(host) {
  const st = S.compound;
  st.freq = st.freq || 'monthly';
  const out = el('div');
  const refresh = () => {
    out.innerHTML = '';
    const r = compoundGrowth({ principal: num(st.principal), monthly: num(st.monthly), ratePct: num(st.rate), years: num(st.years), perYear: PER_YEAR[st.freq] });
    if (!r) { out.appendChild(empty('Enter an amount (or a monthly addition), a yearly rate and how many years.')); return; }
    out.appendChild(big('After ' + r.years + ' year' + (r.years === 1 ? '' : 's'), fmtIntCur(r.futureValue)));
    out.appendChild(el('div', { class: 'calc-lines' }, [line('You put in', fmtIntCur(r.invested)), line('Growth', fmtIntCur(r.interest))]));
    // Year by year, at most ten rows so a 40-year run still fits a phone.
    const step = Math.max(1, Math.ceil(r.byYear.length / 10));
    const rows = r.byYear.filter((y, i) => (i + 1) % step === 0 || i === r.byYear.length - 1);
    const top = r.futureValue || 1;
    out.appendChild(el('div', { class: 'calc-bars' }, rows.map((y) => el('div', { class: 'calc-bar-row' }, [
      el('span', { class: 'calc-bar-k', text: 'Yr ' + y.year }),
      el('span', { class: 'calc-bar' }, [
        el('i', { class: 'calc-bar-in', style: 'width:' + ((y.invested / top) * 100).toFixed(1) + '%' }),
        el('i', { class: 'calc-bar-gain', style: 'width:' + (((y.value - y.invested) / top) * 100).toFixed(1) + '%' }),
      ]),
      el('span', { class: 'calc-bar-v', text: fmtIntCur(y.value) }),
    ]))));
    out.appendChild(el('p', { class: 'hint', text: 'Assumes the same rate every year. Real returns vary, and can be negative.' }));
  };
  host.appendChild(card('Compound interest', [
    el('p', { class: 'hint', text: 'How a sum grows when returns are added back each period, with or without a monthly addition.' }),
    field('Starting amount (₹)', numIn(st, 'principal', { placeholder: 'e.g. 50000' }, refresh)),
    field('Added every month (₹, optional)', numIn(st, 'monthly', { placeholder: '0' }, refresh)),
    el('div', { class: 'field-row' }, [
      field('Rate (% per year)', numIn(st, 'rate', { placeholder: 'e.g. 8' }, refresh)),
      field('Years', numIn(st, 'years', { inputmode: 'numeric', step: '1', placeholder: 'e.g. 10' }, refresh)),
    ]),
    field('Compounding', seg([['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half-yearly', 'Half-yearly'], ['yearly', 'Yearly']], st.freq, (v) => { st.freq = v; renderCalc(); })),
    out,
  ]));
  refresh();
}

// ---------- Inflation ----------
// The old Inflation Calculator, unchanged in what it works out: a future amount in today's money. It also says what
// today's amount will cost then, the same figure read the other way round.
async function renderInflation(host) {
  const st = S.inflation;
  if (st.rate == null) {
    const row = await DB.get('meta', 'inflationRatePct').catch(() => null);
    st.rate = row && row.value != null ? Number(row.value) : DEFAULT_INFLATION_PCT;
    if (state.appMode !== 'calc' || ui._calcTab !== 'inflation') return;
  }
  const thisYear = new Date().getFullYear();
  if (st.year == null) st.year = thisYear + 10;
  const out = el('div');
  const refresh = () => {
    out.innerHTML = '';
    const amt = num(st.amount), rate = num(st.rate), year = num(st.year);
    if (!(amt > 0) || rate == null) { out.appendChild(empty('Enter an amount to see its value in today’s money.')); return; }
    const years = year != null ? year - thisYear : 0;
    if (!(years > 0)) { out.appendChild(empty('Pick a year after ' + thisYear + '.')); return; }
    out.appendChild(big(fmtIntCur(amt) + ' in ' + year + ' is worth, today', fmtIntCur(presentValue(amt, rate, years)),
      years + ' year' + (years === 1 ? '' : 's') + ' away, at ' + rate.toFixed(2) + '% average inflation'));
    out.appendChild(el('div', { class: 'calc-lines' }, [line('What costs ' + fmtIntCur(amt) + ' today will cost in ' + year, fmtIntCur(futureCost(amt, rate, years)))]));
  };
  const rateIn = numIn(st, 'rate', {}, refresh);
  // Saved once the field is left, not per keystroke.
  rateIn.addEventListener('change', () => { const r = num(rateIn.value); if (r != null) DB.put('meta', { key: 'inflationRatePct', value: r }).catch(() => {}); });
  host.appendChild(card('Inflation', [
    el('p', { class: 'hint', text: 'What a future rupee amount is actually worth in today’s money, given average inflation between now and then.' }),
    field('Inflation rate (% per year)', rateIn),
    field('Amount (₹)', numIn(st, 'amount', { placeholder: '₹ amount' }, refresh)),
    field('Year', numIn(st, 'year', { inputmode: 'numeric', step: '1' }, refresh)),
    out,
  ]));
  refresh();
}

// ---------- Where could this money go? ----------
const FIT_TEXT = { closer: 'Often considered', partly: 'Worth weighing', looser: 'Usually less suited' };
function renderDecide(host) {
  const st = S.decide;
  st.unit = st.unit || 'years';
  st.risk = st.risk || 'low';
  st.goal = st.goal || '';
  const out = el('div');
  const refresh = () => {
    out.innerHTML = '';
    const whenNum = num(st.when);
    const months = whenNum > 0 ? (st.unit === 'years' ? whenNum * 12 : whenNum) : 0;
    const r = moneyOptions({ amount: num(st.amount), months, risk: st.risk, goal: st.goal });
    if (!r) { out.appendChild(empty('Say when the money will be needed to compare the options.')); return; }
    out.appendChild(el('p', { class: 'calc-framing', text: r.framing }));
    r.rows.forEach((o) => out.appendChild(el('div', { class: 'calc-opt is-' + o.fit }, [
      el('div', { class: 'calc-opt-head' }, [el('b', { text: o.label }), el('span', { class: 'calc-fit', text: FIT_TEXT[o.fit] })]),
      el('div', { class: 'calc-attrs' }, [
        ['Liquidity', o.liquidity], ['Capital preservation', o.preservation], ['Growth potential', o.growth], ['Volatility', o.volatility],
      ].map(([k, v]) => el('div', {}, [el('span', { text: k }), el('b', { text: v })]))),
      el('ul', { class: 'calc-why' }, o.reasons.map((t) => el('li', { text: t }))),
      el('p', { class: 'hint', text: o.note }),
    ])));
    out.appendChild(el('p', { class: 'calc-disclaimer', text: DECISION_DISCLAIMER }));
  };
  const goalSel = el('select', { 'aria-label': 'Goal' }, GOALS.map(([v, label]) => {
    const o = el('option', { value: v, text: label }); if (v === st.goal) o.selected = true; return o;
  }));
  goalSel.addEventListener('change', () => { st.goal = goalSel.value; refresh(); });
  host.appendChild(card('Where could this money go?', [
    el('p', { class: 'hint', text: 'Compare broad kinds of place for a sum, by when you need it and how much risk you can take. It explains trade-offs; the choice is yours.' }),
    field('Amount (₹, optional)', numIn(st, 'amount', { placeholder: 'e.g. 200000' }, refresh)),
    el('div', { class: 'field-row' }, [
      field('Needed in', numIn(st, 'when', { inputmode: 'numeric', step: '1', placeholder: 'e.g. 3' }, refresh)),
      field(' ', seg([['years', 'Years'], ['months', 'Months']], st.unit, (v) => { st.unit = v; renderCalc(); })),
    ]),
    field('Risk tolerance', seg([['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], st.risk, (v) => { st.risk = v; renderCalc(); })),
    field('Goal (optional)', goalSel),
    out,
  ]));
  refresh();
}
