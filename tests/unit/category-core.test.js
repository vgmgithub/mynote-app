import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { categoryMonths, categoryView } from '../../category-core.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const row = (ym, category, amount) => ({ ym, date: ym + '-10', category, amount });
const byYm = (r) => r.ym;

test('months hold category totals; refunds are kept apart, a refund inside a category nets it off', () => {
  const m = categoryMonths([row('2026-07', 'Grocery', 3000), row('2026-07', 'Grocery', 500), row('2026-07', 'Dining', 800),
    row('2026-07', 'Refund', -300), row('2026-07', 'Dining', -100), row('bad', 'Grocery', 5), row('2026-07', 'Rent', 0)], byYm, 'Refund');
  const jul = m.get('2026-07');
  assert.equal(jul.byCat.get('Grocery'), 3500);
  assert.equal(jul.byCat.get('Dining'), 700, 'a negative amount in its own category nets off');
  assert.equal(jul.back, 300, 'the Refund category is money back, not a category');
  assert.equal(jul.byCat.has('Refund'), false);
  assert.equal(jul.spent, 4200);
  assert.equal(m.size, 1, 'a row with no usable month is left out');
});

test('one month against the ones before: share, last month, a median "usual", movers both ways', () => {
  const rows = [];
  // Grocery: 3000, 3200, 9000 (one heavy month), then 3100 now. Dining stopped this month.
  [['2026-04', 3000], ['2026-05', 3200], ['2026-06', 9000], ['2026-07', 3100]].forEach(([ym, a]) => rows.push(row(ym, 'Grocery', a)));
  [['2026-04', 800], ['2026-05', 900], ['2026-06', 700]].forEach(([ym, a]) => rows.push(row(ym, 'Dining', a)));
  rows.push(row('2026-07', 'Medicine', 1900));
  const groupOf = (n) => ({ Grocery: 'Food', Dining: 'Food', Medicine: 'Health' })[n];
  const v = categoryView(categoryMonths(rows, byYm), '2026-07', { groupOf });
  assert.equal(v.spent, 5000);
  assert.equal(v.prevYm, '2026-06');
  assert.equal(v.historyMonths, 3);
  const g = v.cats.find((c) => c.name === 'Grocery');
  assert.equal(g.usual, 3200, 'median, so the 9,000 month does not set "usual"');
  assert.equal(g.vsUsual, -100);
  assert.equal(Math.round(g.share), 62);
  assert.equal(g.history.length, 4, 'three earlier months plus this one');
  const d = v.cats.find((c) => c.name === 'Dining');
  assert.equal(d.amount, 0, 'a habit that stopped still shows, at 0');
  assert.equal(d.usual, 800);
  assert.deepEqual(v.up.map((c) => c.name), ['Medicine']);
  assert.ok(v.down.some((c) => c.name === 'Dining'));
  assert.deepEqual(v.groups.map((x) => x.group), ['Food', 'Health']);
});

test('with too little history there is no "usual" to claim, and the screen says what is missing', () => {
  const v = categoryView(categoryMonths([row('2026-07', 'Grocery', 1000)], byYm), '2026-07');
  assert.equal(v.historyMonths, 0);
  assert.equal(v.usualTotal, null);
  assert.equal(v.cats[0].usual, null);
  assert.match(read('category-spend.js'), /Add more spending history to see meaningful category trends/);
});

test('Expenses and Personal Finance tabs: Review gone, Category Spend and Tags in, Card Check back in Personal', () => {
  const pf = read('personal-ui.js');
  assert.match(pf, /EXP_TABS = \[\['spend', '🧾', 'Balance'\], \['tracker', '📍', 'Tracker'\], \['cat', '\\u\{1F4CA\}', 'Category Spend'\],\s+\['tags', [^\]]+'Tags'\], \['alloc', '🧭', 'Allocation'\]\]/);
  assert.match(pf, /PF_TABS = \[\['spends', [^\]]+'Spends'\], \['limits', [^\]]+'Limits'\], \['cat', [^\]]+'Category Spend'\],\s+\['cards', [^\]]+'Card Check'\], \['tags', [^\]]+'Tags'\]\]/);
  assert.equal(/\['review',/.test(pf), false, 'no Review tab on either nav');
  assert.match(pf, /renderTagAnalysis\(host, token, \{ source: 'personal' \}\)/, 'Personal Finance -> Tags is personal only');
  const exp = read('expense-ui.js');
  assert.match(exp, /renderTagAnalysis\(host, token, \{ source: 'house', rerender: renderHomeExpense, stale: expRenderStale \}\)/, 'Expenses -> Tags is household only');
  assert.match(exp, /kind: 'house', stale: expRenderStale, rerender: renderHomeExpense/);
  assert.match(pf, /kind: 'personal', stale: pfRenderStale, rerender: renderPersonal/);
  // A saved tab that no longer exists (Review, or the old Credit Card tab) opens the everyday one.
  assert.match(exp, /if \(!EXP_TABS\.some\(\(\[v\]\) => v === ui\._expTab\)\) ui\._expTab = 'tracker';/);
  assert.match(pf, /if \(!PF_TABS\.some\(\(\[v\]\) => v === ui\._pfTab\)\) \{ ui\._pfTab = 'spends';/);
  // Card Check in Personal Finance follows the Credit Cards rule: it needs Expenses too.
  assert.match(pf, /const pfCardCheckOpen = \(\) => modOn\(_modsCache, 'expense'\) && modOn\(_modsCache, 'personal'\);/);
});

test('the tags split is a view change only: one source option, no tag data moved or copied', () => {
  const exp = read('expense-ui.js');
  assert.match(exp, /const _hasHouse = modOn\(_modsCache, 'expense'\) && o\.source !== 'personal';/);
  assert.match(exp, /const _hasPersonal = modOn\(_modsCache, 'personal'\) && o\.source !== 'house';/);
  const db = read('db.js');
  assert.equal(/createObjectStore\('tags'/.test(db), false, 'there is still no tag store: tags stay on the spend rows');
  for (const f of ['category-spend.js', 'category-core.js']) {
    assert.equal(/DB\.(put|del|clear)\(/.test(read(f)), false, f + ' only reads');
  }
});
