import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, BACKUP_STEP, pickSteps, isFixedCategory, stepProgress, shouldCelebrate } from '../../get-started.js';

const ALL = new Set(['stocks', 'mf', 'fd', 'metal', 'bond', 'ef', 'banksav', 'expense', 'cc', 'personal', 'health', 'vault']);
const base = (o) => Object.assign({ on: (m) => ALL.has(m), paid: false, done: new Set(), skipped: new Set(), backedUp: false }, o);
const ids = (o) => pickSteps(base(o)).map((s) => s.id);

test('the money order: plan (Free), emergency fund, loans, fixed bills, invest, health, cards, daily, personal, savings, passwords, backup', () => {
  assert.deepEqual(ids({}), ['plan', 'ef', 'loans', 'fixed', 'invest', 'health', 'cc', 'daily', 'personal', 'banksav', 'vault', 'backup']);
});

test('the Pro Plan has the guided setup instead of the yearly plan step', () => {
  assert.equal(ids({ paid: true }).includes('plan'), false);
  assert.equal(ids({ paid: false }).includes('plan'), true);
});

test('cards come before the daily house and personal spends, so a spend can be put on a card', () => {
  const o = ids({});
  assert.ok(o.indexOf('cc') < o.indexOf('daily') && o.indexOf('cc') < o.indexOf('personal'));
});

test('a step appears only when its feature is on; investments need any one of the five', () => {
  assert.deepEqual(ids({ on: (m) => m === 'stocks' }), ['invest', 'backup']);
  assert.deepEqual(ids({ on: (m) => m === 'expense' }), ['plan', 'loans', 'fixed', 'daily', 'backup']);
  assert.deepEqual(ids({ on: () => false }), ['backup']);
});

test('done steps vanish; skipped ones vanish only when they may be skipped', () => {
  assert.equal(ids({ done: new Set(['ef']) }).includes('ef'), false);
  assert.equal(ids({ skipped: new Set(['loans', 'invest', 'health', 'vault']) }).some((i) => ['loans', 'invest', 'health', 'vault'].includes(i)), false);
  assert.equal(ids({ skipped: new Set(['ef', 'cc', 'personal']) }).includes('ef'), true, 'required steps cannot be skipped away');
  assert.equal(ids({ skipped: new Set(['backup']), backedUp: false }).includes('backup'), true, 'backup can never be skipped');
});

test('backup is always last and stays until a backup exists', () => {
  const o = pickSteps(base({}));
  assert.equal(o[o.length - 1].id, 'backup');
  assert.equal(ids({ backedUp: true }).includes('backup'), false);
});

test('every step has a title and a plain one-line hint', () => {
  [...STEPS, BACKUP_STEP].forEach((s) => {
    assert.ok(s.title && s.title.length > 3, s.id + ' title');
    assert.ok(s.hint && s.hint.length > 15 && s.hint.length < 130, s.id + ' hint');
  });
  assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length, 'ids are unique');
});

test('only optional steps can be skipped', () => {
  assert.deepEqual(STEPS.filter((s) => s.skippable).map((s) => s.id), ['loans', 'invest', 'health', 'vault']);
});

test('the fixed group is what marks a fixed bill', () => {
  assert.equal(isFixedCategory(['Rent', 'Electricity'], 'Rent'), true);
  assert.equal(isFixedCategory(['Rent'], 'Dining'), false);
  assert.equal(isFixedCategory(null, 'Rent'), false);
});

test('progress: "N of total completed" counts done and skipped steps, and the backup', () => {
  const p = stepProgress(base({ on: (m) => m === 'expense', done: new Set(['plan']), skipped: new Set(['loans']) }));
  assert.deepEqual(p.ids, ['plan', 'loans', 'fixed', 'daily', 'backup']);
  assert.equal(p.total, 5);
  assert.equal(p.completed, 2, 'the plan is done and the loans step was skipped');
  assert.deepEqual(p.todo.map((s) => s.id), ['fixed', 'daily', 'backup'], 'the cards are exactly pickSteps');
  assert.equal(p.place('daily'), 4, 'a card says Step 4 of 5, matching the line above');
  assert.equal(stepProgress(base({ paid: true, on: (m) => m === 'expense' })).total, 4, 'Pro has no yearly plan step');
  assert.equal(stepProgress(base({ on: () => false, backedUp: true })).completed, 1, 'only the backup, done');
});

test('a required step that was skipped still counts as to do', () => {
  const p = stepProgress(base({ on: (m) => m === 'ef', skipped: new Set(['ef']) }));
  assert.equal(p.completed, 0);
  assert.equal(p.total, 2);
});

test('"You\'re all set" shows once everything is done, until it is closed, and again for new steps', () => {
  const all = { on: (m) => m === 'cc', done: new Set(['cc']), backedUp: true };
  const p = stepProgress(base(all));
  assert.equal(p.todo.length, 0);
  assert.equal(shouldCelebrate(p, null), true, 'never closed');
  assert.equal(shouldCelebrate(p, ['cc', 'backup']), false, 'closed for these steps');
  const more = stepProgress(base({ on: (m) => m === 'cc' || m === 'vault', done: new Set(['cc', 'vault']), backedUp: true }));
  assert.equal(shouldCelebrate(more, ['cc', 'backup']), true, 'a feature switched on later and finished');
  assert.equal(shouldCelebrate(stepProgress(base({ on: (m) => m === 'cc' })), null), false, 'not while steps are left');
});
