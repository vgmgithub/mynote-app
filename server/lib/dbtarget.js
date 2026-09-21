// A guard for scripts that WRITE to a database (migrate). The database is chosen only by DATABASE_URL, so a
// pasted or leftover URL can point a write at the wrong one - and the wrong one may be production.
//
// The person running the script must name the host they mean, in a second variable, and it has to match the
// host in the URL. Nothing is written until it does. It costs one extra word on the command line and turns
// "wrote to the wrong database" into "refused, and told you which one it was about to touch".
export function dbHost(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch (_) { return ''; }
}

export function checkTarget(url, confirm) {
  const host = dbHost(url);
  if (!host) return { ok: false, host: '', why: 'DATABASE_URL is missing or is not a valid URL.' };
  if (String(confirm || '').trim().toLowerCase() !== host) {
    return { ok: false, host, why: 'This would write to ' + host + '. If that is the database you mean, run again with CONFIRM_DB_HOST=' + host };
  }
  return { ok: true, host, why: '' };
}
