// `pool` is a mysql2/promise pool (or a fake with the same getConnection surface in tests).
// No IP address and no request headers ever reach this function: it only sees the validated payload.
export async function saveInstall(pool, v, now = new Date()) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // A later payload without age/gender NULLs them, which is how a withdrawal takes effect.
    await conn.query(
      `INSERT INTO installs (install_id, first_seen, last_seen, app_version, platform, plan, time_zone, language, age_band, gender)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen), app_version = VALUES(app_version), platform = VALUES(platform),
         plan = VALUES(plan), time_zone = VALUES(time_zone), language = VALUES(language),
         age_band = VALUES(age_band), gender = VALUES(gender)`,
      [v.installId, now, now, v.appVersion, v.platform, v.plan, v.timeZone, v.language, v.ageBand, v.gender],
    );
    await conn.query('DELETE FROM install_features WHERE install_id = ?', [v.installId]);
    if (v.features.length) {
      await conn.query('INSERT INTO install_features (install_id, feature) VALUES ?', [v.features.map((f) => [v.installId, f])]);
    }
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* connection already gone */ }
    throw e;
  } finally {
    conn.release();
  }
}

// Right to erasure: remove everything held for one install.
export async function forgetInstall(pool, installId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM install_features WHERE install_id = ?', [installId]);
    await conn.query('DELETE FROM installs WHERE install_id = ?', [installId]);
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}
