// The only place that knows which database this is. Move to another MySQL host by changing
// DATABASE_URL (a mysql://user:pass@host:port/db URL); nothing else in the code changes.
let pool = null;

export async function getPool() {
  if (pool) return pool;   // reused across warm serverless invocations
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { default: mysql } = await import('mysql2/promise');
  pool = mysql.createPool({
    uri: url,
    // Serverless: many function instances share one database, so keep each pool tiny.
    connectionLimit: 3,
    waitForConnections: true,
    enableKeepAlive: true,
    // Hosted MySQL-compatible services require TLS. Set DATABASE_SSL=off only for a local database.
    ssl: process.env.DATABASE_SSL === 'off' ? undefined : { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    timezone: 'Z',
  });
  return pool;
}
