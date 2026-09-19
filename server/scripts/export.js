// Full data export you can run any time: writes backups/mynotes-YYYY-MM-DD.sql (data as INSERTs).
// Together with schema/*.sql it rebuilds the database on ANY MySQL host, so a move loses nothing.
//   Backup:  DATABASE_URL=mysql://... node scripts/export.js
//   Restore: node scripts/migrate.js   (creates the tables on the new host)
//            then run the .sql file with any MySQL client
import { mkdir, writeFile } from 'node:fs/promises';
import { getPool } from '../lib/db.js';
import { toInsertSql } from '../lib/sql.js';

const TABLES = ['installs', 'install_features'];
const pool = await getPool();
const conn = await pool.getConnection();
let sql = '-- MyNotes server data export ' + new Date().toISOString() + '\nSET NAMES utf8mb4;\n\n';
for (const t of TABLES) {
  const [rows] = await conn.query('SELECT * FROM `' + t + '`');
  sql += '-- ' + t + ' (' + rows.length + ' rows)\n' + toInsertSql(t, rows, (v) => conn.escape(v)) + '\n';
  console.log(t.padEnd(18), rows.length, 'rows');
}
conn.release();
await mkdir('backups', { recursive: true });
const file = 'backups/mynotes-' + new Date().toISOString().slice(0, 10) + '.sql';
await writeFile(file, sql);
console.log('written', file);
await pool.end();
