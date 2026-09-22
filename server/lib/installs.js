// Row-level install listing and the paid/free switch, for the admin page.
// Unlike lib/stats.js this does return individual rows, which is why the admin page showing it is
// the one place personal data is visible. See lib/admin.js for how to lock it.
import { PLANS, PLATFORMS } from './validate.js';
import { entitlement } from './plans.js';

const SELECT_SQL = `SELECT install_id, alias, first_seen, last_seen, app_version, platform, plan,
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
// An anonymous name as a person would quote it, with or without the @: one word, as alias.js builds them.
const ALIAS_TEXT = /^@?[A-Za-z]{4,12}$/;

export function parseList(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  const plan = PLANS.includes(query.plan) ? query.plan : null;
  const platform = PLATFORMS.includes(query.platform) ? query.platform : null;
  const activity = Object.prototype.hasOwnProperty.call(ACTIVITY, query.activity) ? query.activity : null;
  const typed = typeof query.q === 'string' ? query.q.trim() : '';
  // One box, two kinds of answer: a name matches the alias column exactly, anything else is an id prefix. The
  // case typed is kept as it is; the column's collation matches regardless of case.
  const alias = ALIAS_TEXT.test(typed) ? typed.replace(/^@/, '') : null;
  const q = !alias && ID_PREFIX.test(typed) ? typed.toLowerCase() : null;
  const sort = Object.prototype.hasOwnProperty.call(SORTS, query.sort) ? query.sort : 'lastSeen';
  return { limit, offset, plan, platform, activity, q, alias, sort };
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
  // The name is stored, so it matches directly. Exact, not a prefix: a name is quoted in full or not at all.
  if (f.alias) { parts.push('alias = ?'); params.push(f.alias); }
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
      // The anonymous name the person sees in their app, so a complaint quoting it finds this row.
      alias: r.alias || '',
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
// What the app asks for on every online open. `plan` and `known` are what every released app reads
// and must never change shape.
//
// When there is a live subscription it also carries when the term ends and which one it is, so the
// app can say "renews on the 22nd" without a second request. That read is wrapped on its own: the
// subscriptions table does not exist until schema/006 has been run, and a plan check failing would
// lock a paying user out of Pro over a detail that is only ever decoration.
export async function planAnswer(pool, installId) {
  const plan = await getPlan(pool, installId);
  const answer = { plan: plan || 'free', known: plan !== null };
  if (answer.plan !== 'paid') return answer;
  try {
    const [subs] = await pool.query(
      'SELECT plan_code, period, status, current_end FROM subscriptions WHERE install_id = ?', [installId]);
    const [plans] = await pool.query('SELECT code, `rank` FROM plans');
    const ent = entitlement(subs, plans);
    if (ent.plan === 'paid') {
      answer.until = ent.until;       // null for lifetime, which never ends
      answer.period = ent.period;
      answer.code = ent.code;
      // Cancelled but paid up: the term still runs, and the app should say "ends" rather than "renews".
      answer.renewing = (subs || []).some((s) => s.status === 'active' && s.plan_code === ent.code);
    }
  } catch (_) { /* no subscriptions table yet: plan alone is still a correct answer */ }
  return answer;
}

export async function getPlan(pool, installId) {
  const [rows] = await pool.query('SELECT plan FROM installs WHERE install_id = ?', [installId]);
  return rows.length ? rows[0].plan : null;
}

// Marks an install paid after a payment has been verified (lib/razorpay.js verifyPayment). Unlike setPlan this
// also works for an install the server has never seen: somebody with the usage counts switched off has no row,
// and a verified payment must still switch Pro on. The row created then carries only the id and the plan, the
// same minimum forgetInstall keeps for a paid install. An existing row keeps everything else it had.
export async function grantPaid(pool, installId, now = new Date()) {
  await pool.query(
    `INSERT INTO installs (install_id, first_seen, last_seen, app_version, platform, plan)
     VALUES (?, ?, ?, 0, 'other', 'paid')
     ON DUPLICATE KEY UPDATE plan = 'paid'`,
    [installId, now, now],
  );
}
