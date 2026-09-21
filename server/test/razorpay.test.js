import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  keysFrom, basicAuth, parseCreate, orderPayload, createOrder, parseVerify,
  signatureFor, signatureMatches, verifyPayment, PRO_AMOUNT_PAISE, MIN_AMOUNT_PAISE, CURRENCY,
} from '../lib/razorpay.js';
import { grantPaid } from '../lib/installs.js';

const ID = '4dcd6fca-1234-4abc-9def-0123456789ab';
const OTHER = '9999aaaa-1234-4abc-9def-0123456789ab';
const ENV = { RAZORPAY_KEY_ID: 'rzp_test_ABC', RAZORPAY_KEY_SECRET: 'not-a-real-secret' };
const reply = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('the price is fixed on the server and above Razorpay minimum', () => {
  assert.equal(PRO_AMOUNT_PAISE, 39900);
  assert.ok(PRO_AMOUNT_PAISE >= MIN_AMOUNT_PAISE);
  assert.equal(CURRENCY, 'INR');
});

test('an order asks for the server price and binds itself to the install; the client cannot set the amount', () => {
  const p = orderPayload(ID, 1000);
  assert.equal(p.amount, 39900);
  assert.equal(p.currency, 'INR');
  assert.equal(p.notes.installId, ID, 'the install id travels in the order notes, read back at verification');
  assert.ok(p.receipt.length <= 40, 'a receipt is at most 40 characters');
  assert.equal(parseCreate({ installId: ID, amount: 1 }).installId, ID, 'an amount in the request is ignored, not obeyed');
  for (const bad of [null, {}, { installId: 'nope' }, { installId: 5 }]) assert.equal(parseCreate(bad).ok, false);
});

test('credentials come only from the environment, and are sent as HTTP Basic', () => {
  assert.equal(keysFrom({}), null);
  assert.equal(keysFrom({ RAZORPAY_KEY_ID: 'a' }), null, 'a key id without a secret is not configured');
  const k = keysFrom(ENV);
  assert.equal(basicAuth(k), 'Basic ' + Buffer.from('rzp_test_ABC:not-a-real-secret').toString('base64'));
});

test('create order returns only what the browser needs, and never the secret', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, opts }; return { status: 200, ok: true, json: async () => ({ id: 'order_Abc123', amount: 39900, currency: 'INR', extra: 'x' }) }; };
  const r = await createOrder({ env: ENV, installId: ID, fetchImpl, now: 1 });
  assert.deepEqual(r, { ok: true, order_id: 'order_Abc123', amount: 39900, currency: 'INR', key_id: 'rzp_test_ABC' });
  assert.equal(sent.url, 'https://api.razorpay.com/v1/orders');
  assert.equal(JSON.parse(sent.opts.body).amount, 39900);
  assert.ok(!JSON.stringify(r).includes('not-a-real-secret'), 'the secret must never be in what the browser receives');
});

test('create order failures map to the right status', async () => {
  assert.equal((await createOrder({ env: {}, installId: ID })).status, 503, 'not configured');
  assert.equal((await createOrder({ env: ENV, installId: ID, fetchImpl: reply(401, {}) })).status, 401, 'credentials rejected');
  assert.equal((await createOrder({ env: ENV, installId: ID, fetchImpl: reply(400, {}) })).status, 500, 'provider error');
  assert.equal((await createOrder({ env: ENV, installId: ID, fetchImpl: async () => { throw new Error('net'); } })).status, 500, 'unreachable');
  assert.equal((await createOrder({ env: ENV, installId: ID, fetchImpl: reply(200, {}) })).status, 500, 'unreadable answer');
});

test('the signature is HMAC-SHA256 of order|payment with the secret, compared exactly', () => {
  const want = createHmac('sha256', 'not-a-real-secret').update('order_A|pay_B').digest('hex');
  assert.equal(signatureFor('order_A', 'pay_B', 'not-a-real-secret'), want);
  assert.equal(signatureMatches('order_A', 'pay_B', want, 'not-a-real-secret'), true);
  assert.equal(signatureMatches('order_A', 'pay_B', want.toUpperCase(), 'not-a-real-secret'), true, 'hex case is not significant');
  assert.equal(signatureMatches('order_A', 'pay_B', want, 'a-different-secret'), false, 'the wrong secret fails');
  assert.equal(signatureMatches('order_A', 'pay_X', want, 'not-a-real-secret'), false, 'a different payment fails');
  assert.equal(signatureMatches('order_A', 'pay_B', 'short', 'not-a-real-secret'), false, 'a wrong-length value fails without throwing');
});

const goodInput = () => ({ installId: ID, orderId: 'order_A1', paymentId: 'pay_B2', signature: signatureFor('order_A1', 'pay_B2', 'not-a-real-secret') });
const paidOrder = (over = {}) => ({ id: 'order_A1', status: 'paid', amount: 39900, amount_paid: 39900, currency: 'INR', notes: { installId: ID }, ...over });

test('verify: any missing or malformed field is a 400 before anything else happens', () => {
  const ok = { installId: ID, razorpay_order_id: 'order_A1', razorpay_payment_id: 'pay_B2', razorpay_signature: 'a'.repeat(64) };
  assert.equal(parseVerify(ok).ok, true);
  for (const drop of ['installId', 'razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']) {
    const b = { ...ok }; delete b[drop];
    assert.equal(parseVerify(b).status, 400, 'missing ' + drop);
  }
  assert.equal(parseVerify({ ...ok, razorpay_order_id: '../../admin' }).ok, false, 'an id is never allowed to become a path');
  assert.equal(parseVerify({ ...ok, razorpay_signature: 'zz' }).ok, false);
});

test('verify: a good payment for this install switches Pro on, once confirmed with Razorpay', async () => {
  const granted = [];
  const r = await verifyPayment({ env: ENV, input: goodInput(), pool: 'POOL', fetchImpl: reply(200, paidOrder()), grant: async (p, id) => granted.push([p, id]) });
  assert.deepEqual(r, { ok: true, plan: 'paid' });
  assert.deepEqual(granted, [['POOL', ID]]);
});

// Every one of these must be refused AND must leave the install unpaid.
test('verify: nothing is marked paid on a mismatch, an unpaid order, a wrong amount, or another install payment', async () => {
  const cases = [
    ['a forged signature', { ...goodInput(), signature: '0'.repeat(64) }, reply(200, paidOrder()), 400],
    ['an order still unpaid', goodInput(), reply(200, paidOrder({ status: 'created', amount_paid: 0 })), 400],
    ['a short payment', goodInput(), reply(200, paidOrder({ amount_paid: 100 })), 400],
    ['the wrong currency', goodInput(), reply(200, paidOrder({ currency: 'USD' })), 400],
    ['a payment opened for a DIFFERENT install (replay)', goodInput(), reply(200, paidOrder({ notes: { installId: OTHER } })), 400],
    ['an order with no notes', goodInput(), reply(200, paidOrder({ notes: undefined })), 400],
  ];
  for (const [name, input, fetchImpl, status] of cases) {
    const granted = [];
    const r = await verifyPayment({ env: ENV, input, pool: 'POOL', fetchImpl, grant: async () => granted.push(1) });
    assert.equal(r.ok, false, name);
    assert.equal(r.status, status, name);
    assert.equal(granted.length, 0, name + ': must not grant Pro');
  }
});

test('verify: provider trouble is reported and grants nothing', async () => {
  const none = [];
  const g = async () => none.push(1);
  assert.equal((await verifyPayment({ env: {}, input: goodInput(), pool: 0, fetchImpl: reply(200, paidOrder()), grant: g })).status, 503);
  assert.equal((await verifyPayment({ env: ENV, input: goodInput(), pool: 0, fetchImpl: reply(401, {}), grant: g })).status, 401);
  assert.equal((await verifyPayment({ env: ENV, input: goodInput(), pool: 0, fetchImpl: reply(500, {}), grant: g })).status, 500);
  assert.equal((await verifyPayment({ env: ENV, input: goodInput(), pool: 0, fetchImpl: async () => { throw new Error('x'); }, grant: g })).status, 500);
  assert.equal(none.length, 0);
});

test('granting Pro works for an install the server has never seen, and never touches another install', async () => {
  const calls = [];
  await grantPaid({ query: async (sql, params) => { calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); } }, ID, new Date('2026-09-21T10:00:00Z'));
  assert.match(calls[0].sql, /INSERT INTO installs/);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE plan = 'paid'/, 'an existing row only has its plan changed');
  assert.equal(calls[0].params[0], ID, 'the id is a bound parameter');
  assert.ok(!/DELETE|DROP/i.test(calls[0].sql));
});

test('the secret is read from the environment only: no source file names a key', () => {
  for (const f of ['../lib/razorpay.js', '../api/create-order.js', '../api/verify-payment.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /rzp_(test|live)_[A-Za-z0-9]{6,}/, f + ' contains a key id');
    assert.doesNotMatch(src, /key_secret\s*[:=]\s*['"][^'"]{8,}/i, f + ' contains a secret');
  }
});
