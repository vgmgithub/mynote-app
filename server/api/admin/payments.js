// GET  /api/admin/payments          -> what Razorpay has taken in the last 30 days, shaped for the Payments tab.
// POST /api/admin/payments { paymentId, amount?, revoke? } -> refund (whole by default) and, for a full refund, switch
//                                    that install back to Free.
//
// Reads need the admin key if one is set (like every admin read). A REFUND moves real money, so it is refused outright
// unless ADMIN_KEY is set: an open admin page must never be able to send money back.
import { getPool } from '../../lib/db.js';
import { requireAdmin, adminKeySet } from '../../lib/admin.js';
import { setPlan } from '../../lib/installs.js';
import { syncInstallPlan } from '../../lib/subscriptions.js';
import { listPayments, listInvoices, linkSubscriptions, shapePayments, parseRefund, refundPayment, WINDOW_DAYS } from '../../lib/payments.js';
import { readSetting, ensureSettings, RESET_KEY } from '../../lib/settings.js';

const json = (res, code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body)); };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET' && req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  if (requireAdmin(req)) { res.statusCode = 401; return res.end(); }

  if (req.method === 'GET') {
    const now = Math.floor(Date.now() / 1000);
    // After a staging reset (admin/plan.js ?reset=1) only payments made since then are shown: Razorpay's own
    // test payments cannot be deleted, and a fresh round of testing should not be read against the last one.
    let fromSec = now - (WINDOW_DAYS + 1) * 86400, resetAt = null;
    try {
      const p = await getPool(); await ensureSettings(p);
      const rs = await readSetting(p, RESET_KEY);
      const t = rs && rs.at ? Math.floor(new Date(rs.at).getTime() / 1000) : 0;
      if (t > fromSec) { fromSec = t; resetAt = rs.at; }
    } catch (_) { /* no settings table: the full window */ }
    const r = await listPayments({ env: process.env, fromSec });
    if (!r.ok) return json(res, r.status, { error: r.error });
    const shaped = shapePayments(r.items, now);
    // Each payment linked to its subscription through the invoice, so the page can group payments by person.
    // A failed listing leaves them unlinked (they show under "Other payments") rather than failing the tab.
    const inv = await listInvoices({ env: process.env, fromSec }).catch(() => null);
    if (inv && inv.ok) shaped.recent = linkSubscriptions(shaped.recent, inv.items);
    return json(res, 200, { ...shaped, resetAt, testMode: r.testMode, truncated: r.truncated, refundsEnabled: adminKeySet(), generatedAt: new Date(now * 1000).toISOString() });
  }

  if (!adminKeySet()) return json(res, 403, { error: 'Refunds are switched off until an ADMIN_KEY is set on this server.' });
  const input = parseRefund(req.body);
  if (!input.ok) return json(res, input.status, { error: input.error });
  let pool = null;
  const r = await refundPayment({
    env: process.env, input,
    // A subscription bought since schema/006 has its own row, and that row - not the cached free/paid
    // flag alone - is what the next plan check trusts (lib/installs.js planAnswer re-derives from it).
    // Ending the mandate there, then re-syncing, is what stops a refunded subscription from granting
    // itself right back the moment the app next asks. Pre-006 one-time payments have no such row, so
    // setPlan alone is still the whole story for those.
    // Takes whatever could be worked out. `installId` may be null when Razorpay gave nothing back to
    // trace it by - our own subscriptions table is then the authority, since the subscription id is its
    // primary key and carries the install beside it. That lookup depends on nothing Razorpay sends.
    revokePlan: async ({ installId, subscriptionId } = {}) => {
      pool = pool || await getPool();
      if (!installId && subscriptionId) {
        try {
          const [rows] = await pool.query('SELECT install_id FROM subscriptions WHERE id = ?', [subscriptionId]);
          installId = rows[0] && rows[0].install_id;
        } catch (_) { /* no table: nothing more to try */ }
      }
      if (!installId) return false;
      if (subscriptionId) {
        try {
          await pool.query(
            "UPDATE subscriptions SET status = 'cancelled', current_end = NOW(), updated_at = NOW() WHERE id = ?",
            [subscriptionId]);
          await syncInstallPlan(pool, installId);
        } catch (_) { /* no subscriptions table: the plain flag below is still the whole story */ }
      }
      // Written directly and unconditionally, even when the subscription row above was found and ended.
      // The Users tab's plan dropdown does exactly this one write and is the one path known to reach the
      // app - re-deriving the flag from entitlement() above is the more correct write for the NEXT check,
      // but this one is what guarantees THIS refund is not the one time it silently doesn't take.
      return setPlan(pool, installId, 'free');
    },
  });
  if (!r.ok) return json(res, r.status, { error: r.error });
  return json(res, 200, { success: true, refundId: r.refundId, amount: r.amount, status: r.status, revoked: r.revoked, revokeNote: r.revokeNote || null });
}
