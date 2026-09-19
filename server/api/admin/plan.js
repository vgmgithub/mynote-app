// POST /api/admin/plan { "installId": "...", "plan": "free" | "paid" } -> sets that install's plan.
// Open unless ADMIN_KEY is set. This is the only place a plan is ever changed.
import { getPool } from '../../lib/db.js';
import { requireAdmin } from '../../lib/admin.js';
import { parsePlanChange, setPlan } from '../../lib/installs.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  if (requireAdmin(req)) { res.statusCode = 401; return res.end(); }
  const parsed = parsePlanChange(req.body);
  if (!parsed.ok) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: parsed.error })); }
  try {
    const found = await setPlan(await getPool(), parsed.value.installId, parsed.value.plan);
    if (!found) { res.statusCode = 404; return res.end(); }
    res.statusCode = 204;
    return res.end();
  } catch (_) {
    res.statusCode = 503;
    return res.end();
  }
}
