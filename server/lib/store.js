// `pool` is a mysql2/promise pool (or a fake with the same getConnection surface in tests).
// No IP address and no request headers ever reach this function: it only sees the validated payload.
const DAYS_DDL = 'CREATE TABLE IF NOT EXISTS install_days (install_id VARCHAR(40) NOT NULL, day DATE NOT NULL, PRIMARY KEY (install_id, day), KEY idx_install_days_day (day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
let daysTableReady = false;
// The table is also created by schema/002; this makes a deploy safe even before the migration is run.
async function ensureDaysTable(pool) {
  if (daysTableReady || typeof pool.query !== 'function') return;
  try { await pool.query(DAYS_DDL); daysTableReady = true; } catch (_) { /* usage days are best effort */ }
}
export async function saveInstall(pool, v, now = new Date()) {
  await ensureDaysTable(pool);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // A later payload without age/gender NULLs them, which is how a withdrawal takes effect.
    // The plan is decided by the server, never by the app: a new install always starts as 'free' and a
    // later send never touches it, so neither a client claiming 'paid' nor a routine send can change
    // what the admin has set.
    await conn.query(
      `INSERT INTO installs (install_id, first_seen, last_seen, app_version, platform, plan, time_zone, language, age_band, gender)
       VALUES (?, ?, ?, ?, ?, 'free', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen), app_version = VALUES(app_version), platform = VALUES(platform),
         time_zone = VALUES(time_zone), language = VALUES(language),
         age_band = VALUES(age_band), gender = VALUES(gender)`,
      [v.installId, now, now, v.appVersion, v.platform, v.timeZone, v.language, v.ageBand, v.gender],
    );
    await conn.query('DELETE FROM install_features WHERE install_id = ?', [v.installId]);
    if (v.features.length) {
      await conn.query('INSERT INTO install_features (install_id, feature) VALUES ?', [v.features.map((f) => [v.installId, f])]);
    }
    // Today's check-in, for the 'do people use it regularly' figures. Best effort: never fails a save.
    try { await conn.query('INSERT IGNORE INTO install_days (install_id, day) VALUES (?, ?)', [v.installId, now.toISOString().slice(0, 10)]); } catch (_) { /* table not there yet */ }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* connection already gone */ }
    throw e;
  } finally {
    conn.release();
  }
}

// Right to erasure: remove everything held for one install.
// One exception, so switching analytics off can never cost someone the Pro they paid for: for a PAID
// install the analytics details are erased (features, region, language, age, gender, platform, version)
// and only the install id and the membership status are kept.
export async function forgetInstall(pool, installId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT plan FROM installs WHERE install_id = ?', [installId]);
    const paid = Array.isArray(rows) && rows.length > 0 && rows[0].plan === 'paid';
    await conn.query('DELETE FROM install_features WHERE install_id = ?', [installId]);
    if (paid) {
      await conn.query("UPDATE installs SET time_zone = NULL, language = NULL, age_band = NULL, gender = NULL, platform = 'other', app_version = 0 WHERE install_id = ?", [installId]);
    } else {
      await conn.query('DELETE FROM installs WHERE install_id = ?', [installId]);
    }
    try { await conn.query('DELETE FROM install_days WHERE install_id = ?', [installId]); } catch (_) { /* table not there yet */ }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}
