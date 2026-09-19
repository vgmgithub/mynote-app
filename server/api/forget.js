// POST /api/forget {"installId": "..."} - deletes everything stored for that install (right to erasure).
import { getPool } from '../lib/db.js';
import { forgetInstall } from '../lib/store.js';

const INSTALL_ID = /^[0-9a-f-]{32,36}$/;

export default async function handler(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const id = req.body && req.body.installId;
  if (typeof id !== 'string' || !INSTALL_ID.test(id)) { res.statusCode = 400; return res.end(); }
  try {
    await forgetInstall(await getPool(), id);
    res.statusCode = 204;
    return res.end();
  } catch (_) {
    res.statusCode = 503;
    return res.end();
  }
}
