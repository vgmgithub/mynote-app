// razorpay-subs.js — Razorpay Subscriptions: recurring UPI/card mandates, as opposed to the one-time
// Orders flow in lib/razorpay.js (kept for lifetime, later).
//
// Same shape as razorpay.js on purpose: no SDK, REST + fetch, every network call takes `fetchImpl` so
// tests never reach the network, and the price is decided here from plan_prices - never sent by the app.
//
// TWO OBJECTS ON RAZORPAY'S SIDE, ONE OF THEM CACHED.
//
//   A Plan is the recurring amount and cadence ("₹49 every month"). It is created once per price and
//   its id is cached on plan_prices.gateway_plan_id, so a second buyer of the same price reuses it
//   rather than minting a duplicate Plan on every purchase.
//
//   A Subscription is one person's mandate against a Plan. One is created per purchase, written to our
//   own `subscriptions` table as 'created', and only becomes 'active' once the first charge is
//   confirmed - either by the browser's checkout callback (confirmSubscription below) or, if that
//   never arrives, by the subscription.charged webhook (lib/webhook.js), which is the source of truth
//   for every charge after the first.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { periodEnd } from './plans.js';

export const API_BASE = 'https://api.razorpay.com/v1';

const INSTALL_ID = /^[0-9a-f-]{32,36}$/;
const fail = (status, error) => ({ ok: false, status, error });

export function keysFrom(env) {
  const id = String((env && env.RAZORPAY_KEY_ID) || '').trim();
  const secret = String((env && env.RAZORPAY_KEY_SECRET) || '').trim();
  return id && secret ? { id, secret } : null;
}
export const basicAuth = (keys) => 'Basic ' + Buffer.from(keys.id + ':' + keys.secret).toString('base64');

// Razorpay's own vocabulary differs from ours ('yearly' not 'annual'), so the mapping lives in one
// place rather than being spelled out wherever a Plan is built.
const RP_PERIOD = { monthly: 'monthly', annual: 'yearly' };

// How many charges a mandate is created for. Razorpay requires a finite total_count; there is no
// "forever". These are long enough that nobody reaches the end in practice - ten years of monthly
// charges, twenty-five years of annual ones - and short enough to stay well inside what Razorpay
// accepts. Reaching the end is handled the same as any other non-renewal: the term already paid for
// still runs to its finish.
const TOTAL_COUNT = { monthly: 120, annual: 25 };

export function parseCreate(body) {
  const b = body || {};
  const id = b.installId;
  if (typeof id !== 'string' || !INSTALL_ID.test(id)) return fail(400, 'bad installId');
  const plan = typeof b.plan === 'string' && b.plan ? b.plan : 'pro';
  const period = typeof b.period === 'string' && b.period ? b.period : 'annual';
  if (!RP_PERIOD[period]) return fail(400, 'that period cannot be sold as a subscription');
  return { ok: true, installId: id, plan, period };
}

// What a Razorpay Plan looks like for one price row. `item.amount` and `item.currency` are what the
// mandate actually charges - the app never supplies these.
export function planPayload(price) {
  return {
    period: RP_PERIOD[price.period],
    interval: 1,
    item: { name: price.label, amount: price.amount, currency: price.currency, description: 'MyNotes ' + price.label },
    notes: { plan_code: price.planCode, period: price.period },
  };
}

// The Plan id for this price, creating and caching it on first use. Two requests for the same price
// arriving together could each create a Plan; the second INSERT.. ON DUPLICATE KEY simply keeps
// whichever row's id was written first; harmless because an unused duplicate Plan on Razorpay costs
// nothing and is never referenced again once the cache is in place.
export async function ensurePlan({ env, pool, price, fetchImpl = fetch }) {
  const [rows] = await pool.query(
    'SELECT gateway_plan_id FROM plan_prices WHERE plan_code = ? AND period = ? AND amount = ? AND active = 1 ORDER BY from_at DESC LIMIT 1',
    [price.planCode, price.period, price.amount]);
  const existing = rows[0] && rows[0].gateway_plan_id;
  if (existing) return { ok: true, planId: existing };

  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');
  let res;
  try {
    res = await fetchImpl(API_BASE + '/plans', {
      method: 'POST',
      headers: { Authorization: basicAuth(keys), 'Content-Type': 'application/json' },
      body: JSON.stringify(planPayload(price)),
    });
  } catch (_) { return fail(500, 'could not reach the payment provider'); }
  if (res.status === 401) return fail(401, 'the payment provider rejected this server\'s credentials');
  if (!res.ok) return fail(500, 'the payment provider could not create the plan');
  const p = await res.json().catch(() => null);
  if (!p || !p.id) return fail(500, 'the payment provider sent an unreadable answer');

  await pool.query(
    'UPDATE plan_prices SET gateway_plan_id = ? WHERE plan_code = ? AND period = ? AND amount = ? AND active = 1',
    [p.id, price.planCode, price.period, price.amount]);
  return { ok: true, planId: p.id };
}

export function subscriptionPayload(planId, installId, period) {
  return {
    plan_id: planId,
    total_count: TOTAL_COUNT[period] || TOTAL_COUNT.annual,
    customer_notify: 1,
    // Read back by the webhook (lib/webhook.js planFromEvent) to attach a charge to an install. This
    // is the only place a subscription and an install are linked - lose this and the event cannot be
    // acted on, only dropped.
    notes: { installId },
  };
}

// The full purchase flow: price -> cached Plan -> a fresh Subscription -> a local row waiting for its
// first charge. Returns what the browser's checkout needs and nothing else - the key SECRET never
// leaves this file.
export async function createSubscription({ env, pool, installId, plan, period, fetchImpl = fetch, now = new Date() }) {
  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');

  // Newest active row wins, same rule as livePrice() in lib/plans.js - kept as one direct query rather
  // than reusing that function, since here it is the only row fetched, not a list to filter.
  const [priceRows] = await pool.query(
    'SELECT plan_code, period, amount, currency, label FROM plan_prices WHERE plan_code = ? AND period = ? AND active = 1 ORDER BY from_at DESC LIMIT 1',
    [plan, period]);
  if (!priceRows.length) return fail(400, 'that plan is not on sale');
  const row = priceRows[0];
  const price = { planCode: row.plan_code, period: row.period, amount: row.amount, currency: row.currency, label: row.label };

  const planRes = await ensurePlan({ env, pool, price, fetchImpl });
  if (!planRes.ok) return planRes;

  let res;
  try {
    res = await fetchImpl(API_BASE + '/subscriptions', {
      method: 'POST',
      headers: { Authorization: basicAuth(keys), 'Content-Type': 'application/json' },
      body: JSON.stringify(subscriptionPayload(planRes.planId, installId, period)),
    });
  } catch (_) { return fail(500, 'could not reach the payment provider'); }
  if (res.status === 401) return fail(401, 'the payment provider rejected this server\'s credentials');
  if (!res.ok) return fail(500, 'the payment provider could not create the subscription');
  const sub = await res.json().catch(() => null);
  if (!sub || !sub.id) return fail(500, 'the payment provider sent an unreadable answer');

  // Written as 'created' - not yet paid for. confirmSubscription (below) or the webhook moves it to
  // 'active' once a charge is actually confirmed; nothing here grants entitlement.
  await pool.query(
    `INSERT INTO subscriptions (id, install_id, plan_code, period, amount, currency, status, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'created', ?, ?)`,
    [sub.id, installId, plan, period, price.amount, price.currency, now, now]);

  return { ok: true, subscription_id: sub.id, key_id: keys.id, amount: price.amount, currency: price.currency, period };
}

export function parseConfirm(body) {
  const b = body || {};
  const fields = ['installId', 'razorpay_subscription_id', 'razorpay_payment_id', 'razorpay_signature'];
  for (const f of fields) if (typeof b[f] !== 'string' || !b[f]) return fail(400, 'missing ' + f);
  if (!INSTALL_ID.test(b.installId)) return fail(400, 'bad installId');
  if (!/^sub_[A-Za-z0-9]+$/.test(b.razorpay_subscription_id)) return fail(400, 'bad subscription id');
  if (!/^pay_[A-Za-z0-9]+$/.test(b.razorpay_payment_id)) return fail(400, 'bad payment id');
  if (!/^[0-9a-f]{64}$/i.test(b.razorpay_signature)) return fail(400, 'bad signature');
  return { ok: true, installId: b.installId, subscriptionId: b.razorpay_subscription_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature };
}

// A DIFFERENT formula from the one-time Orders flow in razorpay.js: payment_id first, then the
// subscription id - mixing the two up is a signature that never matches anything, silently.
export function subSignatureFor(paymentId, subscriptionId, secret) {
  return createHmac('sha256', secret).update(paymentId + '|' + subscriptionId).digest('hex');
}
export function subSignatureMatches(paymentId, subscriptionId, signature, secret) {
  const want = Buffer.from(subSignatureFor(paymentId, subscriptionId, secret), 'utf8');
  const got = Buffer.from(String(signature).toLowerCase(), 'utf8');
  return want.length === got.length && timingSafeEqual(want, got);
}

// The browser's checkout callback fires the instant Razorpay accepts the first charge, well before a
// webhook is likely to have arrived - so this gives the app an immediate answer, reading the
// subscription straight back from Razorpay rather than trusting anything the browser said about it.
// Every charge AFTER this one is the webhook's job alone; this function only ever runs once per
// subscription, on the payment that started it.
// `clock` is the admin's test clock (lib/settings.js readClock), passed in by the caller rather than
// read here so this file stays a pure REST client with one exception. WHY an exception at all: Razorpay
// itself has no concept of a ten-minute month - its own Plan bills on a real calendar cadence no matter
// what we ask - so a test clock can only ever take effect by us overwriting the date Razorpay sent with
// one of our own. Real time (clock disabled or absent) always defers to Razorpay's own figure.
export async function confirmSubscription({ env, input, pool, fetchImpl = fetch, sync, clock = null }) {
  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');
  if (!subSignatureMatches(input.paymentId, input.subscriptionId, input.signature, keys.secret)) {
    return fail(400, 'signature mismatch');
  }

  let res;
  try {
    res = await fetchImpl(API_BASE + '/subscriptions/' + input.subscriptionId, { headers: { Authorization: basicAuth(keys) } });
  } catch (_) { return fail(500, 'could not reach the payment provider'); }
  if (res.status === 401) return fail(401, 'the payment provider rejected this server\'s credentials');
  if (!res.ok) return fail(500, 'could not confirm the subscription with the payment provider');
  const sub = await res.json().catch(() => null);
  if (!sub) return fail(500, 'the payment provider sent an unreadable answer');

  if (!sub.notes || sub.notes.installId !== input.installId) return fail(400, 'this subscription belongs to a different install');
  // 'authenticated' covers a mandate that is set up but whose first charge is still processing on some
  // payment methods; both it and 'active' mean the person is not to be left staring at a failure.
  if (sub.status !== 'active' && sub.status !== 'authenticated') return fail(400, 'this subscription has not been charged');

  const endSec = Number(sub.current_end);
  const real = Number.isFinite(endSec) && endSec > 0 ? new Date(endSec * 1000) : null;
  // Under a test clock, replace Razorpay's real billing date with the short one the admin set, so a
  // subscription bought right now really does end in ten minutes rather than a real month from now.
  // The period comes from our own row (written at createSubscription, before Razorpay is ever asked) -
  // the confirm request itself carries no period, only the ids to verify.
  let currentEnd = real;
  if (clock && clock.enabled) {
    const [rows] = await pool.query('SELECT period FROM subscriptions WHERE id = ?', [input.subscriptionId]);
    const period = rows[0] && rows[0].period;
    if (period) currentEnd = periodEnd(period, new Date(), clock);
  }
  await pool.query(
    'UPDATE subscriptions SET status = ?, current_end = ?, updated_at = NOW() WHERE id = ?',
    ['active', currentEnd, input.subscriptionId]);
  const ent = await sync(pool, input.installId);
  return { ok: true, plan: ent.plan, until: ent.until, period: ent.period, clock };
}
