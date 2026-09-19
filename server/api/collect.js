// POST /api/collect - receives the app's anonymous usage counts.
// Deliberately never reads or logs the caller's IP address, headers or the request body.
import { parsePayload } from '../lib/validate.js';
import { getPool } from '../lib/db.js';
import { saveInstall } from '../lib/store.js';

const MAX_BODY_BYTES = 2048;

function cors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  cors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_BODY_BYTES) { res.statusCode = 413; return res.end(); }

  const parsed = parsePayload(req.body);
  if (!parsed.ok) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: parsed.error })); }

  try {
    await saveInstall(await getPool(), parsed.value);
    res.statusCode = 204;
    return res.end();
  } catch (_) {
    // The app ignores failures on purpose; say nothing about why.
    res.statusCode = 503;
    return res.end();
  }
}
