// subscriptions.js — writing what a webhook event means into the subscriptions table.
//
// Separated from the event parsing (lib/webhook.js) and from the billing rules (lib/plans.js) so each
// can be read on its own: this file only knows how to store a decision somebody else made.
import { entitlement } from './plans.js';

// Idempotent by design. Razorpay retries any non-2xx, so the same charge can arrive several times, and
// a duplicate must not extend a term twice. The write is keyed on the subscription id and sets the end
// date to the one Razorpay sent rather than advancing our own - so applying the same event ten times
// lands on exactly the same row as applying it once.
export async function applySubscriptionEvent(pool, ev) {
  await pool.query(
    `UPDATE subscriptions
        SET status = ?, current_end = ?, updated_at = NOW()
      WHERE gateway_id = ? OR id = ?`,
    [ev.status, ev.currentEnd, ev.id, ev.id]);
  // The app still reads installs.plan, so it is kept in step with whatever the subscription now says.
  await syncInstallPlan(pool, ev.installId);
}

// installs.plan is the old free/paid flag every released app reads. It is now a cache of what the
// subscriptions table says, refreshed whenever that changes, so an old app and a new one never
// disagree about whether somebody has Pro.
export async function syncInstallPlan(pool, installId) {
  const [subs] = await pool.query(
    'SELECT plan_code, period, status, current_end FROM subscriptions WHERE install_id = ?', [installId]);
  // `rank` is a reserved word in MySQL 8 and TiDB (the RANK() window function), so it has to be
  // quoted here exactly as it is in the schema - an unquoted one is a syntax error, not a warning.
  const [plans] = await pool.query('SELECT code, `rank` FROM plans');
  const ent = entitlement(subs, plans);
  await pool.query('UPDATE installs SET plan = ? WHERE install_id = ?', [ent.plan, installId]);
  return ent;
}

// Everything this install has ever subscribed to, newest first. Used by /api/plan to work out both
// the entitlement and whether a renewal notice is due.
export async function subsFor(pool, installId) {
  const [rows] = await pool.query(
    `SELECT id, plan_code, period, amount, status, current_end, reminded_for
       FROM subscriptions WHERE install_id = ? ORDER BY started_at DESC`, [installId]);
  return rows;
}
