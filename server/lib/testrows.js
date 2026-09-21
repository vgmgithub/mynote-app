// Recognising and removing leftover TEST installs, for scripts/clean-test-installs.js. Pure: it builds the
// statements and judges the plan; the script is what talks to a database, and only the one the person points it at.
//
// The signature is deliberately narrow. Real installs report android (or ios, mac); the test rows came from earlier
// browser test runs on Windows at v607. Matching on BOTH the platform and that exact old version means a real install
// on an ordinary desktop, on any current version, is never a candidate.
export const SEED_PLATFORM = 'windows';
export const SEED_VERSION = 607;

// Rows created by hand while testing the news proxy, named exactly.
export const KNOWN_TEST_INSTALL_IDS = ['4dcd6fca-1234-4abc-9def-0123456789ab'];

// Never delete more than this in one run: if far more rows match than expected, the signature is wrong.
export const MAX_DELETE = 50;

export const FIND_SQL = 'SELECT install_id, first_seen, last_seen FROM installs WHERE platform = ? AND app_version = ? ORDER BY first_seen';
export const FIND_PARAMS = [SEED_PLATFORM, SEED_VERSION];

// Judge what a run would do. `rows` are the matches, `total` is every install in the database.
export function planCleanup(rows, total, cap = MAX_DELETE) {
  const ids = (rows || []).map((r) => r.install_id);
  if (!ids.length) return { ok: true, ids, note: 'nothing to remove' };
  if (ids.length > cap) return { ok: false, ids, note: 'refused: ' + ids.length + ' rows match, more than the safety cap of ' + cap };
  if (ids.length >= total) return { ok: false, ids, note: 'refused: this would remove every install in the database, so it is not the database you think it is' };
  return { ok: true, ids, note: ids.length + ' of ' + total + ' installs would be removed; ' + (total - ids.length) + ' stay' };
}

// Child tables first, then the installs themselves. Every id is a bound parameter.
export function deleteStatements(ids) {
  const all = [...new Set([...ids, ...KNOWN_TEST_INSTALL_IDS])];
  return [
    { sql: 'DELETE FROM install_features WHERE install_id IN (?)', params: [all] },
    { sql: 'DELETE FROM install_days WHERE install_id IN (?)', params: [all] },
    { sql: 'DELETE FROM news_quota WHERE install_id IN (?)', params: [all] },
    { sql: 'DELETE FROM installs WHERE install_id IN (?)', params: [ids.length ? ids : ['']] },
  ];
}
