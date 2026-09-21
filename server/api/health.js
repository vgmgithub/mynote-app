// GET /api/health - 200 if the database answers, 503 otherwise. Reveals nothing else.
import { getPool } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Which deployment answered (production / preview), so a release can be confirmed from outside. Reveals nothing else.
  res.setHeader('X-Environment', process.env.VERCEL_ENV || 'unknown');
  try {
    await (await getPool()).query('SELECT 1');
    res.statusCode = 200;
    return res.end('ok');
  } catch (_) {
    res.statusCode = 503;
    return res.end('down');
  }
}
