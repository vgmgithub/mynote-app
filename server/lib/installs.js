// Row-level install listing and the paid/free switch, for the admin page.
// Unlike lib/stats.js this does return individual rows, which is why the admin page showing it is
// the one place personal data is visible. See lib/admin.js for how to lock it.
import { PLANS } from './validate.js';

export const LIST_SQL = `SELECT install_id, first_seen, last_seen, app_version, platform, plan,
    time_zone, language, age_band, gender,
    (SELECT GROUP_CONCAT(feature ORDER BY feature) FROM install_features f WHERE f.install_id = i.install_id) AS features
  FROM installs i
  ORDER BY last_seen DESC
  LIMIT ? OFFSET ?`;

export const COUNT_SQL = 'SELECT COUNT(*) AS n FROM installs';

export function parseList(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

export function shapeInstalls(rows, total, limit, offset) {
  return {
    total,
    limit,
    offset,
    installs: (rows || []).map((r) => ({
      installId: r.install_id,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      appVersion: r.app_version,
      platform: r.platform,
      plan: r.plan,
      timeZone: r.time_zone,
      language: r.language,
      ageBand: r.age_band,
      gender: r.gender,
      features: r.features ? String(r.features).split(',') : [],
    })),
  };
}

const INSTALL_ID = /^[0-9a-f-]{32,36}$/;

export function parsePlanChange(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const id = body.installId;
  if (typeof id !== 'string' || !INSTALL_ID.test(id)) return { ok: false, error: 'bad installId' };
  if (!PLANS.includes(body.plan)) return { ok: false, error: 'plan must be one of: ' + PLANS.join(', ') };
  return { ok: true, value: { installId: id, plan: body.plan } };
}

export async function setPlan(pool, installId, plan) {
  const [res] = await pool.query('UPDATE installs SET plan = ? WHERE install_id = ?', [plan, installId]);
  return res.affectedRows > 0;
}

// What the app is told each time it opens: its plan, and whether the server has a record of it at all.
// 'known: false' tells the app to send its details again (for example after the database was cleared).
export async function planAnswer(pool, installId) {
  const plan = await getPlan(pool, installId);
  return { plan: plan || 'free', known: plan !== null };
}

export async function getPlan(pool, installId) {
  const [rows] = await pool.query('SELECT plan FROM installs WHERE install_id = ?', [installId]);
  return rows.length ? rows[0].plan : null;
}
