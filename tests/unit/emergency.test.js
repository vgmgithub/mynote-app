import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLoan, ladderTargets, computeEmergencyFund, lastTargetAchieved, addMonths } from '../../emergency.js';

const NOW = Date.parse('2026-09-19');
const loan = (amount, months, kind) => ({ amount, takenDate: '2026-01-10', closedDate: addMonths('2026-01-10', months), loanKind: kind, repayments: [] });
const interest = (a, m, k) => computeLoan(loan(a, m, k), NOW, 2).interest;

test('loan interest follows the written rulebook (2% x band, rounded up to 100)', () => {
  assert.equal(interest(20000, 6, 'self'), 800);
  assert.equal(interest(20000, 3, 'self'), 400);
  assert.equal(interest(15000, 3, 'self'), 300);
  assert.equal(interest(15000, 4, 'self'), 600);
  assert.equal(interest(12500, 3, 'self'), 300);   // 250 rounds UP to the next 100
  assert.equal(interest(20000, 12, 'self'), 1600); // 4x band
});

test('emergency (3 months) and gift (5 months) loans are free inside their grace window', () => {
  assert.equal(interest(10000, 2, 'emergency'), 0);
  assert.equal(interest(15000, 4, 'gift'), 0);
});

test('an absorbing target replaces the running total instead of stacking', () => {
  const r = ladderTargets([
    { amount: 10000, ladder: 'add', order: 1 },
    { amount: 20000, ladder: 'absorb', order: 2 },
    { amount: 5000, ladder: 'add', order: 3 },
  ], 22000);
  assert.deepEqual(r.map((t) => t.cumulative), [10000, 20000, 25000]);
  assert.deepEqual(r.map((t) => t.isMet), [true, true, false]);
});

const contributions = [1, 2, 3, 4].map((m) => ({ date: `2026-0${m}-05`, mine: 5000, spouse: 5000 }));
const targets = [
  { name: 'Starter', amount: 15000, ladder: 'add', order: 1 },
  { name: 'Joint', amount: 30000, ladder: 'absorb', order: 2 },
  { name: 'Big', amount: 100000, ladder: 'add', order: 3 },
];

test('last target achieved is dated by when the running total crossed it', () => {
  const c = computeEmergencyFund({ contributions, targets, loans: [] }, NOW);
  const r = lastTargetAchieved(c, NOW);
  assert.equal(r.target.name, 'Joint');
  assert.equal(r.date, '2026-03-05');
  assert.equal(r.days, 198);
});

test('nothing achieved gives null', () => {
  const c = computeEmergencyFund({ contributions: [{ date: '2026-01-05', mine: 100, spouse: 100 }], targets, loans: [] }, NOW);
  assert.equal(lastTargetAchieved(c, NOW), null);
});

test('interest from a closed loan can be what tips a target over', () => {
  const c = computeEmergencyFund({
    contributions: [{ date: '2026-05', mine: 5000, spouse: 4950 }],
    targets: [{ name: 'T', amount: 10000, ladder: 'add', order: 1 }],
    loans: [{ amount: 1000, takenDate: '2026-05-10', closedDate: '2026-08-10', loanKind: 'self', repayments: [] }],
  }, NOW);
  const r = lastTargetAchieved(c, NOW);
  assert.equal(r.date, '2026-08-10');
  assert.equal(r.days, 40);
});

test('the fund charges its default 2% rate when a loan carries none', () => {
  const c = computeEmergencyFund({ contributions: [], targets: [], loans: [{ amount: 20000, takenDate: '2026-01-10', closedDate: addMonths('2026-01-10', 6), loanKind: 'self', repayments: [] }] }, NOW);
  assert.equal(c.loanInterestRealised, 800);
});
