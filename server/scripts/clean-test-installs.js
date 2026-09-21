// Removes the leftover TEST installs (windows, v607, plus a few named probe ids) from the database it is pointed at.
//
//   DATABASE_URL=mysql://... CONFIRM_DB_HOST=<host in that URL> node scripts/clean-test-installs.js          <- dry run: lists, deletes nothing
//   DATABASE_URL=mysql://... CONFIRM_DB_HOST=<host in that URL> node scripts/clean-test-installs.js --apply  <- deletes
//
// STAGING ONLY. It deletes rows. It never runs against production from an assistant session (docs/environments.md,
// 'Rules for production data'), and it refuses when its plan looks wrong: too many matches, or it would empty the table.
// It always prints the host it is about to touch, and the dry run shows how many installs the database holds, which is
// how you tell staging (many test rows) from production (few, all real).
import { getPool } from '../lib/db.js';
import { checkTarget } from '../lib/dbtarget.js';
import { FIND_SQL, FIND_PARAMS, planCleanup, deleteStatements, SEED_PLATFORM, SEED_VERSION } from '../lib/testrows.js';

const apply = process.argv.includes('--apply');
const target = checkTarget(process.env.DATABASE_URL, process.env.CONFIRM_DB_HOST);
if (!target.ok) { console.error('REFUSED: ' + target.why); process.exit(1); }
console.log('target   ' + target.host);
console.log('mode     ' + (apply ? 'APPLY (will delete)' : 'dry run (deletes nothing)'));

const pool = await getPool();
try {
  const [rows] = await pool.query(FIND_SQL, FIND_PARAMS);
  const [[{ n: total }]] = await pool.query('SELECT COUNT(*) AS n FROM installs');
  console.log('installs in this database: ' + total);
  console.log('matching platform=' + SEED_PLATFORM + ' and app_version=' + SEED_VERSION + ': ' + rows.length);
  for (const r of rows.slice(0, 25)) console.log('   ' + String(r.install_id).slice(0, 8) + '...  first seen ' + new Date(r.first_seen).toISOString().slice(0, 10));
  if (rows.length > 25) console.log('   ... and ' + (rows.length - 25) + ' more');

  const plan = planCleanup(rows, Number(total));
  console.log('plan     ' + plan.note);
  if (!plan.ok) process.exit(1);
  if (!plan.ids.length) process.exit(0);
  if (!apply) { console.log('\nDry run only. Nothing was deleted. Add --apply to delete the rows listed above.'); process.exit(0); }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const s of deleteStatements(plan.ids)) {
      const [res] = await conn.query(s.sql, s.params);
      console.log('deleted  ' + String(res.affectedRows).padStart(3) + '  ' + s.sql.replace('DELETE FROM ', '').split(' WHERE')[0]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); console.error('FAILED and rolled back: ' + e.message); process.exit(1); } finally { conn.release(); }
  const [[{ n: after }]] = await pool.query('SELECT COUNT(*) AS n FROM installs');
  console.log('installs now: ' + after);
} finally { await pool.end(); }
