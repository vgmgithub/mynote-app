// Admin access check.
//
// By the owner's decision the admin page and its write endpoints are OPEN: no key is set, so
// requireAdmin() lets everything through. Setting ADMIN_KEY in the Vercel environment locks every
// write immediately, with no code change: the dashboard then asks for the key once and remembers it.
//
// While no key is set, anyone who finds /admin can read every install and change paid status.
export function adminKeySet() {
  return Boolean(process.env.ADMIN_KEY);
}

// Returns null when allowed, or a reason string when refused.
export function requireAdmin(req) {
  if (!adminKeySet()) return null;                       // open by configuration
  const given = req.headers['x-admin-key'] || (req.query && req.query.k) || '';
  return String(given) === String(process.env.ADMIN_KEY) ? null : 'bad admin key';
}
