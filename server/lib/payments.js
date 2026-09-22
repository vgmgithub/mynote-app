// Admin view of Razorpay payments, and the refund action. Read-only except refundPayment.
//
// Same rules as lib/razorpay.js: no SDK, the network is injected (tests use fakes), and the key SECRET stays in this
// server. What leaves here is deliberately thin: ids, amounts, method, status and failure code. Razorpay also holds
// each payer's email and phone; those are never copied out, so this page cannot become a customer list.
import { API_BASE, basicAuth, keysFrom, PRO_AMOUNT_PAISE } from './razorpay.js';

const fail = (status, error) => ({ ok: false, status, error });
const IST_MS = 330 * 60 * 1000;                                  // India has no daylight saving: a fixed +5:30
export const PAGE = 100;                                         // Razorpay's maximum per request
export const MAX_PAGES = 5;                                      // 500 payments is plenty for the window shown
export const WINDOW_DAYS = 30;

export const dayIST = (unixSeconds) => new Date(unixSeconds * 1000 + IST_MS).toISOString().slice(0, 10);

async function get(path, keys, fetchImpl) {
  let res;
  try { res = await fetchImpl(API_BASE + path, { headers: { Authorization: basicAuth(keys) } }); }
  catch (_) { return fail(502, 'could not reach the payment provider'); }
  if (res.status === 401) return fail(401, 'the payment provider rejected this server\'s credentials');
  if (!res.ok) return fail(502, 'the payment provider could not answer (HTTP ' + res.status + ')');
  const body = await res.json().catch(() => null);
  return body ? { ok: true, body } : fail(502, 'the payment provider sent an unreadable answer');
}

// Every payment from `fromSec` on, newest first, following Razorpay's paging up to MAX_PAGES.
export async function listPayments({ env, fetchImpl = fetch, fromSec }) {
  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');
  const items = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await get('/payments?count=' + PAGE + '&skip=' + page * PAGE + '&from=' + fromSec, keys, fetchImpl);
    if (!r.ok) return r;
    const got = Array.isArray(r.body.items) ? r.body.items : [];
    items.push(...got);
    if (got.length < PAGE) return { ok: true, items, testMode: keys.id.startsWith('rzp_test_'), truncated: false };
  }
  return { ok: true, items, testMode: keys.id.startsWith('rzp_test_'), truncated: true };
}

// One payment, reduced to what the page needs. `refundable` is what is still left to give back.
export function shapePayment(p) {
  const amount = Number(p.amount) || 0;
  const refunded = Number(p.amount_refunded) || 0;
  const captured = p.status === 'captured' || p.status === 'refunded';
  return {
    id: String(p.id), orderId: p.order_id || '', subscriptionId: p.subscription_id || '', amount, refunded,
    refundable: captured ? Math.max(0, amount - refunded) : 0,
    status: String(p.status || ''), method: p.method || '', at: Number(p.created_at) || 0,
    fee: Number(p.fee) || 0,
    error: p.error_code ? { code: String(p.error_code), reason: p.error_reason || '', text: String(p.error_description || '').slice(0, 140) } : null,
  };
}

const IN_FLIGHT = new Set(['created', 'authorized']);

// The numbers the Payments tab shows. `nowSec` is injected so the day buckets are testable.
export function shapePayments(rawItems, nowSec = Math.floor(Date.now() / 1000)) {
  const items = (rawItems || []).map(shapePayment);
  const today = dayIST(nowSec);
  const paid = items.filter((p) => p.status === 'captured' || p.status === 'refunded');
  const failed = items.filter((p) => p.status === 'failed');
  const sum = (list, f) => list.reduce((s, p) => s + f(p), 0);

  const gross = sum(paid, (p) => p.amount);
  const refunded = sum(paid, (p) => p.refunded);
  const fees = sum(paid, (p) => p.fee);

  // One entry per day for the window, including days with nothing, so the chart's x axis is honest.
  const days = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) days.push(dayIST(nowSec - i * 86400));
  const byDay = new Map(days.map((d) => [d, { day: d, amount: 0, count: 0, failed: 0 }]));
  for (const p of items) {
    const b = byDay.get(dayIST(p.at));
    if (!b) continue;
    if (p.status === 'captured' || p.status === 'refunded') { b.amount += p.amount - p.refunded; b.count += 1; }
    else if (p.status === 'failed') b.failed += 1;
  }

  const tally = (list, key) => {
    const m = new Map();
    for (const p of list) { const k = key(p); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return [...m].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  };

  const attempts = paid.length + failed.length;
  const todayRow = byDay.get(today);
  return {
    totals: {
      gross, refunded, net: gross - refunded, fees,
      paidCount: paid.length, failedCount: failed.length,
      refundedCount: paid.filter((p) => p.refunded > 0).length,
      inFlight: items.filter((p) => IN_FLIGHT.has(p.status)).length,
      successRate: attempts ? Math.round((paid.length / attempts) * 1000) / 10 : null,
      average: paid.length ? Math.round(gross / paid.length) : 0,
      today: todayRow ? todayRow.amount : 0, todayCount: todayRow ? todayRow.count : 0,
      // Full-price Pro sales versus anything else, which would mean a price changed or a test was odd.
      atProPrice: paid.filter((p) => p.amount === PRO_AMOUNT_PAISE).length,
    },
    daily: [...byDay.values()],
    methods: tally(paid, (p) => p.method),
    failures: tally(failed, (p) => (p.error && (p.error.reason || p.error.code)) || 'unknown'),
    recent: items.slice(0, 50),
  };
}

// ---- refund ----
export function parseRefund(body) {
  const b = body || {};
  if (typeof b.paymentId !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(b.paymentId)) return fail(400, 'bad payment id');
  let amount = null;                                            // null = whatever is left, in full
  if (b.amount != null && b.amount !== '') {
    amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount < 100) return fail(400, 'amount must be whole paise, at least 100');
  }
  return { ok: true, paymentId: b.paymentId, amount, revoke: b.revoke !== false };
}

// Refund through Razorpay. The payment is read back first so the amount is checked against what is really refundable,
// and (only when the whole payment goes back) the install it was bought for is found from notes - on the order for
// the old one-time flow, on the SUBSCRIPTION for every payment sold since (a subscription charge has no order of
// its own with our notes on it; the installId lives on the mandate, set once when it was created). `revokePlan` is
// called with that install id and, when there is one, the subscription id so the caller can end the mandate's row
// too - not only the cached free/paid flag, which a still-active subscription row would otherwise regrant on the
// next plan check. It is not called for a partial refund.
export async function refundPayment({ env, input, fetchImpl = fetch, revokePlan }) {
  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');
  const p = await get('/payments/' + input.paymentId, keys, fetchImpl);
  if (!p.ok) return p;
  const pay = shapePayment(p.body);
  if (!pay.refundable) return fail(400, 'nothing left to refund on this payment');
  const amount = input.amount == null ? pay.refundable : input.amount;
  if (amount > pay.refundable) return fail(400, 'only ' + pay.refundable + ' paise can still be refunded');

  let res;
  try {
    res = await fetchImpl(API_BASE + '/payments/' + input.paymentId + '/refund', {
      method: 'POST',
      headers: { Authorization: basicAuth(keys), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, speed: 'normal', notes: { by: 'mynotes-admin' } }),
    });
  } catch (_) { return fail(502, 'could not reach the payment provider'); }
  const out = await res.json().catch(() => null);
  if (!res.ok || !out || !out.id) {
    const why = out && out.error && out.error.description ? String(out.error.description).slice(0, 160) : 'HTTP ' + res.status;
    return fail(res.status === 401 ? 401 : 400, 'Razorpay refused the refund: ' + why);
  }

  let revoked = false;
  if (input.revoke && amount === pay.refundable && pay.refunded === 0 && revokePlan && (pay.orderId || pay.subscriptionId)) {
    let installId = null;
    if (pay.subscriptionId) {
      const s = await get('/subscriptions/' + pay.subscriptionId, keys, fetchImpl);
      installId = s.ok && s.body.notes && s.body.notes.installId;
    } else if (pay.orderId) {
      const o = await get('/orders/' + pay.orderId, keys, fetchImpl);
      installId = o.ok && o.body.notes && o.body.notes.installId;
    }
    if (installId) revoked = Boolean(await revokePlan(installId, { subscriptionId: pay.subscriptionId || null }).catch(() => false));
  }
  return { ok: true, refundId: out.id, amount, status: out.status || 'processed', revoked };
}
