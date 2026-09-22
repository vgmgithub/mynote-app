// GET /api/health - 200 if the database answers, 503 otherwise. Reveals nothing else.
//
// X-Commit is the short git SHA Vercel bakes in at build time (VERCEL_GIT_COMMIT_SHA), not a config
// value - so there is nothing to set and nothing that can drift. It exists because "redeploy" and
// "deploy the latest commit" are different buttons in Vercel and look identical from outside: this is
// the one place to check, from outside, which code is actually answering.
import { getPool } from '../lib/db.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Which deployment answered (production / preview), so a release can be confirmed from outside. Reveals nothing else.
  res.setHeader('X-Environment', process.env.VERCEL_ENV || 'unknown');
  res.setHeader('X-Commit', (process.env.VERCEL_GIT_COMMIT_SHA || 'unknown').slice(0, 7));
  try {
    await (await getPool()).query('SELECT 1');
    res.statusCode = 200;
    return res.end('ok');
  } catch (_) {
    res.statusCode = 503;
    return res.end('down');
  }
}
