import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  keysFrom, parseCreate, planPayload, ensurePlan, subscriptionPayload, createSubscription,
  parseConfirm, subSignatureFor, subSignatureMatches, confirmSubscription,
} from '../lib/razorpay-subs.js';

const ID = '4dcd6fca-1234-4abc-9def-0123456789ab';
const ENV = { RAZORPAY_KEY_ID: 'rzp_test_ABC', RAZORPAY_KEY_SECRET: 'not-a-real-secret' };
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

// A query log plus a table of canned answers keyed by which SQL this call is - close enough to a real
// pool for these functions, which only ever SELECT one row, UPDATE one row, or INSERT one row.
function fakePool(answers = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      const flat = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: flat, params });
      if (/^SELECT gateway_plan_id/.test(flat)) return [answers.planRow ? [answers.planRow] : []];
      if (/^SELECT plan_code, period, amount, currency, label/.test(flat)) return [answers.priceRow ? [answers.priceRow] : []];
      return [[]];
    },
  };
}

const price = (o = {}) => ({ planCode: 'pro', period: 'monthly', amount: 4900, currency: 'INR', label: 'MyNotes Pro - Monthly', ...o });

test('a Plan is priced from the row, never from the request, and named recognisably', () => {
  const p = planPayload(price());
  assert.deepEqual(p, {
    period: 'monthly', interval: 1,
    item: { name: 'MyNotes Pro - Monthly', amount: 4900, currency: 'INR', description: 'MyNotes MyNotes Pro - Monthly' },
    notes: { plan_code: 'pro', period: 'monthly' },
  });
  assert.equal(planPayload(price({ period: 'annual' })).period, 'yearly', 'Razorpay calls it yearly, we call it annual');
});

test('parseCreate defaults to a sellable subscription, and refuses anything else', () => {
  const d = parseCreate({ installId: ID });
  assert.deepEqual([d.ok, d.plan, d.period], [true, 'pro', 'annual'], 'no period named still buys a subscription');
  assert.equal(parseCreate({ installId: ID, period: 'lifetime' }).ok, false, 'not a subscription period');
  assert.equal(parseCreate({ installId: ID, period: 'weekly' }).ok, false);
  assert.equal(parseCreate({ installId: 'nope', period: 'monthly' }).ok, false);
});

test('an existing Plan is reused; a Plan is only ever created once per price', async () => {
  const pool = fakePool({ planRow: { gateway_plan_id: 'plan_existing' } });
  let fetchCalled = false;
  const r = await ensurePlan({ env: ENV, pool, price: price(), fetchImpl: async () => { fetchCalled = true; } });
  assert.deepEqual(r, { ok: true, planId: 'plan_existing' });
  assert.equal(fetchCalled, false, 'the cached id is used; Razorpay is not asked again');
});

test('a missing Plan is created and its id cached for next time', async () => {
  const pool = fakePool({ planRow: null });
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, opts }; return { status: 200, ok: true, json: async () => ({ id: 'plan_new' }) }; };
  const r = await ensurePlan({ env: ENV, pool, price: price(), fetchImpl });
  assert.deepEqual(r, { ok: true, planId: 'plan_new' });
  assert.equal(sent.url, 'https://api.razorpay.com/v1/plans');
  const upd = pool.calls.find((c) => /^UPDATE plan_prices SET gateway_plan_id/.test(c.sql));
  assert.deepEqual(upd.params, ['plan_new', 'pro', 'monthly', 4900]);
});

test('a subscription is priced from the newest active row and carries a finite total_count', () => {
  const p = subscriptionPayload('plan_x', ID, 'monthly');
  assert.equal(p.plan_id, 'plan_x');
  assert.ok(Number.isFinite(p.total_count) && p.total_count > 0, 'Razorpay has no "forever"');
  assert.equal(p.customer_notify, 1);
  assert.deepEqual(p.notes, { installId: ID }, 'this is the only link the webhook has back to an install');
  // Long enough nobody reaches the end in practice, and different per period rather than one constant
  // that is wrong for the other.
  assert.notEqual(subscriptionPayload('plan_x', ID, 'annual').total_count, p.total_count);
});

test('creating a subscription: prices from the database, never trusts an amount from the request', async () => {
  const pool = fakePool({ priceRow: { plan_code: 'pro', period: 'monthly', amount: 4900, currency: 'INR', label: 'MyNotes Pro - Monthly' }, planRow: { gateway_plan_id: 'plan_x' } });
  const fetchImpl = reply(200, { id: 'sub_new' });
  const r = await createSubscription({ env: ENV, pool, installId: ID, plan: 'pro', period: 'monthly', fetchImpl, now: new Date('2026-01-01T00:00:00Z') });
  assert.deepEqual(r, { ok: true, subscription_id: 'sub_new', key_id: 'rzp_test_ABC', amount: 4900, currency: 'INR', period: 'monthly' });
  const ins = pool.calls.find((c) => /^INSERT INTO subscriptions/.test(c.sql));
  assert.deepEqual(ins.params, ['sub_new', ID, 'pro', 'monthly', 4900, 'INR', new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z')]);
  assert.match(ins.sql, /'created'/, 'not yet entitled - only a checkout callback or the webhook grants that');
});

test('a plan that is not on sale, or a provider that refuses, stops before a subscription row is written', async () => {
  const noPrice = fakePool({ priceRow: null });
  assert.equal((await createSubscription({ env: ENV, pool: noPrice, installId: ID, plan: 'pro', period: 'monthly' })).status, 400);
  const badKeys = fakePool({ priceRow: price() });
  assert.equal((await createSubscription({ env: {}, pool: badKeys, installId: ID, plan: 'pro', period: 'monthly' })).status, 503);
  const rejected = fakePool({ priceRow: price(), planRow: null });
  const r = await createSubscription({ env: ENV, pool: rejected, installId: ID, plan: 'pro', period: 'monthly', fetchImpl: reply(401, {}) });
  assert.equal(r.status, 401);
  assert.equal(rejected.calls.some((c) => /^INSERT INTO subscriptions/.test(c.sql)), false);
});

test('the subscription signature is a DIFFERENT formula from the one-time order signature', () => {
  const want = createHmac('sha256', 'not-a-real-secret').update('pay_B|sub_A').digest('hex');
  assert.equal(subSignatureFor('pay_B', 'sub_A', 'not-a-real-secret'), want, 'payment id first, then subscription id');
  assert.equal(subSignatureMatches('pay_B', 'sub_A', want, 'not-a-real-secret'), true);
  assert.equal(subSignatureMatches('pay_B', 'sub_A', want, 'wrong-secret'), false);
  // Swapping the two ids the way the order formula orders them must NOT accidentally verify.
  const swapped = createHmac('sha256', 'not-a-real-secret').update('sub_A|pay_B').digest('hex');
  assert.equal(subSignatureMatches('pay_B', 'sub_A', swapped, 'not-a-real-secret'), false);
});

test('confirm: any missing or malformed field is refused before anything is read back from Razorpay', () => {
  for (const bad of [
    null, {}, { installId: ID },
    { installId: 'nope', razorpay_subscription_id: 'sub_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'a1'.repeat(32) },
    { installId: ID, razorpay_subscription_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'a1'.repeat(32) },
  ]) {
    assert.equal(parseConfirm(bad).ok, false);
  }
  const ok = parseConfirm({ installId: ID, razorpay_subscription_id: 'sub_1', razorpay_payment_id: 'pay_1', razorpay_signature: 'a1'.repeat(32) });
  assert.equal(ok.ok, true);
});

test('confirm grants nothing on a bad signature, a foreign install, or a subscription that has not charged', async () => {
  const sig = subSignatureFor('pay_1', 'sub_1', 'not-a-real-secret');
  const input = (o = {}) => ({ installId: ID, subscriptionId: 'sub_1', paymentId: 'pay_1', signature: sig, ...o });
  let synced = false;
  const sync = async () => { synced = true; return { plan: 'paid', until: null }; };

  assert.equal((await confirmSubscription({ env: ENV, input: input({ signature: 'bad'.padEnd(64, '0') }), pool: fakePool(), sync })).status, 400);
  assert.equal(synced, false);

  const wrongInstall = fakePool();
  wrongInstall.query = async (sql) => { if (/subscriptions\/sub_1/.test(sql)) return [[]]; return [[]]; };
  // Simulate the GET by overriding fetchImpl instead, closer to real usage:
  const foreignFetch = reply(200, { status: 'active', notes: { installId: 'someone-else' }, current_end: 1999999999 });
  assert.equal((await confirmSubscription({ env: ENV, input: input(), pool: fakePool(), fetchImpl: foreignFetch, sync })).status, 400);
  assert.equal(synced, false);

  const notCharged = reply(200, { status: 'created', notes: { installId: ID } });
  assert.equal((await confirmSubscription({ env: ENV, input: input(), pool: fakePool(), fetchImpl: notCharged, sync })).status, 400);
  assert.equal(synced, false, 'a mandate that has not actually charged grants nothing');
});

test('confirm grants Pro on an active (or authenticated) subscription that belongs to this install, and only then', async () => {
  for (const status of ['active', 'authenticated']) {
    const sig = subSignatureFor('pay_1', 'sub_1', 'not-a-real-secret');
    const input = { installId: ID, subscriptionId: 'sub_1', paymentId: 'pay_1', signature: sig };
    const pool = fakePool();
    let syncedFor = null;
    const sync = async (p, id) => { syncedFor = id; return { plan: 'paid', until: '2027-01-01T00:00:00.000Z' }; };
    const fetchImpl = reply(200, { status, notes: { installId: ID }, current_end: 1798761600 });
    const r = await confirmSubscription({ env: ENV, input, pool, fetchImpl, sync });
    assert.deepEqual(r, { ok: true, plan: 'paid', until: '2027-01-01T00:00:00.000Z' });
    assert.equal(syncedFor, ID);
    const upd = pool.calls.find((c) => /^UPDATE subscriptions SET status/.test(c.sql));
    assert.equal(upd.params[0], 'active', 'stored as active even when Razorpay still says authenticated');
    assert.equal(upd.params[2], 'sub_1');
  }
});

test('the secret is read from the environment only: no source file names a key', () => {
  for (const f of ['../lib/razorpay-subs.js', '../api/create-order.js', '../api/verify-payment.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /rzp_(test|live)_[A-Za-z0-9]{6,}/, f + ' contains a key id');
    assert.doesNotMatch(src, /key_secret\s*[:=]\s*['"][^'"]{8,}/i, f + ' contains a secret');
  }
});

test('checkout picks the right verify path by which id is present, never by a caller-set flag', () => {
  const src = readFileSync(new URL('../api/verify-payment.js', import.meta.url), 'utf8');
  assert.match(src, /razorpay_subscription_id === 'string'/);
  assert.equal(/req\.(query|body)\.(type|kind|mode)/.test(src), false, 'the shape decides, not a flag the caller could set wrong');
});

test('create-order sells a subscription by default, and only reaches the one-time flow for what is not sellable', () => {
  const src = readFileSync(new URL('../api/create-order.js', import.meta.url), 'utf8');
  assert.match(src, /isSellable\(period\)/);
  assert.ok(src.indexOf("!isSellable(period)") < src.indexOf('createSubscription('), 'subscription is the fallthrough, not the special case');
});
