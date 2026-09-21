// POST /api/verify-payment { installId, razorpay_order_id, razorpay_payment_id, razorpay_signature } -> { plan }
// Step 3 of Razorpay Standard Checkout. Only a payment whose signature checks out, that Razorpay confirms as paid for
// the Pro price, and that was opened for THIS install, switches Pro on. Anything else is a 400 and writes nothing.
import { getPool } from '../lib/db.js';
import { matchOrigin } from '../lib/cors.js';
import { grantPaid } from '../lib/installs.js';
import { parseVerify, verifyPayment } from '../lib/razorpay.js';

const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

export default async function handler(req, res) {
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
