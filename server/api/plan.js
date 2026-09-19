// POST /api/plan { "installId": "..." } -> { "plan": "free" | "paid", "known": true | false }
// The app calls this each time it opens while online, to learn whether this install has Pro.
// Read-only: it never creates or changes a row, and an install it has never seen is simply 'free'.
import { getPool } from '../lib/db.js';
import { matchOrigin } from '../lib/cors.js';
import { planAnswer } from '../lib/installs.js';

const INSTALL_ID = /^[0-9a-f-]{32,36}$/;

export default async function handler(req, res) {
  const origin = matchOrigin(req.headers.origin, process.env.ALLOWED_ORIGINS);
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const id = req.body && req.body.installId;
  if (typeof id !== 'string' || !INSTALL_ID.test(id)) { res.statusCode = 400; return res.end(); }
  try {
    const answer = await planAnswer(await getPool(), id);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(answer));
  } catch (_) {
    res.statusCode = 503;
    return res.end();
  }
}
