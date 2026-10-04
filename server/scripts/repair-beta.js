// Finish a Beta migration (schema/007) that stopped part-way, and add the website visits table (schema/008).
// Safe to run more than once: it adds only what is missing, never drops or changes existing rows.
// Run by the owner only:  DATABASE_URL=... node scripts/repair-beta.js
import { getPool } from '../lib/db.js';

const pool = await getPool();
const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
console.log('database:', db);

const hasColumn = async (table, col) => {
  const [r] = await pool.query('SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?', [db, table, col]);
  return r.length > 0;
};
const hasTable = async (table) => {
  const [r] = await pool.query('SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?', [db, table]);
  return r.length > 0;
};

const COLUMNS = [
  ['beta_cohort', 'finalized_at', 'DATETIME NULL'],
  ['beta_requests', 'reviewed_at', 'DATETIME NULL'],
  ['beta_requests', 'reviewed_note', 'VARCHAR(255) NULL'],
  ['beta_requests', 'cohort_id', 'INT NULL'],
  ['beta_feedback', 'comment_title', 'VARCHAR(80) NULL'],
  ['beta_feedback', 'comment_body', 'TEXT NULL'],
  ['beta_feedback', 'reviewed', 'TINYINT(1) NOT NULL DEFAULT 0'],
  ['beta_feedback', 'total_score', 'DECIMAL(6,2) NULL'],
  ['beta_feedback_answers', 'score', 'SMALLINT NULL'],
  ['beta_feedback_answers', 'admin_note', 'VARCHAR(255) NULL'],
  ['beta_offers', 'redeemed_subscription_id', 'VARCHAR(64) NULL'],
  ['installs', 'beta_terminated_reason', 'VARCHAR(20) NULL'],
];
for (const [t, c, def] of COLUMNS) {
  if (!(await hasTable(t))) { console.log('MISSING TABLE', t, '- run npm run migrate after this'); continue; }
  if (await hasColumn(t, c)) { console.log('ok      ', t + '.' + c); continue; }
  await pool.query('ALTER TABLE `' + t + '` ADD COLUMN `' + c + '` ' + def);
  console.log('added   ', t + '.' + c);
}

const [p] = await pool.query(
  "INSERT IGNORE INTO plans (code, name, `rank`, active) VALUES ('pro_beta_member', 'Pro Plan (Beta Member price)', 10, 1), ('pro_beta_contributor', 'Pro Plan (Beta Contributor price)', 10, 1)");
console.log('plans    added', p.affectedRows);
for (const [code, amount, label] of [['pro_beta_member', 29900, 'MyNotes Pro - Beta Member price'], ['pro_beta_contributor', 19900, 'MyNotes Pro - Beta Contributor price']]) {
  const [have] = await pool.query("SELECT 1 FROM plan_prices WHERE plan_code = ? AND period = 'annual'", [code]);
  if (have.length) { console.log('ok       price', code); continue; }
  await pool.query("INSERT INTO plan_prices (plan_code, period, amount, currency, label, active, from_at) VALUES (?, 'annual', ?, 'INR', ?, 1, NOW())", [code, amount, label]);
  console.log('added    price', code);
}

await pool.query('CREATE TABLE IF NOT EXISTS site_visits (day DATE NOT NULL, visitors INT NOT NULL DEFAULT 0, views INT NOT NULL DEFAULT 0, PRIMARY KEY (day)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
console.log('ok       site_visits');
if (await hasColumn('site_visits', 'new_visitors')) console.log('ok       site_visits.new_visitors');
else { await pool.query('ALTER TABLE site_visits ADD COLUMN new_visitors INT NOT NULL DEFAULT 0'); console.log('added    site_visits.new_visitors'); }
for (const c of ['week_visitors', 'month_visitors']) {
  if (await hasColumn('site_visits', c)) { console.log('ok       site_visits.' + c); continue; }
  await pool.query('ALTER TABLE site_visits ADD COLUMN ' + c + ' INT NOT NULL DEFAULT 0');
  console.log('added    site_visits.' + c);
}

await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (version)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
await pool.query("INSERT IGNORE INTO schema_migrations (version) VALUES ('007_beta.sql'), ('008_site_visits.sql'), ('009_site_visits_new.sql'), ('010_site_visits_periods.sql')");
console.log('recorded 007 to 010 as applied. Done.');
await pool.end?.();
process.exit(0);
