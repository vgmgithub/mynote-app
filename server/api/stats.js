// GET /api/stats - aggregate counts for the /admin dashboard. Read-only; returns no row-level data.
// Cached at the edge so a public page cannot burn through the database's request quota. The dashboard's
// 'Refresh now' button adds a unique query string, which misses the cache and reads the database directly.
import { getPool } from '../lib/db.js';
import { STAT_QUERIES, shapeStats } from '../lib/stats.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(); }
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=600');
  res.setHeader('X-Robots-Tag', 'noindex');
  try {
    const pool = await getPool();
    const keys = Object.keys(STAT_QUERIES);
    const results = await Promise.all(keys.map((k) => pool.query(STAT_QUERIES[k]).then(([rows]) => rows)));
    const raw = Object.fromEntries(keys.map((k, i) => [k, results[i]]));
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(shapeStats(raw)));
  } catch (_) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'stats unavailable' }));
  }
}
