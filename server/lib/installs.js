// Row-level install listing and the paid/free switch, for the admin page.
// Unlike lib/stats.js this does return individual rows, which is why the admin page showing it is
// the one place personal data is visible. See lib/admin.js for how to lock it.
import { PLANS, PLATFORMS } from './validate.js';

const SELECT_SQL = `SELECT install_id, first_seen, last_seen, app_version, platform, plan,
    time_zone, language, age_band, gender,
    (SELECT GROUP_CONCAT(feature ORDER BY feature) FROM install_features f WHERE f.install_id = i.install_id) AS features
  FROM installs i`;

// Kept for callers that want the whole list, unfiltered and newest first (the shape before filters existed).
export const LIST_SQL = SELECT_SQL + '\n  ORDER BY last_seen DESC\n  LIMIT ? OFFSET ?';

export const COUNT_SQL = 'SELECT COUNT(*) AS n FROM installs';

// Only these may reach the SQL, and only as a fixed fragment chosen by name - a filter value is never
// pasted into the statement. Anything unrecognised is dropped rather than refused, so a stale bookmark
// or a hand-typed query string can never turn into an error page or an injection.
const ACTIVITY = {
  active1: 'last_seen >= NOW() - INTERVAL 1 DAY',
  active7: 'last_seen >= NOW() - INTERVAL 7 DAY',
  active30: 'last_seen >= NOW() - INTERVAL 30 DAY',
  lapsed: 'last_seen < NOW() - INTERVAL 30 DAY',
};
const SORTS = { lastSeen: 'last_seen DESC', firstSeen: 'first_seen DESC', oldest: 'last_seen ASC' };
const ID_PREFIX = /^[0-9a-f-]{1,36}$/i;

export function parseList(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  const plan = PLANS.includes(query.plan) ? query.plan : null;
  const platform = PLATFORMS.includes(query.platform) ? query.platform : null;
  const activity = Object.prototype.hasOwnProperty.call(ACTIVITY, query.activity) ? query.activity : null;
  const q = typeof query.q === 'string' && ID_PREFIX.test(query.q.trim()) ? query.q.trim().toLowerCase() : null;
  const sort = Object.prototype.hasOwnProperty.call(SORTS, query.sort) ? query.sort : 'lastSeen';
  return { limit, offset, plan, platform, activity, q, sort };
}

// Builds the WHERE from the parsed filters: fragments are picked by name, every value stays a bound
// parameter, and the same clause is used for the rows and for the count so the two always agree.
export function listWhere(f = {}) {
  const parts = [];
  const params = [];
  if (f.plan) { parts.push('plan = ?'); params.push(f.plan); }
  if (f.platform) { parts.push('platform = ?'); params.push(f.platform); }
  if (f.activity && ACTIVITY[f.activity]) parts.push(ACTIVITY[f.activity]);
  if (f.q) { parts.push('install_id LIKE ?'); params.push(f.q + '%'); }
  return { sql: parts.length ? '\n  WHERE ' + parts.join(' AND ') : '', params };
}

export function listSql(f = {}) {
  const { sql, params } = listWhere(f);
  return {
    rows: SELECT_SQL + sql + '\n  ORDER BY ' + (SORTS[f.sort] || SORTS.lastSeen) + '\n  LIMIT ? OFFSET ?',
    count: 'SELECT COUNT(*) AS n FROM installs i' + sql,
    params,
  };
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
