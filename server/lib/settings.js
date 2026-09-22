// settings.js — server settings an admin can change without a deploy.
//
// One tiny table, read on the paths that need it. Today it holds the billing test clock (see
// lib/plans.js), which has to be editable while somebody is halfway through a test - an environment
// variable would need a redeploy and would lose the run.
//
// Every key is allow-listed. A settings table reachable from an admin page is a place where a typo
// becomes a silent production change, so nothing outside this list can be written at all.
import { parseClock, parseDuration } from './plans.js';

export const CLOCK_KEY = 'billing_clock';
export const KEYS = [CLOCK_KEY];

const DDL = `CREATE TABLE IF NOT EXISTS settings (
  k  VARCHAR(48) NOT NULL,
  v  TEXT        NOT NULL,
  at DATETIME    NOT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

let ready = false;
export async function ensureSettings(pool) {
  if (ready) return;
  await pool.query(DDL);
  ready = true;
}

export async function readSetting(pool, key) {
  if (KEYS.indexOf(key) < 0) return null;
  const [rows] = await pool.query('SELECT v FROM settings WHERE k = ?', [key]);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].v); } catch (_) { return null; }
}

export async function writeSetting(pool, key, value) {
  if (KEYS.indexOf(key) < 0) throw new Error('unknown setting');
  await pool.query(
    'INSERT INTO settings (k, v, at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE v = VALUES(v), at = NOW()',
    [key, JSON.stringify(value)]);
}

// The clock, always as a whole valid object: a half-written row must still produce something the
// billing code can run on, and that something is real calendar time.
export async function readClock(pool) {
  try {
    await ensureSettings(pool);
    return parseClock(await readSetting(pool, CLOCK_KEY));
  } catch (_) { return parseClock(null); }
}

// What the admin page is allowed to send. Rejected rather than coerced: a field that silently becomes
// something else is how a tester ends up watching the wrong clock and reporting a bug that is not one.
export function parseClockInput(body) {
  const b = body || {};
  const out = { enabled: b.enabled === true || b.enabled === 1 || b.enabled === '1' };
  for (const f of ['monthly', 'annual', 'remindBefore']) {
    const raw = b[f];
    if (raw == null || raw === '') return { ok: false, error: f + ' is required, like 30m, 2h or 7d' };
    if (parseDuration(raw) == null) return { ok: false, error: f + ' is not a duration: use 30m, 2h or 7d' };
    out[f] = String(raw).trim();
  }
  return { ok: true, value: out };
}
