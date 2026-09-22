// POST /api/verify-payment { installId, razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { plan }
// Step 3 of Razorpay Standard Checkout. Only a payment whose signature checks out, that Razorpay confirms as paid for
// the Pro price, and that was opened for THIS install, switches Pro on. Anything else is a 400 and writes nothing.
//
// POST /api/verify-payment?hook=1 — Razorpay's subscription webhook, folded in here rather than given a file of its
// own because Vercel's Hobby plan allows twelve functions and twelve are in use. The two share everything that
// folding forces them to share: both are Razorpay payment events, both authenticate by HMAC over a signature header,
// both are no-store, both are fast. They do NOT share an auth path, so the branch happens on the first line, before
// any parsing, and the webhook never touches the CORS headers below - it is server-to-server and has no origin.
import { getPool } from '../lib/db.js';
import { matchOrigin } from '../lib/cors.js';
import { grantPaid } from '../lib/installs.js';
import { parseVerify, verifyPayment } from '../lib/razorpay.js';
import { rawBody, verifySignature, planFromEvent } from '../lib/webhook.js';
import { applySubscriptionEvent } from '../lib/subscriptions.js';

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
    await applySubscriptionEvent(await getPool(), ev);
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

  const input = parseVerify(req.body);
  if (!input.ok) return json(res, input.status, { error: input.error });

  try {
    const pool = await getPool();
    const r = await verifyPayment({ env: process.env, input, pool, grant: grantPaid });
    if (!r.ok) return json(res, r.status, { error: r.error });
    return json(res, 200, { success: true, plan: r.plan });
  } catch (_) {
    return json(res, 500, { error: 'could not record the payment' });
  }
}
