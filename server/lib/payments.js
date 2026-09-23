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

// Every invoice from `fromSec` on. A subscription charge's payment does not name its subscription, but its invoice
// does (subscription_id + payment_id), so one listing links every payment in the window to its person without a
// request per payment. Best effort: the caller shows payments unlinked if this fails.
export async function listInvoices({ env, fetchImpl = fetch, fromSec }) {
  const keys = keysFrom(env);
  if (!keys) return fail(503, 'payments are not configured on this server');
  const items = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await get('/invoices?count=' + PAGE + '&skip=' + page * PAGE + '&from=' + fromSec, keys, fetchImpl);
    if (!r.ok) return r;
    const got = Array.isArray(r.body.items) ? r.body.items : [];
    items.push(...got);
    if (got.length < PAGE) break;
  }
  return { ok: true, items };
}

// Fills in subscriptionId on shaped payments from the invoices, by payment id first, then by invoice id.
export function linkSubscriptions(payments, invoices) {
  const byPay = new Map(), byInv = new Map();
  for (const i of invoices || []) {
    if (!i || !i.subscription_id) continue;
    if (i.payment_id) byPay.set(String(i.payment_id), String(i.subscription_id));
    if (i.id) byInv.set(String(i.id), String(i.subscription_id));
  }
  return (payments || []).map((p) => (p.subscriptionId ? p
    : { ...p, subscriptionId: byPay.get(p.id) || (p.invoiceId && byInv.get(p.invoiceId)) || '' }));
}

// One payment, reduced to what the page needs. `refundable` is what is still left to give back.
export function shapePayment(p) {
  const amount = Number(p.amount) || 0;
  const refunded = Number(p.amount_refunded) || 0;
  const captured = p.status === 'captured' || p.status === 'refunded';
  return {
    // Three different ways a payment can point back at what bought it, because Razorpay fills in
    // different ones depending on the flow. A one-time Order payment has order_id and OUR notes on that
    // order. A subscription charge has invoice_id (and an order_id Razorpay minted itself, which carries
    // none of our notes) - subscription_id is NOT a documented field on the payment entity, so it is read
    // when present and never relied on. resolveInstall() below walks all of them.
    id: String(p.id), orderId: p.order_id || '', subscriptionId: p.subscription_id || '',
    invoiceId: p.invoice_id || '', notesInstallId: (p.notes && p.notes.installId) || '',
    amount, refunded,
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

// Which install a payment belongs to. Razorpay gives no single answer, so every link it does give is
// tried in turn, cheapest first:
//
//   1. notes on the payment itself          - set for some flows, free to read, no extra request
//   2. subscription_id on the payment       - NOT a documented field on the payment entity; read when
//                                             Razorpay happens to send it, never depended on
//   3. invoice_id -> the invoice            - this is the one that actually works for a subscription
//                                             charge: every such payment has an invoice, and the invoice
//                                             carries the subscription id
//   4. the subscription's own notes         - where createSubscription() put installId
//   5. order_id -> the order's notes        - the old one-time flow, whose order WE created
//
// What broke before: only 2 and 5 were tried. A subscription charge has no 2 (Razorpay does not send it)
// and its 5 is an order Razorpay minted itself, carrying none of our notes - so the install was never
// found, revokePlan() was never called, and the refund silently left the person on Pro.
//
// `subscriptionId` is returned even when no installId could be read from Razorpay, because the caller can
// still find the install in OUR OWN subscriptions table, where that id is the primary key. That lookup
// does not depend on Razorpay's payload shape at all, so it keeps working whatever they change next.
async function resolveInstall(pay, keys, fetchImpl) {
  let subscriptionId = pay.subscriptionId || '';
  if (pay.notesInstallId) return { installId: pay.notesInstallId, subscriptionId };

  if (!subscriptionId && pay.invoiceId) {
    const inv = await get('/invoices/' + pay.invoiceId, keys, fetchImpl);
    if (inv.ok && inv.body) {
      subscriptionId = inv.body.subscription_id || '';
      const fromInvoice = inv.body.notes && inv.body.notes.installId;
      if (fromInvoice) return { installId: fromInvoice, subscriptionId };
    }
  }
  if (subscriptionId) {
    const sub = await get('/subscriptions/' + subscriptionId, keys, fetchImpl);
    const fromSub = sub.ok && sub.body.notes && sub.body.notes.installId;
    if (fromSub) return { installId: fromSub, subscriptionId };
  }
  if (pay.orderId) {
    const o = await get('/orders/' + pay.orderId, keys, fetchImpl);
    const fromOrder = o.ok && o.body.notes && o.body.notes.installId;
    if (fromOrder) return { installId: fromOrder, subscriptionId };
  }
  // Nothing from Razorpay - but a subscription id alone is enough for the caller's own database.
  return { installId: null, subscriptionId };
}

// Refund through Razorpay. The payment is read back first so the amount is checked against what is really
// refundable, and (only when the whole payment goes back) the install it was bought for is resolved by
// resolveInstall above so its Pro can be switched off. `revokePlan` receives both the install id and the
// subscription id - the latter so the caller can end the mandate's own row too, not only the cached
// free/paid flag, which a still-active subscription row would otherwise regrant on the next plan check.
// It is not called for a partial refund.
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
  // Said out loud rather than left as a silent false: a refund that went through but could not find who
  // to take Pro from is exactly the case somebody has to finish by hand in the Users tab, and the page
  // can only tell them that if this says so.
  let revokeNote = null;
  if (input.revoke && amount === pay.refundable && pay.refunded === 0 && revokePlan) {
    const { installId, subscriptionId } = await resolveInstall(pay, keys, fetchImpl);
    if (installId || subscriptionId) {
      revoked = Boolean(await revokePlan({ installId: installId || null, subscriptionId: subscriptionId || null }).catch(() => false));
      if (!revoked) revokeNote = 'could not work out which install this payment belongs to';
    } else {
      revokeNote = 'this payment carries no subscription or order to trace back to an install';
    }
  }
  return { ok: true, refundId: out.id, amount, status: out.status || 'processed', revoked, revokeNote };
}
