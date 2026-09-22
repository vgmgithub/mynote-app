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
  res.setHeader('Content-Type', 'application/json');
  // The ceiling the sweep actually enforces, so the page can say how much of today's allowance is
  // gone. One company fetched = one upstream request, because a day already fetched is never fetched
  // again (lib/newsstore.js todayIsFresh) - so "checked today" IS the request count.
  const budget = parseBudget(process.env.NEWS_DAILY_BUDGET);
  return res.end(JSON.stringify({ ...shapeNewsAdmin(rows, followers), budget }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  if (requireAdmin(req)) { res.statusCode = 401; return res.end(); }
  try {
    const pool = await getPool();
    if (req.query && req.query.view === 'news') return await handleNews(res, pool);
    const f = parseList(req.query);
    const { rows: rowsSql, count: countSql, params } = listSql(f);
    const [[rows], [count]] = await Promise.all([
      pool.query(rowsSql, [...params, f.limit, f.offset]),
      pool.query(countSql, params),
    ]);
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(shapeInstalls(rows, Number(count[0].n), f.limit, f.offset)));
  } catch (_) {
    res.statusCode = 503;
    return res.end();
  }
}
