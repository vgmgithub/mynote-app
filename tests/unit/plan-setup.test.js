import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emergencyFloor, balance, remainderForSavings, problemWith, startValues, diffAgainst, toRecord, needsSetup, OUT_KEYS } from '../../plan-setup.js';

test('emergency floor is 5% of salary, never negative', () => {
  assert.equal(emergencyFloor(100000), 5000);
  assert.equal(emergencyFloor(0), 0);
  assert.equal(emergencyFloor(-5), 0);
  assert.equal(emergencyFloor(33333), 1666.65);
});

test('balance is salary less every outgoing line; savings takes the remainder', () => {
  const v = { salary: 100000, loan: 10000, emergency: 5000, home: 8000, houseExp: 20000, mf: 10000, card: 12000 };
  assert.equal(balance(v), 35000);
  assert.equal(remainderForSavings(v), 35000);
  assert.equal(balance({ ...v, savings: 35000 }), 0);
  assert.equal(balance({ ...v, savings: 40000 }), -5000, 'overspending shows as negative');
  assert.equal(remainderForSavings({ ...v, card: 200000 }), 0, 'remainder never goes below zero');
});

test('the two mandatory lines are salary and an emergency fund of at least 5%', () => {
  assert.match(problemWith({ salary: 0, emergency: 0 }), /salary/i);
  assert.match(problemWith({ salary: 100000, emergency: 4999 }), /5%/);
  assert.equal(problemWith({ salary: 100000, emergency: 5000 }), null);
  assert.equal(problemWith({ salary: 100000, emergency: 9000 }), null);
});

test('start values come from an existing plan and ignore junk', () => {
  const v = startValues({ salary: 90000, emergency: 4500, home: 'x', sharedOn: true, sharedAmount: 7000, id: 3 });
  assert.equal(v.salary, 90000); assert.equal(v.emergency, 4500); assert.equal(v.home, 0);
  assert.equal(v.sharedOn, true); assert.equal(v.sharedAmount, 7000);
  assert.equal(startValues(null).salary, 0);
});

test('diff lists only the lines that changed, old against new', () => {
  const existing = { salary: 100000, emergency: 5000, houseExp: 20000, mf: 5000 };
  assert.deepEqual(diffAgainst(existing, { ...existing }), [], 'identical: nothing to confirm');
  const d = diffAgainst(existing, { ...existing, mf: 8000, loan: 12000 });
  assert.deepEqual(d.map((r) => [r.key, r.old, r.now]), [['loan', 0, 12000], ['mf', 5000, 8000]]);
  assert.equal(diffAgainst(null, { salary: 1 }).length, 1, 'no stored plan: everything entered is new');
  const s = diffAgainst({ salary: 1, sharedOn: true, sharedAmount: 5 }, { salary: 1, sharedOn: false, sharedAmount: 5 });
  assert.deepEqual(s.map((r) => [r.key, r.old, r.now]), [['sharedAmount', 5, 0]]);
});

test('saving keeps the stored id, createdAt and fields this flow does not own', () => {
  const existing = { id: 7, year: 2026, createdAt: '2026-01-01T00:00:00Z', salary: 1, someFutureField: 'keep' };
  const rec = toRecord(2026, { salary: 100000, emergency: 5000, sharedOn: false, sharedAmount: 9000 }, existing, '2026-09-20T00:00:00Z');
  assert.equal(rec.id, 7); assert.equal(rec.createdAt, '2026-01-01T00:00:00Z'); assert.equal(rec.someFutureField, 'keep');
  assert.equal(rec.salary, 100000); assert.equal(rec.emergency, 5000);
  assert.equal(rec.sharedAmount, 0, 'a switched-off share is stored as 0');
  assert.equal(rec.updatedAt, '2026-09-20T00:00:00Z');
  OUT_KEYS.forEach((k) => assert.equal(typeof rec[k], 'number'));
  assert.equal(toRecord(2027, { salary: 1 }, null, 'T').createdAt, 'T');
});

test('the flow is needed until done, and again in a new year with no plan', () => {
  assert.equal(needsSetup(null, null, 2026), true);
  assert.equal(needsSetup({ year: 2026 }, null, 2026), false);
  assert.equal(needsSetup({ year: 2025 }, null, 2026), true);
  assert.equal(needsSetup({ year: 2025 }, { salary: 50000 }, 2026), false, 'a plan already exists for this year');
});
