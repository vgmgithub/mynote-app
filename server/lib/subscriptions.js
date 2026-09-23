// subscriptions.js — writing what a webhook event means into the subscriptions table.
//
// Separated from the event parsing (lib/webhook.js) and from the billing rules (lib/plans.js) so each
// can be read on its own: this file only knows how to store a decision somebody else made.
import { entitlement, periodEnd } from './plans.js';

// Idempotent by design. Razorpay retries any non-2xx, so the same charge can arrive several times, and
// a duplicate must not extend a term twice. The write is keyed on the subscription id and sets the end
// date to the one Razorpay sent rather than advancing our own - so applying the same event ten times
// lands on exactly the same row as applying it once.
//
// `clock` (lib/settings.js readClock) is the one exception to trusting Razorpay's date: Razorpay's own
// Plan bills on a real calendar cadence regardless of what we ask, so a renewal charged while the test
// clock is on still needs its end date shortened to match, the same way the first charge does
// (lib/razorpay-subs.js confirmSubscription). Real time (clock disabled or not passed) is unaffected.
export async function applySubscriptionEvent(pool, ev, clock = null) {
  let currentEnd = ev.currentEnd;
  if (clock && clock.enabled) {
    const [rows] = await pool.query('SELECT period FROM subscriptions WHERE gateway_id = ? OR id = ?', [ev.id, ev.id]);
    const period = rows[0] && rows[0].period;
    // From the start of the term Razorpay records, so a repeated delivery of the same charge lands on
    // the same end date (and agrees with the one confirmSubscription wrote) instead of creeping later.
    if (period) currentEnd = periodEnd(period, ev.currentStart || new Date(), clock);
  }
  await pool.query(
    `UPDATE subscriptions
        SET status = ?, current_end = ?, updated_at = NOW()
      WHERE gateway_id = ? OR id = ?`,
    [ev.status, currentEnd, ev.id, ev.id]);
  // The app still reads installs.plan, so it is kept in step with whatever the subscription now says.
  await syncInstallPlan(pool, ev.installId);
}

// installs.plan is the old free/paid flag every released app reads. It is now a cache of what the
// subscriptions table says, refreshed whenever that changes, so an old app and a new one never
// disagree about whether somebody has Pro.
export async function syncInstallPlan(pool, installId) {
  const [subs] = await pool.query(
    'SELECT id, plan_code, period, status, current_end, started_at FROM subscriptions WHERE install_id = ?', [installId]);
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
