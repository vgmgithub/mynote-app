import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { shapePayments, shapePayment, parseRefund, refundPayment, listPayments, dayIST } from '../lib/payments.js';
import { insights } from '../lib/insights.js';

const pub = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');

test('the admin page is an installable app: manifest per environment, service worker, icons, and the version matches', () => {
  const html = pub('admin.html'), sw = pub('admin-sw.js');
  assert.match(html, /<link rel="manifest" href="\/admin\.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  const stg = JSON.parse(pub('admin-staging.webmanifest')), prod = JSON.parse(pub('admin-production.webmanifest'));
  assert.equal(stg.name, 'MyNotes - Admin (staging)');
  assert.equal(prod.name, 'MyNotes - Admin');
  for (const m of [stg, prod]) {
    assert.equal(m.display, 'standalone');
    assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512') && m.icons.some((i) => i.purpose === 'maskable'));
    for (const i of m.icons) assert.doesNotThrow(() => readFileSync(new URL('../public' + i.src, import.meta.url)), i.src + ' exists');
  }
  const v = html.match(/const ADMIN_VERSION = (\d+);/)[1];
  assert.equal(sw.match(/mynotes-admin-v(\d+)/)[1], v, 'ADMIN_VERSION and the service worker cache must be the same number');
  assert.match(sw, /startsWith\('\/api\/'\)\) return;/, 'API responses are never cached');
  const vc = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const man = vc.rewrites.filter((r) => r.source === '/admin.webmanifest');
  assert.match(JSON.stringify(man[0]), /api\.viewsofvgm\.com[\s\S]*admin-production/, 'production host gets the production manifest');
  assert.match(man[1].destination, /staging/, 'everything else is staging');
  assert.match(html, /HOST === 'api\.viewsofvgm\.com' \? 'production'/, 'the page names its environment the same way');
});

test('Vercel Hobby allows 12 functions: the API must stay within that', () => {
  const count = (dir) => readdirSync(dir).reduce((n, f) => {
    const p = new URL(f, dir);
    return n + (statSync(p).isDirectory() ? count(new URL(f + '/', dir)) : 1);
  }, 0);
  const n = count(new URL('../api/', import.meta.url));
  assert.ok(n <= 12, 'too many serverless functions: ' + n);
});

const NOW = Date.UTC(2026, 8, 22, 6, 0) / 1000;      // 22 Sep 2026, 11:30 in India
const pay = (o) => ({ id: 'pay_' + Math.random().toString(36).slice(2, 9), order_id: 'order_X', amount: 39900, status: 'captured', method: 'upi', created_at: NOW - 3600, fee: 800, amount_refunded: 0, ...o });

test('payment totals: gross, refunds, net, rate, today, and days without payments are still on the chart', () => {
  const s = shapePayments([
    pay({}), pay({ created_at: NOW - 86400 * 2, method: 'card' }),
    pay({ amount_refunded: 39900, status: 'refunded', created_at: NOW - 86400 * 3 }),
    pay({ status: 'failed', error_code: 'BAD_REQUEST_ERROR', error_reason: 'payment_failed', error_description: 'Payment failed', fee: 0 }),
    pay({ status: 'created' }),
  ], NOW);
  assert.equal(s.totals.gross, 39900 * 3);
  assert.equal(s.totals.refunded, 39900);
  assert.equal(s.totals.net, 39900 * 2);
  assert.equal(s.totals.paidCount, 3);
  assert.equal(s.totals.failedCount, 1);
  assert.equal(s.totals.successRate, 75);
  assert.equal(s.totals.inFlight, 1);
  assert.equal(s.totals.today, 39900);
  assert.equal(s.daily.length, 30);
  assert.equal(s.daily.at(-1).day, dayIST(NOW));
  assert.equal(s.daily.filter((d) => d.amount).length, 2, 'the fully refunded day nets to nothing');
  assert.deepEqual(s.methods.map((m) => m.key + m.n), ['upi2', 'card1']);
  assert.equal(s.failures[0].key, 'payment_failed');
});

test('payments are counted in India\'s day, not UTC\'s', () => {
  const lateUtc = Date.UTC(2026, 8, 21, 20, 0) / 1000;         // 21 Sep 20:00 UTC = 22 Sep 01:30 IST
  assert.equal(dayIST(lateUtc), '2026-09-22');
});

test('a payment row never carries payer email or phone, and an empty account gives zeros, not errors', () => {
  const p = shapePayment({ id: 'pay_A', amount: 100, status: 'captured', email: 'a@b.c', contact: '+919999999999', created_at: 1 });
  assert.equal(JSON.stringify(p).match(/a@b\.c|9999/), null);
  const s = shapePayments([], NOW);
  assert.equal(s.totals.net, 0); assert.equal(s.totals.successRate, null); assert.equal(s.daily.length, 30);
});

test('listing follows Razorpay paging, and says which mode the key is in', async () => {
  const env = { RAZORPAY_KEY_ID: 'rzp_test_A', RAZORPAY_KEY_SECRET: 's' };
  let calls = 0;
  const f = async (url) => { calls++; const skip = Number(new URL(url).searchParams.get('skip')); return { status: 200, ok: true, json: async () => ({ items: Array.from({ length: skip < 200 ? 100 : 30 }, () => pay({})) }) }; };
  const r = await listPayments({ env, fetchImpl: f, fromSec: 1 });
  assert.equal(r.items.length, 230); assert.equal(calls, 3); assert.equal(r.testMode, true); assert.equal(r.truncated, false);
  assert.equal((await listPayments({ env: {}, fetchImpl: f, fromSec: 1 })).status, 503);
});

test('refund input is checked before anything is sent', () => {
  assert.equal(parseRefund({ paymentId: 'x' }).ok, false);
  assert.equal(parseRefund({ paymentId: 'pay_1; drop' }).ok, false);
  assert.equal(parseRefund({ paymentId: 'pay_1', amount: 10.5 }).ok, false);
  assert.equal(parseRefund({ paymentId: 'pay_1', amount: 50 }).ok, false);
  const ok = parseRefund({ paymentId: 'pay_1' });
  assert.deepEqual([ok.ok, ok.amount, ok.revoke], [true, null, true]);
});

const ENVK = { RAZORPAY_KEY_ID: 'rzp_test_A', RAZORPAY_KEY_SECRET: 's' };
function fakeRazor({ refundable = 39900, refunded = 0, refuse = false, subscriptionId = '',
  invoiceId = '', invoiceSubId = '', noNotes = false, orderNotes = true } = {}) {
  const log = [];
  const notes = noNotes ? {} : { installId: 'inst-1' };
  const f = async (url, opt = {}) => {
    log.push((opt.method || 'GET') + ' ' + url.replace('https://api.razorpay.com/v1', ''));
    if (url.endsWith('/refund')) return refuse
      ? { status: 400, ok: false, json: async () => ({ error: { description: 'Refund not allowed' } }) }
      : { status: 200, ok: true, json: async () => ({ id: 'rfnd_1', status: 'processed', amount: JSON.parse(opt.body).amount }) };
    if (url.includes('/invoices/')) return { status: 200, ok: true, json: async () => ({ subscription_id: invoiceSubId, notes: {} }) };
    if (url.includes('/orders/')) return { status: 200, ok: true, json: async () => ({ notes: (orderNotes && !noNotes) ? { installId: 'inst-1' } : {} }) };
    if (url.includes('/subscriptions/')) return { status: 200, ok: true, json: async () => ({ notes }) };
    return { status: 200, ok: true, json: async () => pay({ id: 'pay_1', amount: refundable + refunded, amount_refunded: refunded, subscription_id: subscriptionId, invoice_id: invoiceId }) };
  };
  return { f, log };
}

test('a full refund goes to Razorpay, then switches that install to Free', async () => {
  const { f, log } = fakeRazor(); const revoked = [];
  const r = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: null, revoke: true }, fetchImpl: f, revokePlan: async ({ installId }) => { revoked.push(installId); return true; } });
  assert.deepEqual([r.ok, r.amount, r.revoked], [true, 39900, true]);
  assert.deepEqual(revoked, ['inst-1']);
  assert.ok(log.some((l) => l.startsWith('POST /payments/pay_1/refund')));
});

// Every payment sold since subscriptions became the only thing on sale has no order of its own with our
// notes on it - the installId lives on the mandate. A full refund on one of these used to revoke nothing
// at all, because the old code only ever looked at the order.
test('a full refund on a SUBSCRIPTION payment (no order) still finds the install and revokes it', async () => {
  const { f, log } = fakeRazor({ subscriptionId: 'sub_1' }); const revoked = [];
  const r = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: null, revoke: true }, fetchImpl: f,
    revokePlan: async ({ installId, subscriptionId }) => { revoked.push([installId, subscriptionId]); return true; } });
  assert.deepEqual([r.ok, r.revoked], [true, true]);
  assert.deepEqual(revoked, [['inst-1', 'sub_1']], 'the subscription id travels along, so the caller can end that row too');
  assert.ok(log.some((l) => l.startsWith('GET /subscriptions/sub_1')), 'looked up on the subscription, not an order');
  assert.equal(log.some((l) => l.includes('/orders/')), false);
});

test('a partial refund does not touch the plan; asking for more than is left never reaches Razorpay', async () => {
  const a = fakeRazor(); const revoked = [];
  const r = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: 10000, revoke: true }, fetchImpl: a.f, revokePlan: async (id) => revoked.push(id) });
  assert.equal(r.ok, true); assert.equal(r.revoked, false); assert.equal(revoked.length, 0);
  const b = fakeRazor({ refundable: 5000, refunded: 34900 });
  const over = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: 6000, revoke: false }, fetchImpl: b.f });
  assert.equal(over.ok, false); assert.equal(over.status, 400);
  assert.ok(!b.log.some((l) => l.includes('/refund')), 'no refund request was sent');
  const gone = fakeRazor({ refundable: 0, refunded: 39900 });
  assert.equal((await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: null, revoke: true }, fetchImpl: gone.f })).ok, false);
});

test('when Razorpay refuses, the plan stays Pro and the reason is passed on', async () => {
  const { f } = fakeRazor({ refuse: true }); const revoked = [];
  const r = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: null, revoke: true }, fetchImpl: f, revokePlan: async (id) => revoked.push(id) });
  assert.equal(r.ok, false); assert.match(r.error, /Refund not allowed/); assert.equal(revoked.length, 0);
});

test('refunds are refused unless an ADMIN_KEY exists, and the check comes before any refund is attempted', () => {
  const src = readFileSync(new URL('../api/admin/payments.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!adminKeySet\(\)\) return json\(res, 403/);
  assert.ok(src.indexOf('!adminKeySet()) return json(res, 403') < src.indexOf('await refundPayment('));
});

// A refunded subscription's own row must be ended, not only the cached free/paid flag on installs - a
// row left 'active' with a future current_end grants itself right back the moment the app next asks
// (lib/installs.js planAnswer re-derives the plan from that row). This is what silently broke revoke
// once subscriptions became the default sale path: the old code only knew how to look an install up
// from an order's notes, and a subscription charge has no order of its own carrying those notes.
test('a subscription revoke ends that row (status + current_end), then re-syncs installs.plan from it', () => {
  const src = readFileSync(new URL('../api/admin/payments.js', import.meta.url), 'utf8');
  assert.match(src, /UPDATE subscriptions SET status = 'cancelled', current_end = NOW\(\)/);
  assert.match(src, /syncInstallPlan\(pool, installId\)/);
  // The plain flag is still the fallback for a pre-006 one-time payment, which has no subscriptions row.
  assert.match(src, /return setPlan\(pool, installId, 'free'\);/);
});

test('insights read the figures in words, and never fail on an empty or partial response', () => {
  assert.equal(insights({ headline: { total: 0 } })[0].title, 'No installs yet');
  const list = insights({ headline: { total: 100, paid: 4, active30: 40, active1: 12, stickiness: 30, justLapsed: 5, lapsed: 20 },
    freePlan: { atLimit: 9, atLimitPct: 30, limit: 5 }, versionHealth: { tracked: 50, behind: 3, onLatestPct: 60 },
    weekday: [{ name: 'Sunday', n: 9 }, { name: 'Monday', n: 3 }], newDaily: [{ day: 'a', n: 1 }],
    planPlatform: [{ key: 'android', total: 50, paid: 4, paidPct: 8 }], unused: ['vault'] });
  const titles = list.map((i) => i.title).join('|');
  for (const t of ['Pro conversion 4%', '9 at the free limit', 'Stickiness 30%', '5 just went quiet', '3 on an old build', 'Busiest day: Sunday', 'android converts best', '1 feature nobody picked']) assert.ok(titles.includes(t), t + ' in ' + titles);
  assert.doesNotThrow(() => insights({ headline: { total: 3, paid: 0 } }));
});

// admin.html is one big inline script. A syntax error anywhere in it - a duplicate `const`, a stray
// bracket - does not break one feature, it stops the whole script parsing and the page renders BLANK.
// That shipped once (admin v8 declared `const SVG` twice, clashing with the SVG namespace constant) and
// every other test stayed green, because nothing here had ever parsed the page's own JavaScript.
test('the admin page\'s inline script parses, so the page can never ship blank', () => {
  const page = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const blocks = page.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  assert.ok(blocks.length, 'the page has an inline script');
  for (const block of blocks) {
    const src = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    // new Function throws a SyntaxError on exactly what the browser would refuse to parse, and never
    // runs the body - so this checks the page without a DOM and without executing anything.
    assert.doesNotThrow(() => new Function(src), 'admin.html inline script must parse');
  }
});

// THE bug behind "refund with cancel ticked does nothing in the app". Razorpay's payment entity does not
// carry subscription_id - a subscription charge has an invoice_id, and an order_id that Razorpay minted
// itself, which carries none of our notes. The old chain checked only those last two, found nothing, and
// never called revokePlan at all, so the refund went through and the person quietly stayed on Pro.
test('a subscription charge is traced through its INVOICE, the field Razorpay actually sends', async () => {
  const { f, log } = fakeRazor({ invoiceId: 'inv_1', invoiceSubId: 'sub_9' });
  const revoked = [];
  const r = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: null, revoke: true }, fetchImpl: f,
    revokePlan: async ({ installId, subscriptionId }) => { revoked.push([installId, subscriptionId]); return true; } });
  assert.equal(r.revoked, true);
  assert.deepEqual(revoked, [['inst-1', 'sub_9']]);
  assert.ok(log.some((l) => l.startsWith('GET /invoices/inv_1')), 'the invoice is what links a charge to its mandate');
});

// Even when Razorpay hands back nothing usable, the subscription id alone is enough: our own table has it
// as a primary key with the install beside it, so the caller can finish the job from the database.
test('with no notes anywhere, the subscription id is still handed over for a database lookup', async () => {
  const { f } = fakeRazor({ invoiceId: 'inv_1', invoiceSubId: 'sub_9', noNotes: true });
  const seen = [];
  const r = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: null, revoke: true }, fetchImpl: f,
    revokePlan: async (args) => { seen.push(args); return true; } });
  assert.equal(r.revoked, true);
  assert.deepEqual(seen, [{ installId: null, subscriptionId: 'sub_9' }]);
});

// A refund that went through but could not find whose Pro to take away is the one case somebody has to
// finish by hand in the Users tab - so it has to say so, not report a silent success.
test('a refund that cannot identify the install says why, instead of claiming it revoked', async () => {
  const { f } = fakeRazor({ noNotes: true });
  const r = await refundPayment({ env: ENVK, input: { paymentId: 'pay_1', amount: null, revoke: true }, fetchImpl: f,
    revokePlan: async () => false });
  assert.equal(r.ok, true);
  assert.equal(r.revoked, false);
  assert.match(r.revokeNote, /could not work out which install|no subscription or order/);
});
