// POST /api/verify-payment { installId, razorpay_subscription_id, razorpay_payment_id, razorpay_signature } -> { plan }
// Step 3 of the subscription flow: the first charge of a mandate, confirmed the instant checkout returns rather
// than waiting on a webhook that may take a moment to arrive. Every charge after this one is the webhook's job.
//
// POST /api/verify-payment { installId, razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { plan }
// The older one-time Orders flow (lib/razorpay.js), kept for 'lifetime' once that is on sale. The two request
// shapes are told apart by which id field is present, never by a flag the caller sets - a subscription id and
// an order id use different signature formulas, so guessing wrong would make a real payment fail to verify.
//
// POST /api/verify-payment?hook=1 — Razorpay's subscription webhook, folded in here rather than given a file of its
// own because Vercel's Hobby plan allows twelve functions and twelve are in use. The three share everything that
// folding forces them to share: all are Razorpay payment events, all authenticate by HMAC, all are no-store, all
// are fast. The webhook does NOT share an auth path with the other two, so its branch happens on the first line,
// before any parsing, and it never touches the CORS headers below - it is server-to-server and has no origin.
import { getPool } from '../lib/db.js';
import { matchOrigin } from '../lib/cors.js';
import { grantPaid } from '../lib/installs.js';
import { parseVerify, verifyPayment } from '../lib/razorpay.js';
import { parseConfirm, confirmSubscription } from '../lib/razorpay-subs.js';
import { rawBody, verifySignature, planFromEvent } from '../lib/webhook.js';
import { applySubscriptionEvent, syncInstallPlan } from '../lib/subscriptions.js';
import { readClock } from '../lib/settings.js';

const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

// Kept whole and separate: a webhook that wandered into the checkout path could grant Pro without a payment.
async function handleWebhook(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return json(res, 503, { error: 'webhooks are not configured on this server' });

  // Raw, before anything parses it: the signature is over the exact bytes sent.
  const raw = await rawBody(req);
  if (!verifySignature(raw, req.headers['x-razorpay-signature'], secret)) {
    return json(res, 401, { error: 'bad signature' });
  }
  let body = null;
  try { body = JSON.parse(raw); } catch (_) { return json(res, 400, { error: 'bad json' }); }

  const ev = planFromEvent(body);
  // An event we do not act on is still a 200: a non-2xx makes Razorpay retry it forever.
  if (!ev.ok) return json(res, 200, { ok: true, ignored: true });
  try {
    const pool = await getPool();
    await applySubscriptionEvent(pool, ev, await readClock(pool));
    return json(res, 200, { ok: true, event: ev.event });
  } catch (_) {
    // A 5xx here is deliberate: Razorpay retries, which is what we want when our own database blinked.
    return json(res, 503, { error: 'could not record the event' });
  }
}

export default async function handler(req, res) {
  if (req.query && req.query.hook === '1') return handleWebhook(req, res);

  const origin = matchOrigin(req.headers.origin, process.env.ALLOWED_ORIGINS);
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const body = req.body || {};
  // Told apart by shape, not by a caller-supplied flag: a subscription id and an order id are
  // different Razorpay objects with different signature formulas, so this has to be certain rather
  // than trusted.
  const isSubscription = typeof body.razorpay_subscription_id === 'string';

  try {
    const pool = await getPool();
    if (isSubscription) {
      const input = parseConfirm(body);
      if (!input.ok) return json(res, input.status, { error: input.error });
      const r = await confirmSubscription({ env: process.env, input, pool, sync: syncInstallPlan, clock: await readClock(pool) });
      if (!r.ok) return json(res, r.status, { error: r.error });
      // `until` travels back so the receipt saved on the device can state the term it bought, for good.
      // Worked out here and not on the device: under a test clock the end date is not something the app
      // could derive from the period on its own, and a receipt that guesses is worse than one that says
      // nothing. Absent for lifetime, which has no end.
      return json(res, 200, { success: true, plan: r.plan, until: r.until || null });
    }
    const input = parseVerify(body);
    if (!input.ok) return json(res, input.status, { error: input.error });
    const r = await verifyPayment({ env: process.env, input, pool, grant: grantPaid });
    if (!r.ok) return json(res, r.status, { error: r.error });
    return json(res, 200, { success: true, plan: r.plan });
  } catch (_) {
    return json(res, 500, { error: 'could not record the payment' });
  }
}
