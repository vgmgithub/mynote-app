// POST /api/admin/plan { "installId": "...", "plan": "free" | "paid" } -> sets that install's plan.
// Open unless ADMIN_KEY is set. This is the only place a plan is ever changed.
//
// GET  /api/admin/plan?settings=1 -> the billing test clock.
// POST /api/admin/plan?settings=1 { enabled, monthly, annual, remindBefore } -> sets it.
// Folded in here rather than given a file of its own because Hobby allows twelve functions and twelve are in use.
// Both are admin writes behind the same ADMIN_KEY, both no-store, both fast - so the fold shares only things they
// already shared. The admin check below runs before either branch, so neither can be reached without it.
import { getPool } from '../../lib/db.js';
import { requireAdmin } from '../../lib/admin.js';
import { parsePlanChange, setPlan } from '../../lib/installs.js';
import { readClock, writeSetting, parseClockInput, CLOCK_KEY } from '../../lib/settings.js';

const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

async function handleSettings(req, res) {
  const pool = await getPool();
  if (req.method === 'GET') return json(res, 200, { clock: await readClock(pool) });
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const parsed = parseClockInput(req.body);
  if (!parsed.ok) return json(res, 400, { error: parsed.error });
  await writeSetting(pool, CLOCK_KEY, parsed.value);
  return json(res, 200, { clock: await readClock(pool) });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  // Admin first, for both branches: a settings write is as powerful as a plan change.
  if (requireAdmin(req)) { res.statusCode = 401; return res.end(); }
  if (req.query && req.query.settings === '1') {
    try { return await handleSettings(req, res); }
    catch (_) { return json(res, 503, { error: 'could not read or write the setting' }); }
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
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
