// Wiping staging's test subscriptions from the admin page - and never anywhere else.
//
// The reset deletes rows, so it may only ever run against the STAGING database. Production data is off-limits to
// any write an assistant or a test could trigger (docs/environments.md, 'Rules for production data'), so this is an
// allow-list, not a block-list: it runs only on the staging server's own address, and refuses everything else -
// the production API domain, the production project's own *.vercel.app address, a preview, anything unknown.
//
// Vercel's own record of which project is running (VERCEL_PROJECT_PRODUCTION_URL, set by the platform, not by the
// request) is trusted first. Only when that is missing does it fall back to the request's Host header, which
// Vercel uses to route: a request carrying the staging host reaches the staging project and nothing else.
export const STAGING_API_HOSTS = ['mynotes-server.vercel.app'];

export function resetAllowed({ projectUrl, host } = {}) {
  const p = String(projectUrl || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (p) {
    return STAGING_API_HOSTS.includes(p)
      ? { ok: true }
      : { ok: false, why: 'this server is not staging (' + p + '): test data can only be reset on staging' };
  }
  const h = String(host || '').toLowerCase().split(':')[0];
  if (STAGING_API_HOSTS.includes(h) || h === 'localhost' || h === '127.0.0.1') return { ok: true };
  return { ok: false, why: 'test data can only be reset on the staging server' };
}

// The word typed to confirm. A button alone is one mis-tap from wiping every test subscription.
export const RESET_WORD = 'RESET';
