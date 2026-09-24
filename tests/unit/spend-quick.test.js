import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayShift, recentCategories, usualAmounts, lastChoice, leftAfter } from '../../spend-quick.js';

const T = '2026-09-24';
const row = (date, category, amount, extra) => Object.assign({ date, category, amount, method: 'UPI', createdAt: date + 'T10:00:00Z' }, extra);

test('Yesterday is the calendar day before, across month and year ends', () => {
  assert.equal(dayShift('2026-09-24', -1), '2026-09-23');
  assert.equal(dayShift('2026-10-01', -1), '2026-09-30');
  assert.equal(dayShift('2026-01-01', -1), '2025-12-31');
  assert.equal(dayShift('2024-03-01', -1), '2024-02-29');
  assert.equal(dayShift('junk', -1), 'junk');
});

test('recent categories: most used first, ties to the latest, only live ones, never Refund or old rows', () => {
  const rows = [
    row('2026-09-20', 'Milk', 40), row('2026-09-21', 'Milk', 40), row('2026-09-22', 'Milk', 45),
    row('2026-09-10', 'Dining', 800), row('2026-09-23', 'Fruits', 120),
    row('2026-09-23', 'Refund', -200), row('2026-09-22', 'Refund', 50),
    row('2026-05-01', 'Cinema', 500), row('2026-05-02', 'Cinema', 500),
    row('2026-09-24', 'Gone', 10), row('2026-09-30', 'Rent', 9000),
  ];
  const got = recentCategories(rows, { valid: ['Milk', 'Dining', 'Fruits', 'Cinema', 'Refund', 'Rent'], exclude: ['Refund'], today: T });
  assert.deepEqual(got, ['Milk', 'Fruits', 'Dining'], 'Fruits beats Dining on the tie by being later; Cinema is too old, Rent is in the future, Gone is deleted');
  assert.equal(recentCategories(rows, { today: T, limit: 1 })[0], 'Milk');
  assert.deepEqual(recentCategories([], { today: T }), []);
  assert.deepEqual(recentCategories(null, { today: T }), []);
});

test('usual amounts: the most frequent figures for that category, smallest first', () => {
  const rows = [
    row('2026-09-20', 'Milk', 40), row('2026-09-21', 'Milk', 40), row('2026-09-22', 'Milk', 45),
    row('2026-09-23', 'Milk', 60), row('2026-09-24', 'Milk', 38.5), row('2026-09-24', 'Milk', 38.5),
    row('2026-09-24', 'Fruits', 120), row('2026-01-01', 'Milk', 999),
  ];
  assert.deepEqual(usualAmounts(rows, 'Milk', { today: T }), [38.5, 40, 60], '40 and 38.5 twice each, then 60 (the latest single)');
  assert.deepEqual(usualAmounts(rows, 'Fruits', { today: T }), [120]);
  assert.deepEqual(usualAmounts(rows, 'Nope', { today: T }), []);
  assert.deepEqual(usualAmounts(rows, null, { today: T }), []);
});

test('last choice: how the latest spend was paid, dropped when no longer offered, card only if it still exists', () => {
  const rows = [
    row('2026-09-20', 'Milk', 40, { method: 'UPI', createdAt: '2026-09-20T08:00:00Z' }),
    row('2026-09-22', 'Dining', 800, { method: 'Card', cardId: 7, createdAt: '2026-09-22T20:00:00Z' }),
    row('2026-09-23', 'Refund', -100, { method: 'Cash', createdAt: '2026-09-23T09:00:00Z' }),
  ];
  assert.deepEqual(lastChoice(rows, { methods: ['UPI', 'Card', 'Cash'], cardIds: [7, 8] }), { method: 'Card', cardId: 7 }, 'a refund is not a spend');
  assert.deepEqual(lastChoice(rows, { methods: ['UPI', 'Card'], cardIds: [8] }), { method: 'Card', cardId: null }, 'the card was deleted');
  assert.equal(lastChoice(rows, { methods: ['UPI'] }), null, 'Card is not offered here');
  assert.equal(lastChoice([], {}), null);
  assert.deepEqual(lastChoice([row('2026-09-24', 'Milk', 40, { method: 'UPI', cardId: 3 })], { methods: ['UPI', 'Card'] }), { method: 'UPI', cardId: null });
});

test('left after this: a spend takes, a refund gives back', () => {
  assert.equal(leftAfter(1000, 250), 750);
  assert.equal(leftAfter(100, 250), -150);
  assert.equal(leftAfter(100, 50, true), 150);
  assert.equal(leftAfter(100, -50), 50, 'typed as a positive figure either way');
  assert.equal(leftAfter(0.3, 0.1), 0.2);
});

// The forms: same records as before, every quick piece wired in, nothing lost on "+ category".
test('both spend forms use the quick pieces and keep what they did', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const kitty = read('expense-ui.js'), pf = read('personal-ui.js');
  const body = (src, head) => src.slice(src.indexOf(head)).split(/\r?\n\}\r?\n/)[0];
  const kf = body(kitty, 'async function openSpendForm('), pff = body(pf, 'export async function openPfSpendForm(');
  for (const [name, f] of [['kitty', kf], ['personal', pff]]) {
    assert.match(f, /quickCategories\(\{/, name + ': recent categories');
    assert.match(f, /bigAmount\(amount, \(\) => save\(\)\)/, name + ': big amount, Done saves');
    assert.match(f, /dateChips\(dateInp, today\)/, name + ': Today / Yesterday');
    assert.match(f, /lastChoice\(/, name + ': paid the way the last one was');
    assert.match(f, /text: 'Add & next'/, name + ': add one after another');
    assert.match(f, /carry: draft\(\), still: true/, name + ': "+ category" keeps what was typed');
    assert.match(f, /markMissing\(/, name + ': points at what is missing');
    assert.match(f, /if \(saving\) return;/, name + ': one save per tap');
  }
  assert.match(kf, /text: 'Save', onclick: \(\) => save\(\)/, 'the household button still reads Save');
  assert.match(pff, /text: editing \? 'Save' : 'Add spend'/);
  assert.match(kf, /ym, date: d, category: chosenCat, amount: amt,\s+method: chosenMethod, cardId, tags: tagBox\.get\(\),/, 'household record unchanged');
  assert.match(pff, /ym: d\.slice\(0, 7\), date: d, category: chosenCat, amount: amt,\s+method: chosenMethod, cardId: chosenMethod === 'Card' \? chosenCardId : null,\s+forOthers: refund \? false : chosenForOthers,/, 'personal record unchanged');
  assert.equal(/household household/.test(kitty), false, 'typo gone');
  assert.equal(/if \(!editing\) amount\.focus\(\);/.test(pff), false, 'no keyboard over the categories on open');
  const sw = read('service-worker.js');
  assert.match(sw, /'\.\/spend-quick\.js'/);
  assert.match(sw, /'\.\/spend-kit\.js'/);
});
