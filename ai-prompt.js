// Get AI Prompt (a tab inside Analysis): turns the user's own MyNotes data into a prompt they can review, edit and
// paste into any AI assistant they choose. MyNotes gives no advice itself, and SENDS NOTHING: this file makes no
// network request of any kind and is pure - raw records in, text out - so what goes into a prompt is decided here,
// in one place, and tested.
//
// What never goes in, by construction (the summaries below simply never read these fields):
//   notes, remarks, tags and every other free-text field; card, fund and stock names; bank and account names;
//   loan "who"/"purpose" and "who has it" labels; payment/transaction/order ids; the anonymous name, install id and
//   the person's name; anything from Health Check or the password vault; the "wife" portfolio label.
// Amounts are rounded to whole rupees. Only the sections the user ticks are included.
import { categoryMonths, categoryView } from './category-core.js';
import { computeFund } from './mf.js';
import { computeFd } from './fd.js';

const R = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const pos = (n) => Math.max(0, Number(n) || 0);
const monLabel = (ym) => {
  const m = /^(\d{4})-(\d{2})/.exec(ym || '');
  return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1] : ym;
};

// The things a prompt can include. `needs`: any one of these features must be on. The screen lists only items that
// are on AND have data behind them.
export const DATA_ITEMS = [
  { id: 'income', label: 'Monthly income', needs: ['expense'] },
  { id: 'household', label: 'Household spending', needs: ['expense'] },
  { id: 'personal', label: 'Personal spending', needs: ['personal'] },
  { id: 'categories', label: 'Spending categories', needs: ['expense', 'personal'] },
  { id: 'trends', label: 'Spending trends (last 6 months)', needs: ['expense', 'personal'] },
  { id: 'cards', label: 'Credit-card usage', needs: ['cc'] },
  { id: 'savings', label: 'Savings (bank balances)', needs: ['banksav'] },
  { id: 'investments', label: 'Investments', needs: ['stocks', 'mf', 'fd', 'metal', 'bond'] },
  { id: 'emergency', label: 'Emergency fund', needs: ['ef'] },
  { id: 'goals', label: 'Financial goals and yearly plan', needs: ['expense', 'ef'] },
];

// What the prompt is for, and which items it starts ticked with (the user can change every tick).
export const PURPOSES = [
  { id: 'health', label: 'Financial health review', items: ['income', 'household', 'personal', 'savings', 'investments', 'emergency'],
    ask: 'Give me an overall review of my financial health based on this data: what looks solid, what looks stretched, and what I might look at first.' },
  { id: 'spending', label: 'Spending analysis', items: ['household', 'personal', 'categories', 'trends'],
    ask: 'Analyse my spending: patterns, categories that stand out, and how this month compares with my usual.' },
  { id: 'cards', label: 'Credit card review', items: ['cards', 'personal', 'household'],
    ask: 'Review how I use my credit cards: bills against limits, trends, and anything that looks risky.' },
  { id: 'investments', label: 'Investment overview', items: ['investments', 'savings', 'emergency'],
    ask: 'Give me an overview of how my investments are spread across types, and the trade-offs and risks of that spread.' },
  { id: 'goals', label: 'Savings / goal planning', items: ['income', 'goals', 'savings', 'emergency', 'household', 'personal'],
    ask: 'Help me think about my savings goals: whether the plan looks realistic against what I actually spend, and what to consider.' },
  { id: 'reduce', label: 'Where could I reduce spending?', items: ['household', 'personal', 'categories', 'trends'],
    ask: 'Where could I reasonably reduce my spending? Point to specific categories or patterns in the data, and say what you are assuming.' },
  { id: 'allocate', label: 'Where should I consider allocating my money?', items: ['income', 'savings', 'investments', 'emergency', 'goals'],
    ask: 'What should I consider when deciding where to allocate my money? Explain the options, their risks and trade-offs, rather than telling me what to buy.' },
  { id: 'custom', label: 'Custom question', items: [], ask: '' },
];

// ---------- raw records -> safe summaries ----------
// `raw` holds the store arrays as read: spends, personalSpends, allocations, creditCards, bankSavings, stocks, funds,
// fds, metals, bonds, plus `ef` (the emergency-fund totals efLoad already works out), `usdInr` (the cached rate, or
// 0) and `today` ('YYYY-MM-DD'). Every summary returns plain numbers and fixed labels, or null when there is no data.
function spendSummary(rows, monthOf, today) {
  const months = categoryMonths(rows || [], monthOf);
  if (!months.size) return null;
  const ym = today.slice(0, 7);
  const v = categoryView(months, ym);
  const last6 = [...months.keys()].filter((k) => k <= ym).sort().slice(-6).map((k) => ({ ym: k, spent: months.get(k).spent }));
  return { ym, spent: v.spent, usual: v.usualTotal, history: v.historyMonths, cats: v.cats.filter((c) => c.amount > 0 || (c.usual || 0) > 0).slice(0, 8), last6 };
}

export function summarise(raw) {
  const r = raw || {};
  const today = r.today || new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const out = {};
  const alloc = (r.allocations || []).find((a) => Number(a.year) === year) || null;
  if (alloc && pos(alloc.salary) > 0) out.income = { salary: pos(alloc.salary) };
  if (alloc) {
    const lines = [['Parents', alloc.home], ['House expense', alloc.houseExp], ['Personal spending', alloc.card], ['Emergency fund', alloc.emergency],
      ['Mutual funds', alloc.mf], ['Fixed deposits', alloc.fd], ['Indian stocks', alloc.indStock], ['US stocks', alloc.usStock], ['Gold & silver', alloc.metal], ['Savings', alloc.savings]]
      .filter(([, v]) => pos(v) > 0).map(([k, v]) => ({ label: k, amount: pos(v) }));
    if (lines.length) out.plan = { year, lines };
  }
  out.household = spendSummary(r.spends, (x) => String((x && x.ym) || '').slice(0, 7), today);
  // Own spending only: money fronted for somebody who pays it back is left out, as on Limits.
  out.personal = spendSummary((r.personalSpends || []).filter((x) => !(x && x.forOthers)), (x) => String((x && x.ym) || '').slice(0, 7), today);
  const cards = (r.creditCards || []).map((c, i) => {
    const bills = (c.months || []).filter((m) => pos(m.billed) > 0).sort((a, b) => String(a.ym).localeCompare(String(b.ym))).slice(-3);
    return { label: 'Card ' + (i + 1), limit: pos(c.creditLimit), bills: bills.map((m) => ({ ym: m.ym, billed: pos(m.billed) })) };
  }).filter((c) => c.limit > 0 || c.bills.length);
  if (cards.length) out.cards = cards;
  const banks = r.bankSavings || [];
  if (banks.length) {
    const byType = new Map();
    banks.forEach((b) => { const t = String(b.label || 'Account').slice(0, 30); byType.set(t, (byType.get(t) || 0) + pos(b.balance)); });
    out.savings = { total: banks.reduce((s, b) => s + pos(b.balance), 0), accounts: banks.length, byType: [...byType].map(([type, amount]) => ({ type, amount })) };
  }
  const inv = [];
  const PORT = { 'me-in': 'Indian stocks', 'wife-in': 'Indian stocks (second portfolio)', 'me-us': 'US stocks' };
  const live = (r.stocks || []).filter((s) => s.status !== 'sold' && (s.category || '').toUpperCase() !== 'SGB');
  Object.keys(PORT).forEach((p) => {
    const rows = live.filter((s) => s.portfolio === p);
    if (!rows.length) return;
    const fx = p === 'me-us' ? (r.usdInr > 0 ? r.usdInr : null) : 1;
    const invested = rows.reduce((s, x) => s + pos(x.units) * pos(x.buyPrice), 0);
    const value = rows.reduce((s, x) => s + pos(x.units) * pos(x.currentPrice || x.buyPrice), 0);
    inv.push({ label: PORT[p], count: rows.length, invested: fx ? invested * fx : invested, value: fx ? value * fx : value, usd: !fx });
  });
  const funds = (r.funds || []).filter((f) => f.status !== 'Sold' && !f.emergencyFund);
  if (funds.length) {
    let invested = 0, value = 0;
    funds.forEach((f) => { try { const c = computeFund(f, Date.parse(today)); invested += pos(c.invested); value += pos(c.value); } catch (_) { /* a fund that cannot be computed is left out */ } });
    const types = [...new Set(funds.map((f) => f.category || f.type).filter(Boolean))].slice(0, 5);
    inv.push({ label: 'Mutual funds', count: funds.length, invested, value, types });
  }
  const fds = (r.fds || []).filter((f) => !f.emergencyFund);
  const activeFds = fds.map((f) => { try { return computeFd(f, Date.parse(today)); } catch (_) { return null; } }).filter((c) => c && c.effectiveStatus === 'active');
  if (activeFds.length) inv.push({ label: 'Fixed deposits', count: activeFds.length, invested: activeFds.reduce((s, c) => s + c.principal, 0), value: activeFds.reduce((s, c) => s + c.currentValue, 0) });
  const metals = r.metals || [];
  if (metals.length) {
    ['gold', 'silver'].forEach((m) => {
      const rows = metals.filter((x) => x.metal === m);
      if (!rows.length) return;
      const sign = (x) => (String(x.type || '').toLowerCase() === 'sell' ? -1 : 1);
      const grams = rows.reduce((s, x) => s + sign(x) * pos(x.grams), 0);
      const paid = rows.reduce((s, x) => s + sign(x) * pos(x.amount), 0);
      if (grams > 0) inv.push({ label: m === 'gold' ? 'Gold' : 'Silver', grams: Math.round(grams * 100) / 100, invested: Math.max(0, paid), value: null });
    });
  }
  const bonds = (r.bonds || []).filter((b) => !(pos(b.soldAmount) > 0));
  if (bonds.length) inv.push({ label: 'Bonds', count: bonds.length, invested: bonds.reduce((s, b) => s + pos(b.investAmount), 0), value: null });
  if (inv.length) out.investments = inv;
  if (r.ef && (pos(r.ef.fundValue) > 0 || (r.ef.targets || []).length)) {
    out.emergency = { value: pos(r.ef.fundValue), lentOut: pos(r.ef.lentOut), targets: (r.ef.targets || []).map((t) => pos(t.amount)).filter((a) => a > 0) };
  }
  return out;
}

// Which items have something behind them, given the features switched on (`on(id)`) and the summary.
export function availableItems(summary, on) {
  const has = {
    income: !!summary.income, household: !!summary.household, personal: !!summary.personal,
    categories: !!(summary.household || summary.personal), trends: !!((summary.household && summary.household.last6.length > 1) || (summary.personal && summary.personal.last6.length > 1)),
    cards: !!summary.cards, savings: !!summary.savings, investments: !!summary.investments, emergency: !!summary.emergency,
    goals: !!(summary.plan || (summary.emergency && summary.emergency.targets.length)),
  };
  return DATA_ITEMS.filter((it) => it.needs.some(on) && has[it.id]).map((it) => it.id);
}

// ---------- the prompt text ----------
const spendLines = (title, s, withCats, withTrend) => {
  const lines = [title + ' (' + monLabel(s.ym) + ', month in progress): ' + R(s.spent) + ' spent so far'
    + (s.usual != null ? '; a usual month (median of recent months) is ' + R(s.usual) : '; not enough history for a usual figure') + '.'];
  if (withCats && s.cats.length) {
    lines.push('  By category this month' + (s.usual != null ? ' (usual month in brackets)' : '') + ':');
    s.cats.forEach((c) => lines.push('  - ' + c.name + ': ' + R(c.amount) + (c.usual != null ? ' (usual ' + R(c.usual) + ')' : '')));
  }
  if (withTrend && s.last6.length > 1) lines.push('  Monthly totals: ' + s.last6.map((m) => monLabel(m.ym) + ' ' + R(m.spent)).join(', ') + '.');
  return lines;
};

// `summary` from summarise(); `items` the ticked ids; `purpose` a PURPOSES id; `question` the user's own words.
export function buildPrompt({ summary, items, purpose, question }) {
  const pick = new Set(items || []);
  const p = PURPOSES.find((x) => x.id === purpose) || PURPOSES[PURPOSES.length - 1];
  const s = summary || {};
  const L = [];
  L.push('I use a personal finance app called MyNotes. Below is data I recorded myself in it (India, amounts in rupees). '
    + 'It is user-provided and may be incomplete.');
  L.push('');
  L.push('Please:');
  L.push('- Analyse only the information provided, and identify patterns and observations.');
  L.push('- Explain any assumptions you make, and do not assume information that is missing - ask me clarifying questions instead.');
  L.push('- Keep facts (what the data shows) separate from suggestions (what I might consider).');
  L.push('- I want general, educational guidance, not certainty or personalised financial advice.');
  L.push('- If you discuss investments, explain the risks and trade-offs involved.');
  L.push('');
  L.push('MY DATA');
  const sections = [];
  if (pick.has('income') && s.income) sections.push(['Monthly income', ['Take-home salary: ' + R(s.income.salary) + ' a month.']]);
  if (pick.has('household') && s.household) sections.push(['Household spending', spendLines('Household spending', s.household, pick.has('categories'), pick.has('trends'))]);
  if (pick.has('personal') && s.personal) sections.push(['Personal spending', spendLines('My own spending', s.personal, pick.has('categories'), pick.has('trends'))]);
  if (!pick.has('household') && !pick.has('personal') && (pick.has('categories') || pick.has('trends'))) {
    if (s.household) sections.push(['Household spending', spendLines('Household spending', s.household, pick.has('categories'), pick.has('trends'))]);
    if (s.personal) sections.push(['Personal spending', spendLines('My own spending', s.personal, pick.has('categories'), pick.has('trends'))]);
  }
  if (pick.has('cards') && s.cards) sections.push(['Credit cards', s.cards.map((c) => '- ' + c.label + ': limit ' + (c.limit ? R(c.limit) : 'not recorded')
    + (c.bills.length ? '; recent bills ' + c.bills.map((b) => monLabel(b.ym) + ' ' + R(b.billed)).join(', ') : '; no bills recorded') + '.')]);
  if (pick.has('savings') && s.savings) sections.push(['Savings', ['Bank balances: ' + R(s.savings.total) + ' across ' + s.savings.accounts + ' account' + (s.savings.accounts === 1 ? '' : 's') + '.',
    ...s.savings.byType.map((t) => '- ' + t.type + ': ' + R(t.amount))]]);
  if (pick.has('investments') && s.investments) sections.push(['Investments', s.investments.map((i) => '- ' + i.label + ': '
    + (i.grams != null ? i.grams + ' g, ' + R(i.invested) + ' paid (current value not included)'
      : (i.count ? i.count + ' holding' + (i.count === 1 ? '' : 's') + ', ' : '') + R(i.invested) + ' invested' + (i.value != null ? ', about ' + R(i.value) + ' now' : '')
        + (i.usd ? ' (in US dollars, no exchange rate recorded)' : '') + (i.types && i.types.length ? ' (types: ' + i.types.join(', ') + ')' : ''))
    + '.')]);
  if (pick.has('emergency') && s.emergency) sections.push(['Emergency fund', ['Current value: ' + R(s.emergency.value) + '.'
    + (s.emergency.lentOut ? ' Lent out from it: ' + R(s.emergency.lentOut) + '.' : '')
    + (s.emergency.targets.length ? ' Targets: ' + s.emergency.targets.map(R).join(', ') + '.' : '')]]);
  if (pick.has('goals') && s.plan) sections.push(['Yearly plan (' + s.plan.year + ', monthly amounts)', s.plan.lines.map((l) => '- ' + l.label + ': ' + R(l.amount))]);
  if (!sections.length) L.push('(No data selected.)');
  sections.forEach(([title, lines]) => { L.push(''); L.push(title.toUpperCase()); lines.forEach((x) => L.push(x)); });
  L.push('');
  L.push('MY QUESTION');
  const q = String(question || '').trim();
  L.push(q || p.ask || 'Please review the data above and tell me what stands out.');
  if (q && p.ask) { L.push(''); L.push('Context: ' + p.ask); }
  return L.join('\n');
}

export const PRIVACY_NOTE = 'MyNotes generated this prompt from your selected data. Check the contents and remove anything you don’t want '
  + 'to share before sending it to an AI service. Your prompt may contain financial information. Review it before sharing.';
