import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarise, availableItems, buildPrompt, DATA_ITEMS, PURPOSES, PRIVACY_NOTE } from '../../ai-prompt.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const TODAY = '2026-09-24';
// Records with every kind of thing that must never reach a prompt.
const raw = () => ({
  today: TODAY,
  spends: [
    { ym: '2026-07', date: '2026-07-03', category: 'Grocery', amount: 4000, tags: ['secret-tag'], note: 'SECRETNOTE', method: 'Card', cardId: 1 },
    { ym: '2026-08', date: '2026-08-03', category: 'Grocery', amount: 4200 },
    { ym: '2026-09', date: '2026-09-03', category: 'Grocery', amount: 3900 },
    { ym: '2026-09', date: '2026-09-04', category: 'Dining', amount: 1200 },
  ],
  personalSpends: [
    { ym: '2026-09', date: '2026-09-05', category: 'Shopping', amount: 2500, tags: ['privatetag'] },
    { ym: '2026-09', date: '2026-09-06', category: 'Gifts', amount: 9999, forOthers: true },
  ],
  allocations: [{ year: 2026, salary: 150000, houseExp: 30000, card: 15000, mf: 20000, savings: 10000 }],
  creditCards: [{ id: 1, name: 'HDFC Regalia Gold', bank: 'HDFCBANK', creditLimit: 300000, months: [{ ym: '2026-08', billed: 22000, paidOn: '2026-08-20' }] }],
  bankSavings: [{ bank: 'State Bank of Somewhere', label: 'Savings', balance: 250000, notes: 'ACCOUNTNOTE' }],
  stocks: [{ portfolio: 'wife-in', name: 'RELIANCEX', units: 10, buyPrice: 2000, currentPrice: 2500, status: 'holding' }],
  funds: [], fds: [], metals: [{ metal: 'gold', grams: 10, amount: 60000, type: 'buy', note: 'GOLDNOTE' }], bonds: [],
  ef: { fundValue: 180000, lentOut: 20000, targets: [{ name: 'Wedding of Anita', amount: 300000 }], loans: [{ who: 'Ravi', purpose: 'MEDICALSECRET' }] },
  usdInr: 0,
  // Things that live in meta and must never be read at all.
  meta: { userName: 'Gopal', alias: 'Meharika', installId: 'abcd1234', payments: [{ paymentId: 'pay_ZZZ999' }] },
});

test('only what exists is offered: sections with data, from features that are on', () => {
  const s = summarise(raw());
  const on = (id) => ['expense', 'personal', 'cc', 'banksav', 'stocks', 'metal', 'ef'].includes(id);
  const items = availableItems(s, on);
  for (const id of ['income', 'household', 'personal', 'categories', 'trends', 'cards', 'savings', 'investments', 'emergency', 'goals']) assert.ok(items.includes(id), id);
  const pOnly = availableItems(s, (id) => id === 'personal');
  assert.ok(pOnly.includes('personal') && pOnly.includes('categories'), 'Personal Spending alone offers its own data');
  for (const id of ['household', 'income', 'cards', 'savings', 'investments', 'emergency']) assert.equal(pOnly.includes(id), false, id + ' needs a feature that is off');
  const empty = summarise({ today: TODAY });
  assert.deepEqual(availableItems(empty, () => true), [], 'no data, nothing to include - nothing is invented');
});

test('the prompt holds exactly the ticked sections and nothing sensitive, whatever is ticked', () => {
  const s = summarise(raw());
  const all = buildPrompt({ summary: s, items: DATA_ITEMS.map((i) => i.id), purpose: 'health' });
  for (const secret of ['SECRETNOTE', 'secret-tag', 'privatetag', 'HDFC', 'Regalia', 'State Bank', 'ACCOUNTNOTE', 'RELIANCEX', 'GOLDNOTE',
    'Anita', 'Ravi', 'MEDICALSECRET', 'Gopal', 'Meharika', 'abcd1234', 'pay_ZZZ999', 'wife', 'Wife']) {
    assert.equal(all.includes(secret), false, 'leaked: ' + secret);
  }
  assert.match(all, /Take-home salary: ₹1,50,000 a month/);
  assert.match(all, /Card 1: limit ₹3,00,000; recent bills Aug 2026 ₹22,000/);
  assert.match(all, /Gold: 10 g, ₹60,000 paid/);
  assert.equal(all.includes('9,999'), false, 'a spend made for somebody else is not counted as own spending');
  const onlySpend = buildPrompt({ summary: s, items: ['household'], purpose: 'spending' });
  assert.match(onlySpend, /HOUSEHOLD SPENDING/);
  for (const not of ['Take-home salary', 'Card 1', 'Bank balances', 'Gold:', 'EMERGENCY FUND', 'YEARLY PLAN']) assert.equal(onlySpend.includes(not), false, 'unticked but included: ' + not);
});

test('the prompt tells the AI how to treat the data, and ends with the question', () => {
  const p = buildPrompt({ summary: summarise(raw()), items: ['household'], purpose: 'reduce', question: 'Can I save for a bike?' });
  assert.match(p, /user-provided/);
  assert.match(p, /Analyse only the information provided, and identify patterns and observations/);
  assert.match(p, /Explain any assumptions/);
  assert.match(p, /do not assume information that is missing - ask me clarifying questions/);
  assert.match(p, /Keep facts .* separate from suggestions/);
  assert.match(p, /general, educational guidance, not certainty/);
  assert.match(p, /explain the risks and trade-offs/);
  assert.match(p, /MY QUESTION\nCan I save for a bike\?/);
  assert.match(p, /Context: Where could I reasonably reduce/);
  assert.equal(PURPOSES.length, 8);
  assert.match(PRIVACY_NOTE, /Review it before sharing/);
  assert.match(PRIVACY_NOTE, /remove anything you don.t want to share/);
});

test('nothing leaves the phone: the builder and the Analysis screen make no network call', () => {
  for (const f of ['ai-prompt.js', 'analysis-ui.js', 'category-core.js', 'category-spend.js', 'calc-core.js', 'calc-ui.js']) {
    const src = read(f);
    assert.equal(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|sendUsage|SERVER_URL/.test(src), false, f + ' must not reach the network');
  }
  // It reads the stores; it never writes one.
  assert.equal(/DB\.(put|del|clear)\(/.test(read('analysis-ui.js')), false);
  // The live metal-rate fetch (which Home's investment summary can trigger) is not used for prompts.
  assert.equal(/metalPortfolio|homeInvestedBreakdown|_fetchLiveRates/.test(read('analysis-ui.js') + read('ai-prompt.js')), false);
});

test('Analysis: tabs follow the features chosen, the Reviews are the same ones that moved, and it has no data of its own', () => {
  const src = read('analysis-ui.js');
  assert.match(src, /v === 'house' \? h : v === 'personal' \? p : v === 'both' \? h && p : true/);
  assert.match(src, /await renderReview\(host, \+\+ui\._expRenderToken\)/, 'the household Review, unchanged');
  assert.match(src, /await renderPfReview\(host, \+\+ui\._pfRenderToken\)/, 'the personal Review, unchanged');
  assert.match(src, /renderTagAnalysis\(tagHost, token, \{ rerender: renderAnalysis, stale: anStale \}\)/, 'tags across both live on');
  assert.match(src, /'Copy Prompt'/); assert.match(src, /'Regenerate'/); assert.match(src, /'Clear'/);
  assert.match(src, /Review before sharing/);
  const app = read('app.js');
  assert.match(app, /analysis: \['analysis'\]/, 'the screen belongs to the Analysis feature');
  assert.match(app, /import\('\.\/analysis-ui\.js'\)/, 'loaded only when opened');
});
