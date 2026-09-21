// Razorpay Standard Checkout, server side: create an order, then verify the payment that comes back.
//
// No SDK. Razorpay's REST API is two calls and a signature check, so this uses fetch and node:crypto and adds
// no dependency. Every function that touches the network or the database takes it as an argument, so the tests
// run with fakes and no real key.
//
// THE SECRET NEVER LEAVES THIS FILE'S CALLERS. RAZORPAY_KEY_SECRET is read from the server environment only; the
// app is given the public key id (which Razorpay's own checkout script needs) and nothing else.
//
// Two decisions worth knowing about:
//   1. The PRICE is fixed here, not sent by the app. If the phone could name the amount, anyone could pay one
//      rupee for Pro.
//   2. A payment is bound to ONE install. The install id is written into the order's notes when it is created,
//      and verification reads it back from Razorpay. Without that, one genuine payment could be replayed to switch
//      Pro on for any number of installs, because the signature covers only the order and payment ids.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const API_BASE = 'https://api.razorpay.com/v1';
export const CURRENCY = 'INR';
// Rupees 399, in paise. Mirrors PRO_PRICE in the app's plan-compare.js; a test in the app's suite keeps them equal.
export const PRO_AMOUNT_PAISE = 39900;
export const MIN_AMOUNT_PAISE = 100;

const INSTALL_ID = /^[0-9a-f-]{32,36}$/;
const fail = (status, error) => ({ ok: false, status, error });

export function keysFrom(env) {
  const id = String((env && env.RAZORPAY_KEY_ID) || '').trim();
  const secret = String((env && env.RAZORPAY_KEY_SECRET) || '').trim();
  return id && secret ? { id, secret } : null;
}

export const basicAuth = (keys) => 'Basic ' + Buffer.from(keys.id + ':' + keys.secret).toString('base64');

// A receipt is a label Razorpay shows in its dashboard: at most 40 characters, unique enough to find an order by.
export function receiptFor(installId, now = Date.now()) {
  return ('pro_' + String(installId).slice(0, 8) + '_' + now.toString(36) + '_' + randomBytes(2).toString('hex')).slice(0, 40);
}

export function parseCreate(body) {
  const id = body && body.installId;
  if (typeof id !== 'string' || !INSTALL_ID.test(id)) return fail(400, 'bad installId');
  return { ok: true, installId: id };
}

export function orderPayload(installId, now = Date.now()) {
  if (!(PRO_AMOUNT_PAISE >= MIN_AMOUNT_PAISE)) throw new Error('amount below the 100 paise minimum');
  return {
    amount: PRO_AMOUNT_PAISE,
    currency: CURRENCY,
    receipt: receiptFor(installId, now),
    notes: { installId, product: 'mynotes-pro' },   // read back at verification to bind this payment to this install
  };
}

// POST /v1/orders. `fetchImpl` is injected so tests never reach the network.
export async function createOrder({ env, installId, fetchImpl = fetch, now }) {
  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');
  let res;
  try {
    res = await fetchImpl(API_BASE + '/orders', {
      method: 'POST',
      headers: { Authorization: basicAuth(keys), 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload(installId, now)),
    });
  } catch (_) { return fail(500, 'could not reach the payment provider'); }
  // Bad credentials are a server configuration fault, but they are reported as 401 so it is obvious in a test.
  if (res.status === 401) return fail(401, 'the payment provider rejected this server\'s credentials');
  if (!res.ok) return fail(500, 'the payment provider could not create the order');
  const o = await res.json().catch(() => null);
  if (!o || !o.id) return fail(500, 'the payment provider sent an unreadable answer');
  // Only what the browser needs. The key SECRET is not in this, and never is.
  return { ok: true, order_id: o.id, amount: o.amount, currency: o.currency, key_id: keys.id };
}

export function parseVerify(body) {
  const b = body || {};
  const fields = ['installId', 'razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature'];
  for (const f of fields) if (typeof b[f] !== 'string' || !b[f]) return fail(400, 'missing ' + f);
  if (!INSTALL_ID.test(b.installId)) return fail(400, 'bad installId');
  // Razorpay ids are short alphanumerics with an underscore; reject anything else before it reaches a URL.
  if (!/^order_[A-Za-z0-9]+$/.test(b.razorpay_order_id)) return fail(400, 'bad order id');
  if (!/^pay_[A-Za-z0-9]+$/.test(b.razorpay_payment_id)) return fail(400, 'bad payment id');
  if (!/^[0-9a-f]{64}$/i.test(b.razorpay_signature)) return fail(400, 'bad signature');
  return { ok: true, installId: b.installId, orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature };
}

// HMAC-SHA256 of "order_id|payment_id" with the key secret, compared in constant time.
export function signatureFor(orderId, paymentId, secret) {
  return createHmac('sha256', secret).update(orderId + '|' + paymentId).digest('hex');
}

export function signatureMatches(orderId, paymentId, signature, secret) {
  const want = Buffer.from(signatureFor(orderId, paymentId, secret), 'utf8');
  const got = Buffer.from(String(signature).toLowerCase(), 'utf8');
  return want.length === got.length && timingSafeEqual(want, got);
}

// Verify a payment and, only if everything holds, mark the install paid.
//   1. The signature must match (so this really came from Razorpay's checkout).
//   2. The order, read back from Razorpay, must be paid, for the right amount, and carry THIS install's id in its notes.
// Any failure returns 400 and nothing is written.
export async function verifyPayment({ env, input, pool, fetchImpl = fetch, grant }) {
  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');
  if (!signatureMatches(input.orderId, input.paymentId, input.signature, keys.secret)) return fail(400, 'signature mismatch');

  let res;
  try {
    res = await fetchImpl(API_BASE + '/orders/' + input.orderId, { headers: { Authorization: basicAuth(keys) } });
  } catch (_) { return fail(500, 'could not reach the payment provider'); }
  if (res.status === 401) return fail(401, 'the payment provider rejected this server\'s credentials');
  if (!res.ok) return fail(500, 'could not confirm the order with the payment provider');
  const order = await res.json().catch(() => null);
  if (!order) return fail(500, 'the payment provider sent an unreadable answer');

  if (order.status !== 'paid') return fail(400, 'the order is not paid');
  if (Number(order.amount_paid) < PRO_AMOUNT_PAISE || order.currency !== CURRENCY) return fail(400, 'the amount paid is not the Pro price');
  if (!order.notes || order.notes.installId !== input.installId) return fail(400, 'this payment belongs to a different install');

  await grant(pool, input.installId);
  return { ok: true, plan: 'paid' };
}
