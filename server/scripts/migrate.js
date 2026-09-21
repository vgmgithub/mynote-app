// Applies server/schema/*.sql in order, once each.
// Usage: DATABASE_URL=mysql://... CONFIRM_DB_HOST=<the host in that URL> node scripts/migrate.js
// NEVER run this against the production database from an assistant session: production schema changes are
// applied by the owner only (docs/environments.md, 'Rules for production data').
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPool } from '../lib/db.js';
import { splitStatements } from '../lib/sql.js';
import { checkTarget } from '../lib/dbtarget.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema');
// Writes to whatever DATABASE_URL points at, so it must be told which host is meant. See lib/dbtarget.js.
const target = checkTarget(process.env.DATABASE_URL, process.env.CONFIRM_DB_HOST);
if (!target.ok) { console.error('REFUSED: ' + target.why); process.exit(1); }
console.log('target  ', target.host);
const pool = await getPool();
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (version)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
const [done] = await pool.query('SELECT version FROM schema_migrations');
const applied = new Set(done.map((r) => r.version));

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  if (applied.has(f)) { console.log('skip    ', f); continue; }
  for (const stmt of splitStatements(await readFile(path.join(dir, f), 'utf8'))) await pool.query(stmt);
  await pool.query('INSERT INTO schema_migrations (version) VALUES (?)', [f]);
  console.log('applied ', f);
}
await pool.end();
