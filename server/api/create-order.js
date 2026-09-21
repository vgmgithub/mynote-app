// POST /api/create-order { "installId": "..." } -> { order_id, amount, currency, key_id }
// Step 1 of Razorpay Standard Checkout. The price is set here, never by the app (see lib/razorpay.js).
// It writes nothing to the database: it only asks Razorpay to open an order.
import { matchOrigin } from '../lib/cors.js';
import { parseCreate, createOrder } from '../lib/razorpay.js';

const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

export default async function handler(req, res) {
  const origin = matchOrigin(req.headers.origin, process.env.ALLOWED_ORIGINS);
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const input = parseCreate(req.body);
  if (!input.ok) return json(res, input.status, { error: input.error });

  const r = await createOrder({ env: process.env, installId: input.installId });
  if (!r.ok) return json(res, r.status, { error: r.error });
  return json(res, 200, { order_id: r.order_id, amount: r.amount, currency: r.currency, key_id: r.key_id });
}
