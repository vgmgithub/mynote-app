// POST /api/admin/plan { "installId": "...", "plan": "free" | "paid" } -> sets that install's plan.
// Open unless ADMIN_KEY is set. This is the only place a plan is ever changed.
//
// GET  /api/admin/plan?settings=1 -> the billing test clock.
// POST /api/admin/plan?settings=1 { enabled, monthly, annual, remindBefore } -> sets it.
//
// POST /api/admin/plan?term=1 { subscriptionId, action: 'clock' | 'expire' } -> re-dates a subscription
// that already exists. WHY this has to exist: the test clock is only ever consulted when a subscription
// is CONFIRMED (lib/razorpay-subs.js) or renewed by webhook, because that is the only moment there is a
// date to write. Switching the clock on afterwards therefore changes nothing about a term already
// bought, which makes it look broken - there is no way to test a reminder or an expiry without buying
// something new each time. 'clock' re-dates the term from now under the current clock, 'expire' ends it
// outright. Both then re-derive installs.plan, so the app drops to Free on its next check through
// exactly the normal expiry path - nothing here is a shortcut around the real rules.
//
// Folded in here rather than given a file of its own because Hobby allows twelve functions and twelve are in use.
// All are admin writes behind the same ADMIN_KEY, all no-store, all fast - so the fold shares only things they
// already shared. The admin check below runs before every branch, so none can be reached without it.
import { getPool } from '../../lib/db.js';
import { requireAdmin } from '../../lib/admin.js';
import { parsePlanChange, setPlan } from '../../lib/installs.js';
import { syncInstallPlan } from '../../lib/subscriptions.js';
import { periodEnd } from '../../lib/plans.js';
import { readClock, writeSetting, parseClockInput, CLOCK_KEY, RESET_KEY, ensureSettings } from '../../lib/settings.js';
import { adminKeySet } from '../../lib/admin.js';
import { resetAllowed, RESET_WORD } from '../../lib/testreset.js';
import { keysFrom, cancelAtGateway } from '../../lib/razorpay-subs.js';

const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

async function handleSettings(req, res) {
  const pool = await getPool();
  if (req.method === 'GET') return json(res, 200, { clock: await readClock(pool) });
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const parsed = parseClockInput(req.body);
  if (!parsed.ok) return json(res, 400, { error: parsed.error });
  await writeSetting(pool, CLOCK_KEY, parsed.value);
  const clock = await readClock(pool);
  // WHY: the clock used to touch only the NEXT payment, so a tester who saved it while a subscription
  // was already running saw nothing change - the live term kept its real 30 days and looked like the
  // save had failed. Switching the clock on now re-dates every live term from now under it (and
  // re-arms its reminder), exactly what the per-row "Re-date" button does, for all of them at once.
  // Switching it off leaves terms alone: nothing is ever extended by turning a test tool off.
  let redated = 0;
  if (clock.enabled) {
    try {
      // Only installs that are on Pro: one set to Free by hand must not be switched back on by a clock.
      const [live] = await pool.query(
        `SELECT s.id, s.install_id, s.period FROM subscriptions s JOIN installs i ON i.install_id = s.install_id
          WHERE s.status = 'active' AND i.plan = 'paid' AND (s.current_end IS NULL OR s.current_end > ?)`, [new Date()]);
      for (const s of live || []) {
        const end = periodEnd(s.period, new Date(), clock);
        if (!end) continue;   // lifetime has no end to move
        await pool.query('UPDATE subscriptions SET current_end = ?, reminded_for = NULL, updated_at = NOW() WHERE id = ?', [end, s.id]);
        await syncInstallPlan(pool, s.install_id);
        redated++;
      }
    } catch (_) { /* no subscriptions table yet: the clock itself is still saved */ }
  }
  return json(res, 200, { clock, redated });
}

// Re-dates one existing subscription. The row is the source of truth for entitlement, so moving its end
// date is all it takes - no flags are set by hand and installs.plan is re-derived rather than written,
// which is what keeps this honest: if the rules say they are still paid, they stay paid.
async function handleTerm(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const b = req.body || {};
  const id = typeof b.subscriptionId === 'string' ? b.subscriptionId.trim() : '';
  if (!/^sub_[A-Za-z0-9]+$/.test(id)) return json(res, 400, { error: 'bad subscription id' });
  const action = b.action === 'expire' ? 'expire' : 'clock';
  const pool = await getPool();
  const [rows] = await pool.query('SELECT install_id, period, status FROM subscriptions WHERE id = ?', [id]);
  if (!rows.length) return json(res, 404, { error: 'no such subscription' });
  const { install_id: installId, period } = rows[0];

  const clock = await readClock(pool);
  // 'expire' is a second ago rather than exactly now: the entitlement check is a strict `>`, so a date
  // equal to now would still read as live for the moment it takes to write it.
  const end = action === 'expire' ? new Date(Date.now() - 1000) : periodEnd(period, new Date(), clock);
  if (!end) return json(res, 400, { error: 'that subscription has no end date to move (lifetime)' });
  await pool.query('UPDATE subscriptions SET current_end = ?, reminded_for = NULL, updated_at = NOW() WHERE id = ?', [end, id]);
  // Cleared above so the reminder re-arms: reminded_for holds the end date it was raised for, and a term
  // that has just been re-dated has not been warned about yet.
  const ent = await syncInstallPlan(pool, installId);
  return json(res, 200, {
    subscriptionId: id, installId, period, action,
    currentEnd: end.toISOString(), plan: ent.plan,
    clock: { enabled: clock.enabled, monthly: clock.monthly, annual: clock.annual, remindBefore: clock.remindBefore },
  });
}

// POST /api/admin/plan?reset=1 { confirm: 'RESET' } -> staging only: every subscription deleted (its test
// mandate cancelled at Razorpay first, so it never renews), every install back on Free, and the Payments tab
// starting afresh from now (Razorpay's own test payments cannot be deleted, so older ones are hidden).
// Installs, usage and news are kept: this is for starting a new round of payment tests, not a wipe.
async function handleReset(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const gate = resetAllowed({ projectUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL, host: req.headers && req.headers.host });
  if (!gate.ok) return json(res, 403, { error: gate.why });
  // It deletes rows, so an open admin page (no key set) must not be able to do it.
  if (!adminKeySet()) return json(res, 403, { error: 'Set an ADMIN_KEY on this server before resetting test data.' });
  const b = req.body || {};
  if (b.confirm !== RESET_WORD) return json(res, 400, { error: 'Type ' + RESET_WORD + ' to confirm.' });
  const pool = await getPool();
  const [subs] = await pool.query("SELECT id FROM subscriptions WHERE status IN ('active', 'created', 'authenticated', 'halted')");
  const keys = keysFrom(process.env);
  let cancelled = 0;
  if (keys) {
    const results = await Promise.all((subs || []).map((s) => cancelAtGateway({ keys, id: s.id }).catch(() => false)));
    cancelled = results.filter(Boolean).length;
  }
  const [del] = await pool.query('DELETE FROM subscriptions');
  const [freed] = await pool.query("UPDATE installs SET plan = 'free' WHERE plan = 'paid'");
  const at = new Date().toISOString();
  await ensureSettings(pool);
  await writeSetting(pool, RESET_KEY, { at });
  return json(res, 200, { deleted: del.affectedRows || 0, cancelled, freed: freed.affectedRows || 0, since: at });
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
  if (req.query && req.query.reset === '1') {
    try { return await handleReset(req, res); }
    catch (_) { return json(res, 503, { error: 'could not reset the test data' }); }
  }
  if (req.query && req.query.term === '1') {
    try { return await handleTerm(req, res); }
    catch (_) { return json(res, 503, { error: 'could not re-date that subscription' }); }
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
