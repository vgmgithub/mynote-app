import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySubscriptionEvent } from '../lib/subscriptions.js';

// A query log plus a table of canned answers, close enough to a real pool: SELECT period, then UPDATE
// subscriptions, then whatever syncInstallPlan needs (subs + plans + an UPDATE on installs).
function fakePool() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      const flat = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      if (/^SELECT period FROM subscriptions/.test(flat)) return [[{ period: 'annual' }]];
      if (/^SELECT plan_code, period, status, current_end FROM subscriptions/.test(flat)) return [[]];
      if (/^SELECT code, `rank`/.test(flat)) return [[]];
      return [[]];
    },
  };
}

const ev = (o = {}) => ({ event: 'subscription.charged', id: 'sub_1', installId: 'i1', status: 'active',
  currentEnd: new Date('2099-01-01T00:00:00.000Z'), ...o });

// Razorpay's own Plan renews on a real calendar cadence no matter what the admin's test clock says, so a
// renewal charged while the clock is on still needs shortening - the same override confirmSubscription
// makes on the first charge (lib/razorpay-subs.js).
test('a renewal keeps Razorpay\'s real date when the clock is off, and is shortened when it is on', async () => {
  const off = fakePool();
  await applySubscriptionEvent(off, ev(), { enabled: false });
  const updOff = off.calls.find((c) => /^UPDATE subscriptions/.test(c.sql));
  assert.equal(updOff.params[1].toISOString(), '2099-01-01T00:00:00.000Z');

  const on = fakePool();
  const before = Date.now();
  await applySubscriptionEvent(on, ev(), { enabled: true, monthly: '10m', annual: '2h', remindBefore: '3m' });
  const updOn = on.calls.find((c) => /^UPDATE subscriptions/.test(c.sql));
  const gotMs = new Date(updOn.params[1]).getTime();
  assert.ok(gotMs > before + 110 * 60000 && gotMs < before + 130 * 60000, 'two hours out (annual), not the real date');
});

test('with no clock argument at all, real time is unaffected (every existing caller keeps working)', async () => {
  const pool = fakePool();
  await applySubscriptionEvent(pool, ev());
  const upd = pool.calls.find((c) => /^UPDATE subscriptions/.test(c.sql));
  assert.equal(upd.params[1].toISOString(), '2099-01-01T00:00:00.000Z');
});
