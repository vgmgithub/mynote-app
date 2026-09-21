// Storage for the news proxy: the shared article cache and the per-install daily counter.
//
// Both tables are created on demand as well as by schema/003, so a deploy works before the migration is
// run. Neither table ever holds a stock name against an install id.
import { cacheKeyFor, isFresh, weekKey, installHash, dayStr, ARCHIVE_DAYS, PROVIDER_BACKOFF_MS } from './news.js';

// One row per company per day, kept for ARCHIVE_DAYS. It is both the cache and the archive: today's row
// saves an upstream call, and the older rows are what somebody who has not opened the app for a few
// days gets back, so a quiet week does not leave a hole in their Feed.
const CACHE_DDL = `CREATE TABLE IF NOT EXISTS news_archive (
  name_key   VARCHAR(80) NOT NULL,
  day        DATE        NOT NULL,
  fetched_at DATETIME    NOT NULL,
  name       VARCHAR(80) NOT NULL,
  payload    MEDIUMTEXT  NOT NULL,
  PRIMARY KEY (name_key, day),
  KEY idx_news_archive_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
const QUOTA_DDL = `CREATE TABLE IF NOT EXISTS news_quota (
  install_id VARCHAR(40) NOT NULL,
  day        DATE        NOT NULL,
  n          INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

// `name` is the company as typed, kept so the dashboard can show a readable list; `follower` is the
// weekly one-way hash, never an install id. See lib/news.js for why it rotates.
const USAGE_DDL = `CREATE TABLE IF NOT EXISTS stock_usage (
  name_key VARCHAR(80) NOT NULL,
  week     VARCHAR(8)  NOT NULL,
  follower VARCHAR(32) NOT NULL,
  name     VARCHAR(80) NOT NULL,
  PRIMARY KEY (name_key, week, follower),
  KEY idx_stock_usage_week (week)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

// One row, holding when the provider last refused us. Reusing news_quota would have muddled a
// per-install count with a server-wide fact, so it gets its own tiny table.
const STATE_DDL = `CREATE TABLE IF NOT EXISTS news_state (
  k  VARCHAR(32) NOT NULL,
  at DATETIME    NOT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let ready = false;
export async function ensureNewsTables(pool) {
  if (ready) return;
  await pool.query(CACHE_DDL);
  await pool.query(QUOTA_DDL);
  await pool.query(USAGE_DDL);
  await pool.query(STATE_DDL);
  ready = true;
}

// One row per company per follower per week. INSERT IGNORE on the natural key means asking about the
// same stock ten times in a week is still one follower. Without a secret configured nothing is recorded
// at all, because a hash without one could be reversed by trying install ids.
export async function recordStockUse(pool, name, installId, now = new Date()) {
  const secret = process.env.NEWS_HASH_SECRET;
  if (!secret) return false;
  try {
    const week = weekKey(now);
    const nameKey = cacheKeyFor(name);
    // The company goes into the hash too, so one person is a different value for every stock and the
    // rows cannot be grouped back into anybody's list of holdings.
    const follower = await installHash(installId, secret, week, nameKey);
    await pool.query('INSERT IGNORE INTO stock_usage (name_key, week, follower, name) VALUES (?, ?, ?, ?)',
      [nameKey, week, follower, String(name).slice(0, 80)]);
    return true;
  } catch (_) { return false; }   // popularity is best effort: it never fails a news request
}

// Every archived day for this company from `since` onwards, oldest first, ready to hand back.
export async function readArchive(pool, name, since) {
  const [rows] = await pool.query(
    'SELECT day, fetched_at, payload FROM news_archive WHERE name_key = ? AND day >= ? ORDER BY day',
    [cacheKeyFor(name), since],
  );
  return (rows || []).map((r) => {
    let data = [];
    try { data = JSON.parse(r.payload); } catch (_) { /* a corrupt row reads as an empty day */ }
    return { day: dayStr(new Date(r.day).getTime()), fetchedAt: r.fetched_at, data };
  });
}

// Is today's row already good enough to answer with? Only then is an upstream call skipped.
export function todayIsFresh(days, now = Date.now()) {
  const today = days.find((d) => d.day === dayStr(now));
  return !!(today && isFresh(today.fetchedAt, now));
}

export async function writeDay(pool, name, articles, now = new Date()) {
  await pool.query(
    `INSERT INTO news_archive (name_key, day, fetched_at, name, payload) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE fetched_at = VALUES(fetched_at), payload = VALUES(payload)`,
    [cacheKeyFor(name), dayStr(now.getTime()), now, String(name).slice(0, 80), JSON.stringify(articles)],
  );
}

// Counts one upstream call against this install's day and says whether it was allowed. A cache hit never
// gets here, so a normal day's browsing costs nothing against the limit.
export async function takeQuota(pool, installId, limit, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  await pool.query('INSERT INTO news_quota (install_id, day, n) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE n = n + 1', [installId, day]);
  const [rows] = await pool.query('SELECT n FROM news_quota WHERE install_id = ? AND day = ?', [installId, day]);
  const n = rows.length ? Number(rows[0].n) : 1;
  return { allowed: n <= limit, used: n, limit };
}

// Housekeeping, cheap enough to run on the way past: yesterday's counters and stale cache rows go.
export async function sweep(pool) {
  try {
    await pool.query('DELETE FROM news_quota WHERE day < CURRENT_DATE - INTERVAL 2 DAY');
    // The archive is trimmed to its window here. Whatever is dropped is public news that the apps
    // which wanted it have already saved on their own devices.
    await pool.query('DELETE FROM news_archive WHERE day < CURRENT_DATE - INTERVAL ? DAY', [ARCHIVE_DAYS]);
    // A year of weekly popularity is plenty; older weeks are of no use and are not worth keeping.
    await pool.query("DELETE FROM stock_usage WHERE week < DATE_FORMAT(NOW() - INTERVAL 52 WEEK, '%x-W%v')");
  } catch (_) { /* housekeeping is best effort */ }
}

// Is the provider still in its cool-off after refusing us? Best effort: if this check fails we would
// rather try the provider than block the Feed on a database hiccup.
export async function providerBlocked(pool, now = Date.now()) {
  try {
    const [rows] = await pool.query("SELECT at FROM news_state WHERE k = 'provider_fail'");
    if (!rows.length) return false;
    return now - new Date(rows[0].at).getTime() < PROVIDER_BACKOFF_MS;
  } catch (_) { return false; }
}

export async function noteProviderFailure(pool, now = new Date()) {
  try {
    await pool.query("INSERT INTO news_state (k, at) VALUES ('provider_fail', ?) ON DUPLICATE KEY UPDATE at = VALUES(at)", [now]);
  } catch (_) { /* the backoff is an optimisation, never a reason to fail a request */ }
}

// A request that worked clears the cool-off, so a fixed key takes effect at once.
export async function clearProviderFailure(pool) {
  try { await pool.query("DELETE FROM news_state WHERE k = 'provider_fail'"); } catch (_) { /* ignore */ }
}
