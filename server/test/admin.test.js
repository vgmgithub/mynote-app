import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveInstall } from '../lib/store.js';
import { parsePayload } from '../lib/validate.js';
import { parseList, shapeInstalls, parsePlanChange, setPlan, getPlan, planAnswer, LIST_SQL } from '../lib/installs.js';
import { requireAdmin, adminKeySet } from '../lib/admin.js';

const ID = '4dcd6fca-1234-4abc-9def-0123456789ab';
const good = () => ({ v: 1, installId: ID, features: ['stocks'], plan: 'free', appVersion: 606, platform: 'android' });

function fakeConn() {
  const log = [];
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => { log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); },
  };
  return { log, getConnection: async () => conn };
}

test('a routine send never changes an install\'s plan: it is not in the UPDATE clause', async () => {
  const p = fakeConn();
  await saveInstall(p, parsePayload(good()).value);
  const upsert = p.log[0].sql;
  assert.match(upsert, /INSERT INTO installs/);
  const update = upsert.split('ON DUPLICATE KEY UPDATE')[1];
  assert.ok(update && !/plan/i.test(update), 'plan must not be updated by a send: ' + update);
});

test('a client claiming to be paid cannot start as paid: new installs are always inserted as free', async () => {
  const p = fakeConn();
  const claim = parsePayload({ ...good(), plan: 'paid' });   // the validator still accepts the field...
  await saveInstall(p, claim.value);                           // ...but the store ignores it
  assert.match(p.log[0].sql, /VALUES \(\?, \?, \?, \?, \?, 'free',/, 'plan is the literal free');
  assert.ok(!p.log[0].params.includes('paid'), 'the claimed plan never reaches the database');
});

test('list paging is clamped so the page cannot be asked for everything at once', () => {
  assert.deepEqual(parseList({}), { limit: 50, offset: 0 });
  assert.deepEqual(parseList({ limit: '20', offset: '40' }), { limit: 20, offset: 40 });
  assert.equal(parseList({ limit: '99999' }).limit, 200);
  assert.equal(parseList({ limit: '0' }).limit, 50, 'zero falls back to the default');
  assert.equal(parseList({ limit: '-5' }).limit, 1);
  assert.equal(parseList({ offset: '-9' }).offset, 0);
  assert.deepEqual(parseList({ limit: 'abc', offset: 'x' }), { limit: 50, offset: 0 });
  assert.match(LIST_SQL, /LIMIT \? OFFSET \?/, 'limit and offset are bound parameters, not concatenated');
});

test('install rows are shaped for the page, with features split into a list', () => {
  const rows = [{ install_id: ID, first_seen: 'a', last_seen: 'b', app_version: 606, platform: 'android', plan: 'paid',
    time_zone: 'Asia/Calcutta', language: 'en-IN', age_band: '25-34', gender: null, features: 'mf,stocks' },
    { install_id: 'b'.repeat(32), plan: 'free', features: null }];
  const s = shapeInstalls(rows, 2, 50, 0);
  assert.equal(s.total, 2);
  assert.deepEqual(s.installs[0].features, ['mf', 'stocks']);
  assert.equal(s.installs[0].plan, 'paid');
  assert.deepEqual(s.installs[1].features, [], 'no features is an empty list, not null');
  assert.deepEqual(shapeInstalls(undefined, 0, 50, 0).installs, []);
});

test('a plan change must name a real install id and one of the two plans', () => {
  assert.equal(parsePlanChange({ installId: ID, plan: 'paid' }).ok, true);
  assert.equal(parsePlanChange({ installId: ID, plan: 'free' }).ok, true);
  for (const bad of [null, 'x', [], { installId: ID }, { plan: 'paid' }, { installId: ID, plan: 'gold' },
    { installId: ID, plan: 'PAID' }, { installId: "x'; DROP TABLE installs;--", plan: 'paid' }, { installId: 'short', plan: 'paid' }]) {
    assert.equal(parsePlanChange(bad).ok, false, JSON.stringify(bad));
  }
});

test('setPlan updates exactly one install with bound parameters, and reports whether it existed', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: params[1] === ID ? 1 : 0 }]; } };
  assert.equal(await setPlan(pool, ID, 'paid'), true);
  assert.equal(await setPlan(pool, 'c'.repeat(32), 'paid'), false);
  assert.equal(calls[0].sql, 'UPDATE installs SET plan = ? WHERE install_id = ?');
  assert.deepEqual(calls[0].params, ['paid', ID]);
});

test('getPlan returns the stored plan, or null for an install the server has never seen', async () => {
  const pool = { query: async (sql, params) => [params[0] === ID ? [{ plan: 'paid' }] : []] };
  assert.equal(await getPlan(pool, ID), 'paid');
  assert.equal(await getPlan(pool, 'd'.repeat(32)), null);
});

test('admin is open when no ADMIN_KEY is set, and locks the moment one is', () => {
  const saved = process.env.ADMIN_KEY;
  try {
    delete process.env.ADMIN_KEY;
    assert.equal(adminKeySet(), false);
    assert.equal(requireAdmin({ headers: {} }), null, 'open by the owner\'s decision');
    process.env.ADMIN_KEY = 'secret-123';
    assert.equal(adminKeySet(), true);
    assert.equal(requireAdmin({ headers: {} }), 'bad admin key');
    assert.equal(requireAdmin({ headers: { 'x-admin-key': 'nope' } }), 'bad admin key');
    assert.equal(requireAdmin({ headers: { 'x-admin-key': 'secret-123' } }), null);
    assert.equal(requireAdmin({ headers: {}, query: { k: 'secret-123' } }), null);
  } finally {
    if (saved === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = saved;
  }
});

test('the membership answer says the plan and whether the server knows this install', async () => {
  const pool = { query: async (sql, params) => [params[0] === ID ? [{ plan: 'paid' }] : []] };
  assert.deepEqual(await planAnswer(pool, ID), { plan: 'paid', known: true });
  assert.deepEqual(await planAnswer(pool, 'e'.repeat(32)), { plan: 'free', known: false }, 'an unseen install is free and unknown');
  const freePool = { query: async () => [[{ plan: 'free' }]] };
  assert.deepEqual(await planAnswer(freePool, ID), { plan: 'free', known: true });
});
