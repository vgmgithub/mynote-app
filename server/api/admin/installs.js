// GET /api/admin/installs?limit=50&offset=0 -> the individual installs, newest activity first.
// Returns row-level data (install id, age, gender, region, features, plan). Open unless ADMIN_KEY is set.
//
// GET /api/admin/installs?view=news -> the news archive shaped the way the app's Feed shows it:
// one entry per company, a verdict per day, today split out, with how many people follow each.
// Folded in here rather than given a file of its own because Vercel's Hobby plan allows twelve
// functions and twelve are in use. The two share what folding forces them to share: both are admin
// reads of row-level data, both behind the same ADMIN_KEY, both no-store, both fast. The admin check
// runs before the branch, so neither path can be reached without it.
import { getPool } from '../../lib/db.js';
import { requireAdmin } from '../../lib/admin.js';
import { listSql, parseList, shapeInstalls } from '../../lib/installs.js';
import { shapeNewsAdmin } from '../../lib/newsadmin.js';
import { parseBudget } from '../../lib/cron.js';
import { readClock } from '../../lib/settings.js';

// The archive window the app itself reads (lib/news.js ARCHIVE_DAYS keeps the rows; this is how far
// back the page shows), and a ceiling so one huge account cannot make this a slow query.
const NEWS_DAYS = 7;
const MAX_ROWS = 600;

async function handleNews(res, pool) {
  const since = new Date(Date.now() - (NEWS_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const [rows] = await pool.query(
    `SELECT name_key, day, name, payload, fetched_at FROM news_archive
      WHERE day >= ? ORDER BY day DESC LIMIT ?`, [since, MAX_ROWS]);
  // Followers are counted the same way the Stocks tab counts them: distinct hashed followers in the
  // most recent week, never a person and never a portfolio.
  const [fol] = await pool.query(
    `SELECT name_key, COUNT(DISTINCT follower) AS n FROM stock_usage
      WHERE week = (SELECT MAX(week) FROM stock_usage) GROUP BY name_key`);
  const followers = new Map(fol.map((r) => [r.name_key, Number(r.n) || 0]));
  // Which market each company trades in, from any week (schema/005). Wrapped: a database without that
  // column still shows the news, just without the India / US split.
  let markets = new Map();
  try {
    const [mk] = await pool.query(
      'SELECT name_key, MAX(market) AS market FROM stock_usage WHERE market IS NOT NULL GROUP BY name_key');
    markets = new Map(mk.map((r) => [r.name_key, r.market]));
  } catch (_) { /* no market column yet */ }
  res.setHeader('Content-Type', 'application/json');
  // The ceiling the sweep actually enforces, so the page can say how much of today's allowance is
  // gone. One company fetched = one upstream request, because a day already fetched is never fetched
  // again (lib/newsstore.js todayIsFresh) - so "checked today" IS the request count.
  const budget = parseBudget(process.env.NEWS_DAILY_BUDGET);
  return res.end(JSON.stringify({ ...shapeNewsAdmin(rows, followers, undefined, markets), budget }));
}

// Who is on what, and when each term ends. Row-level like the installs list beside it, and behind the
// same key. The test clock rides along because the two are always read together: a subscription that
// expires in an hour only makes sense next to the clock that made it an hour.
async function handleSubs(res, pool) {
  // The alias is joined in here rather than looked up per row on the page: a person reading this list
  // wants the name they'd recognise, the same as the Users tab, and a raw install id means nothing to
  // anybody until it is copied out and searched for.
  const [subs] = await pool.query(
    `SELECT sub.id, sub.install_id, sub.plan_code, sub.period, sub.amount, sub.currency, sub.status,
            sub.started_at, sub.current_end, sub.reminded_for, sub.gateway_id, i.alias
       FROM subscriptions sub
       LEFT JOIN installs i ON i.install_id = sub.install_id
      ORDER BY sub.started_at DESC LIMIT 200`);
  const [prices] = await pool.query(
    'SELECT plan_code, period, amount, currency, label, active, gateway_plan_id FROM plan_prices ORDER BY plan_code, amount');
  const now = Date.now();
  const rows = subs.map((s) => {
    const end = s.current_end ? new Date(s.current_end) : null;
    return {
      id: s.id, installId: s.install_id, alias: s.alias || '', plan: s.plan_code, period: s.period,
      amount: Number(s.amount), currency: s.currency, status: s.status,
      startedAt: s.started_at ? new Date(s.started_at).toISOString() : null,
      currentEnd: end ? end.toISOString() : null,
      // Pre-computed so the page never re-derives "is this still live" in three places and disagrees.
      live: s.status === 'active' && (!end || end.getTime() > now),
      msLeft: end ? end.getTime() - now : null,
      gatewayId: s.gateway_id || null,
    };
  });
  const clock = await readClock(pool);
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({
    subscriptions: rows,
    prices: prices.map((p) => ({ plan: p.plan_code, period: p.period, amount: Number(p.amount),
      currency: p.currency, label: p.label, active: !!p.active, linked: !!p.gateway_plan_id })),
    clock,
    totals: {
      total: rows.length,
      live: rows.filter((r) => r.live).length,
      monthly: rows.filter((r) => r.live && r.period === 'monthly').length,
      annual: rows.filter((r) => r.live && r.period === 'annual').length,
      endingSoon: rows.filter((r) => r.live && r.msLeft != null && r.msLeft < 3 * 86400000).length,
    },
  }));
}

// Which subscription each listed install is on, so a card can say Monthly or Annual rather than only
// Free or Pro. Done as its own query and its own try/catch rather than a join: the subscriptions
// table does not exist until schema/006 has been run, and the Users list has to keep working without
// it. Only the installs on this page are looked up, so the list stays one page's worth of work.
async function attachSubscriptions(pool, installs) {
  const ids = (installs || []).filter((u) => u.plan === 'paid').map((u) => u.installId);
  if (!ids.length) return;
  try {
    const [rows] = await pool.query(
      `SELECT install_id, period, status, current_end FROM subscriptions
        WHERE install_id IN (${ids.map(() => '?').join(',')}) ORDER BY started_at DESC`, ids);
    const now = Date.now();
    const best = new Map();
    for (const r of rows) {
      // Newest first from the query, so the first row seen for an install is the one to show.
      if (best.has(r.install_id)) continue;
      const end = r.current_end ? new Date(r.current_end) : null;
      best.set(r.install_id, {
        period: r.period, status: r.status,
        currentEnd: end ? end.toISOString() : null,
        live: r.status === 'active' && (!end || end.getTime() > now),
      });
    }
    for (const u of installs) if (best.has(u.installId)) u.subscription = best.get(u.installId);
  } catch (_) { /* no subscriptions table yet: the list is still correct without the period */ }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  if (requireAdmin(req)) { res.statusCode = 401; return res.end(); }
  try {
    const pool = await getPool();
    if (req.query && req.query.view === 'news') return await handleNews(res, pool);
    if (req.query && req.query.view === 'subs') return await handleSubs(res, pool);
    const f = parseList(req.query);
    const { rows: rowsSql, count: countSql, params } = listSql(f);
    const [[rows], [count]] = await Promise.all([
      pool.query(rowsSql, [...params, f.limit, f.offset]),
      pool.query(countSql, params),
    ]);
    const shaped = shapeInstalls(rows, Number(count[0].n), f.limit, f.offset);
    await attachSubscriptions(pool, shaped.installs);
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(shaped));
  } catch (_) {
    res.statusCode = 503;
    return res.end();
  }
}
