// POST /api/collect - receives the app's anonymous usage counts.
// Deliberately never reads or logs the caller's IP address or stores the request body. It reads only the
// Origin header (to answer CORS) and Content-Length (to refuse oversized bodies).
import { parsePayload } from '../lib/validate.js';
import { getPool } from '../lib/db.js';
import { saveInstall, claimAlias } from '../lib/store.js';
import { matchOrigin } from '../lib/cors.js';

const MAX_BODY_BYTES = 2048;

function cors(req, res) {
  const origin = matchOrigin(req.headers.origin, process.env.ALLOWED_ORIGINS);
  if (origin) {
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
    const pool = await getPool();
    await saveInstall(pool, parsed.value);
    // Settle the anonymous name: the app proposes one, the database decides. Answering with it lets an app that
    // named itself offline pick up the name it actually has.
    const alias = await claimAlias(pool, parsed.value.installId, parsed.value.alias, parsed.value.gender);
    if (alias) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ alias }));
    }
    res.statusCode = 204;
    return res.end();
  } catch (_) {
    // The app ignores failures on purpose; say nothing about why.
    res.statusCode = 503;
    return res.end();
  }
}
