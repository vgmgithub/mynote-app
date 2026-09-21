// GET /api/admin/installs?limit=50&offset=0 -> the individual installs, newest activity first.
// Returns row-level data (install id, age, gender, region, features, plan). Open unless ADMIN_KEY is set.
import { getPool } from '../../lib/db.js';
import { requireAdmin } from '../../lib/admin.js';
import { listSql, parseList, shapeInstalls } from '../../lib/installs.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  if (requireAdmin(req)) { res.statusCode = 401; return res.end(); }
  try {
    const f = parseList(req.query);
    const pool = await getPool();
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
