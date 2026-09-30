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
  for (const not of ['Take-home salary', 'Card 1', 'Bank balances', 'Gold:', 'EMERGENCY FUND', 'ALLOCATION PLAN', 'EXISTING LOANS', 'My own spending', 'Allocation plan:']) {
    assert.equal(onlySpend.includes(not), false, 'unticked but included: ' + not);
  }
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
  assert.match(src, /v === 'house' \? h : v === 'personal' \? p : \(v === 'both' \|\| v === 'tags'\) \? h && p : true/);
  assert.match(src, /await renderReview\(host, \+\+ui\._expRenderToken\)/, 'the household Review, unchanged');
  assert.match(src, /await renderPfReview\(host, \+\+ui\._pfRenderToken\)/, 'the personal Review, unchanged');
  assert.match(src, /renderTagAnalysis\(tagHost, token, \{ rerender: renderAnalysis, stale: anStale \}\)/, 'tags across both live on');
  assert.match(src, /'Copy Prompt'/); assert.match(src, /'Regenerate'/); assert.match(src, /'Clear'/);
  assert.match(src, /Review before sharing/);
  const app = read('app.js');
  assert.match(app, /analysis: \['analysis'\]/, 'the screen belongs to the Analysis feature');
  assert.match(app, /import\('\.\/analysis-ui\.js'\)/, 'loaded only when opened');
});

// ---------- the cross-check fixes: figures the AI can rely on ----------
// Day 12 of a 30-day month, with everything the figures below are worked out from, and more secrets.
const DAY12 = '2026-09-12';
const rich = (over) => Object.assign({
  today: DAY12,
  spends: [
    { ym: '2026-04', category: 'Grocery', amount: 9000 }, { ym: '2026-05', category: 'Grocery', amount: 9500 },
    { ym: '2026-06', category: 'Grocery', amount: 8800 }, { ym: '2026-07', category: 'Grocery', amount: 9100 },
    { ym: '2026-07', category: 'Dining', amount: 3000 }, { ym: '2026-08', category: 'Grocery', amount: 9800 },
    { ym: '2026-08', category: 'Grocery', amount: -1500 }, { ym: '2026-08', category: 'Refund', amount: -700 },
    { ym: '2026-09', category: 'Grocery', amount: 6000 }, { ym: '2026-09', category: 'Dining', amount: 4200 },
  ],
  personalSpends: [
    { ym: '2026-08', date: '2026-08-05', category: 'Shopping', amount: 5200, method: 'UPI' },
    // Swiped on the 25th of August on a card whose statement closes in September: the Personal tab counts it there.
    { ym: '2026-08', date: '2026-08-25', category: 'Shopping', amount: 1111, method: 'Card', cardId: 1 },
    { ym: '2026-09', date: '2026-09-05', category: 'Shopping', amount: 7500, method: 'UPI' },
  ],
  personalMonthOf: (r) => (r.date === '2026-08-25' ? '2026-09' : r.ym),
  allocations: [{ year: 2026, salary: 150000, houseExp: 30000, card: 15000, mf: 20000, savings: 10000, emergency: 5000, sharedOn: true, sharedAmount: 5000 }],
  creditCards: [{ id: 1, name: 'SECRETCARD', creditLimit: 300000, months: [{ ym: '2026-06', billed: 38000, status: 'ontime' },
    { ym: '2026-07', billed: 41000, status: 'late' }, { ym: '2026-08', billed: 52000, status: 'ontime' }] }],
  bankSavings: [{ bank: 'SECRETBANK', label: 'Savings', balance: 250000 }, { label: 'Joint with SECRETPERSON', balance: 40000 }],
  stocks: [
    { portfolio: 'me-in', name: 'SECRETSTOCK', units: 10, buyPrice: 2000, currentPrice: 2500, status: 'holding' },
    { portfolio: 'me-in', name: 'SGB 2029', category: 'BONDS', units: 5, buyPrice: 6000, currentPrice: 7300, status: 'holding' },
    { portfolio: 'me-us', name: 'Y', units: 5, buyPrice: 100, currentPrice: 120, status: 'holding' },
    { portfolio: 'cp4-in', name: 'Z', units: 4, buyPrice: 1000, currentPrice: 1250, status: 'holding' },
    { portfolio: 'cp5-in', name: 'NOTINTOTAL', units: 1, buyPrice: 777777, currentPrice: 777777, status: 'holding' },
  ],
  portfolios: [{ id: 'me-in', cur: 'INR' }, { id: 'me-us', cur: 'USD' }, { id: 'cp4-in', cur: 'INR' }],
  funds: [
    { owner: 'me', name: 'SECRETFUND', category: 'Equity', type: 'Flexi Cap', status: 'Investing', sip: 3000,
      contributions: [{ date: '2025-01-10', amount: 99000, units: 3300, type: 'buy' }], latestNav: 34 },
    { owner: 'me', name: 'EF fund', category: 'Debt', status: 'Investing', sip: 9000, emergencyFund: true,
      contributions: [{ date: '2025-01-10', amount: 55555, units: 100, type: 'buy' }], latestNav: 600 },
  ],
  fds: [
    { id: 1, owner: 'me', bank: 'SECRETFDBANK', principal: 100000, rate: 7.25, startDate: '2025-10-20', maturityDate: '2026-10-20', compounding: 'quarterly', payout: 'cumulative' },
    { id: 2, owner: 'me', principal: 200000, rate: 7.0, startDate: '2026-01-10', maturityDate: '2028-01-10', compounding: 'quarterly', payout: 'cumulative' },
  ],
  metals: [
    { metal: 'gold', grams: 10, amount: 60000, type: 'buy', date: '2025-01-01' },
    { metal: 'gold', grams: 0.5, amount: 3500, type: 'interest', date: '2025-06-01' },
    { metal: 'gold', grams: -2, amount: 16000, type: 'sell', date: '2025-08-01' },
  ],
  bonds: [], rates: { gold: 7200, silver: 95, asOf: '2026-09-10T08:00:00Z' }, usdInr: 0,
  ef: { fundValue: 180000, lentOut: 20000, cashInHand: 60000, parkedValue: 100000, corpusIn: 175000, overdueCount: 1,
    targets: [{ name: 'SECRETGOAL', cumulative: 100000, isMet: true, pct: 100, remaining: 0 }, { cumulative: 300000, isMet: false, pct: 58.3, remaining: 125000 }] },
  review: {
    house: { budget: 30000, estimate: 21000, lo: 18000, hi: 24000, grade: 'fair', usualByNow: 8100,
      flagged: [{ name: 'Dining', over: 3200, count: 5, usualCount: 2, nowAvg: 840, usualAvg: 600, driver: 'more often', note: 'FLAGSECRET' }] },
    personal: { budget: 15000, estimate: 12000, grade: 'rough' },
  },
  loans: { count: 2, owed: 450000, label: 'LOANSECRET', items: [{ label: 'LOANSECRET' }] },
}, over || {});
const ALL = DATA_ITEMS.map((i) => i.id);
const lineOf = (text, start) => text.split('\n').find((l) => l.startsWith(start)) || '';

test('spending is spends only, counted in the month the app counts it, and the month in progress is marked as such', () => {
  const p = buildPrompt({ summary: summarise(rich()), items: ALL, purpose: 'health' });
  assert.match(p, /Aug 2026 ₹9,800/, 'a refund (negative or in the Refund category) never reduces a month');
  assert.equal(p.includes('8,300') || p.includes('7,600'), false);
  assert.match(p, /Household spending, Sep 2026 so far \(day 12 of 30\): ₹10,200 spent\. A usual full month is ₹9,500 \(the median of the last 5 months with spending\)\./);
  assert.match(p, /Monthly totals: Apr 2026 ₹9,000, May 2026 ₹9,500, Jun 2026 ₹8,800, Jul 2026 ₹12,100, Aug 2026 ₹9,800; Sep 2026 so far ₹10,200\./);
  assert.match(p, /September is not over \(day 12 of 30\): judge this month on its pace/);
  assert.match(p, /- Dining: ₹4,200 \(usually none\)/, 'a median of none is said as none, not as ₹0');
  // The card spend from 25 Aug is on September's statement, so it is September's personal spending, as on the Personal tab.
  assert.match(p, /My own spending, Sep 2026 so far \(day 12 of 30\): ₹8,611 spent\./);
  assert.match(p, /Flagged by MyNotes as above their usual this month[^\n]*\n {2}- Dining: ₹3,200 above usual, more often \(5 times this month against a usual 2\)/);
});

test('investments: dollars stay dollars, metals cost what was paid, SGBs are gold, and only what the app counts is in', () => {
  const p = buildPrompt({ summary: summarise(rich()), items: ['investments'], purpose: 'investments' });
  const us = lineOf(p, '- US stocks:');
  assert.match(us, /1 holding, \$500 invested, about \$600 now \(\+20%\), in US dollars \(no exchange rate saved\)/);
  assert.equal(us.includes('₹'), false, 'no rupee sign on a dollar amount');
  const conv = buildPrompt({ summary: summarise(rich({ usdInr: 83 })), items: ['investments'], purpose: 'investments' });
  assert.match(conv, /- US stocks: 1 holding, ₹41,500 invested, about ₹49,800 now \(\+20%\), converted at ₹83 per US dollar\./);
  // 10 g bought for ₹60,000, 0.5 g of free interest, 2 g sold: the sale takes out the cost of 2 of the 10.5 g, and
  // the interest grams were never paid for.
  assert.match(p, /- Gold: 8\.5 g, ₹48,571 paid, about ₹61,200 now at MyNotes’ saved rate of ₹7,200\/g \(as of 10 Sep 2026\)\./);
  assert.match(p, /- Indian stocks: 1 holding, ₹20,000 invested, about ₹25,000 now \(\+25%\)\./, 'the SGB is not a stock');
  assert.match(p, /- Sovereign Gold Bonds: 1 holding, ₹30,000 invested, about ₹36,500 now \(\+21\.7%\)\./);
  assert.match(p, /- Indian stocks \(profile 2\): 1 holding, ₹4,000 invested, about ₹5,000 now \(\+25%\)\./, 'a profile counted in total, by number');
  assert.equal(p.includes('7,77,777'), false, 'a profile switched off in "In total" is not counted');
  assert.match(p, /- Mutual funds: 1 fund, ₹99,000 invested, about ₹1,12,200 now \(\+13\.3%\); by category: Equity ₹1,12,200; kinds: Flexi Cap; SIPs ₹3,000 a month\./);
  assert.equal(p.includes('55,555') || p.includes('9,000 a month'), false, 'money linked to the Emergency Fund is listed there, not here');
  assert.match(p, /- Fixed deposits: 2 deposits, ₹3,00,000 principal, about ₹3,16,220 now, average rate 7\.08%; ₹1,07,444 comes back from 1 deposit maturing in the next 90 days \(on 20 Oct 2026\)\./);
  const noRate = buildPrompt({ summary: summarise(rich({ rates: {} })), items: ['investments'], purpose: 'investments' });
  assert.match(noRate, /- Gold: 8\.5 g, ₹48,571 paid \(current value not included: no saved gold rate\)\./);
});

test('key figures: worked out by the app, only from the ticked sections, each with its basis', () => {
  const s = summarise(rich());
  const all = buildPrompt({ summary: s, items: ALL, purpose: 'health' });
  for (const line of [
    '- Allocation plan: ₹80,000 of the ₹1,50,000 monthly take-home is assigned (53%); ₹70,000 is not assigned to any line.',
    '- Household this month: ₹10,200 spent of the ₹30,000 budget (34%), ₹19,800 left; 19 days left, today included; a usual month has ₹8,100 spent by this day; MyNotes estimates about ₹21,000 by month end (₹18,000 to ₹24,000), a fair estimate.',
    '- Personal this month: ₹8,611 spent of the ₹15,000 allowance (57%), ₹6,389 left; 19 days left, today included; MyNotes estimates about ₹12,000 by month end, a rough estimate.',
    '- Card 1: the Aug 2026 bill of ₹52,000 is 17% of the limit; of the last 3 bills, 2 paid on time and 1 paid late.',
    '- Existing loans: 2 loans, ₹4,50,000 still owed (3 times the monthly take-home).',
    '- Next emergency-fund target: ₹3,00,000, 58% there, ₹1,25,000 to go.',
  ]) assert.ok(all.includes(line), 'missing: ' + line);
  assert.match(all, /- Emergency fund: ₹1,80,000, of which ₹20,000 is lent out, so ₹1,60,000 is available; that covers about [\d.]+ months of my usual recorded spending/);
  assert.match(all, /Targets: ₹1,00,000 \(reached\), ₹3,00,000 \(58% there, ₹1,25,000 to go\)\./, 'the fund\'s own cumulative ladder');
  assert.match(all, /Others put ₹5,000 a month into the household budget\./);
  const houseOnly = buildPrompt({ summary: s, items: ['household'], purpose: 'spending' });
  assert.match(houseOnly, /KEY FIGURES[\s\S]*- Household this month: ₹10,200 spent of the ₹30,000 budget/);
  for (const not of ['% of the limit', 'Allocation plan:', 'Emergency fund:', 'Existing loans:', 'Recorded spending in a usual month', 'Investments:', 'Personal this month']) {
    assert.equal(houseOnly.includes(not), false, 'a figure from an unticked section: ' + not);
  }
});

test('the answer format: what was left out is named, and the answer ends in what to do and what not to do', () => {
  const s = summarise(rich());
  const houseOnly = buildPrompt({ summary: s, items: ['household'], purpose: 'spending' });
  assert.match(houseOnly, /NOT IN THIS PROMPT\nLeft out: Monthly income, Personal spending, Spending categories, [^\n]*Emergency fund, Allocation plan and goals\. Don’t treat anything left out as zero - ask me if it matters\./);
  const all = buildPrompt({ summary: s, items: ALL, purpose: 'health' });
  assert.equal(all.includes('Left out:'), false, 'nothing is left out when everything is ticked');
  assert.match(all, /MyNotes does not record insurance, tax details, or the interest rate and EMI of each loan\./);
  const q = all.indexOf('MY QUESTION'), a = all.indexOf('HOW TO ANSWER');
  assert.ok(q > 0 && a > q, 'the answer format comes last, after the question');
  assert.match(all.slice(a), /5\. What to do - up to 5 concrete steps, each with an amount or a limit and when to do it\.\n6\. What not to do - up to 5 specific things to avoid, each tied to something in my data\./);
  assert.match(all, /tie every point to my numbers, not generic tips/);
  assert.match(all, /not named stocks, funds or cards, and don’t promise returns/);
  assert.match(all, /the first three things I should work on, with the numbers behind each/);
  const health = PURPOSES.find((x) => x.id === 'health');
  for (const id of ['cards', 'loans', 'goals']) assert.ok(health.items.includes(id), 'the health review starts with ' + id + ' ticked');
});

test('never in a prompt: loan labels, profile and stock names, bank names or legacy account labels, extra fields handed in', () => {
  const all = buildPrompt({ summary: summarise(rich()), items: ALL, purpose: 'health' });
  for (const secret of ['LOANSECRET', 'SECRETPERSON', 'SECRETBANK', 'SECRETCARD', 'SECRETSTOCK', 'SECRETFUND', 'SECRETFDBANK', 'SECRETGOAL', 'FLAGSECRET', 'NOTINTOTAL', 'SGB 2029']) {
    assert.equal(all.includes(secret), false, 'leaked: ' + secret);
  }
  assert.match(all, /- Other: ₹40,000/, 'an account type typed before the dropdown existed is "Other"');
  // The loan figures the screen hands in are two numbers, never the list or its labels.
  assert.match(read('expense-ui.js'), /export function sheetLoanSummary\(sheet\) \{\r?\n[^\n]*\n\s*return \{ count: open\.length, owed: loansOwed\(open\) \};/);
});

test('the AI Prompt screen hands in the same figures the Household and Personal tabs show, and one SGB rule is shared', () => {
  const an = read('analysis-ui.js');
  assert.match(an, /const kitty = _kittyFor\(thisYm, allocs, efLoans\);/);
  assert.match(an, /_reviewForecast\(thisYm, byYm, now, dueTotal, kitty\)/, 'the household estimate, due bills included, as renderReview');
  assert.match(an, /_reviewForecast\(thisYm, ownByYmCal, now, 0, limit\)/, 'the personal estimate on calendar days, as renderPfReview');
  assert.match(an, /personalSpends: pf \? pf\.rows : \[\], personalMonthOf: pf \? pf\.countedYm : null,/);
  assert.match(an, /\(profiles \|\| \[\]\)\.map\(\(p\) => \(\{ id: p\.id, cur: p\.cur \}\)\)/, 'profiles by id only, never by name');
  assert.match(an, /includedStockProfiles\(\)/);
  assert.match(read('core.js'), /export const isSgb = /);
  assert.match(read('app.js'), /export \{ isSgb \};/);
  assert.match(read('ai-prompt.js'), /import \{ isSgb, BANK_SAV_TYPES \} from '\.\/core\.js';/);
  assert.match(read('banksav.js'), /import \{ fmtCur, todayISO, num, BANK_SAV_TYPES \} from '\.\/core\.js';/);
});
