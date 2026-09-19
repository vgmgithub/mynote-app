// Decides whether a browser origin may call the API. The allowed list comes from the ALLOWED_ORIGINS
// environment variable (comma separated). Entries are cleaned up first, because a value pasted into a
// dashboard often picks up a trailing slash, spaces or quote marks, and a browser's Origin header never has them.
export function cleanOrigin(s) {
  return String(s || '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/\/+$/, '').toLowerCase();
}

// The app's own address is built in, so the app keeps working even if the environment variable is missing or
// wrong. ALLOWED_ORIGINS adds to this list (for example http://localhost while developing, or a new domain).
export const DEFAULT_ORIGINS = ['https://mynote-app-tau.vercel.app'];

export function allowedOrigins(envValue) {
  const fromEnv = String(envValue || '').split(',').map(cleanOrigin).filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS.map(cleanOrigin), ...fromEnv])];
}

// Returns the origin to echo in Access-Control-Allow-Origin, or null if it is not allowed.
export function matchOrigin(originHeader, envValue) {
  if (!originHeader) return null;
  return allowedOrigins(envValue).includes(cleanOrigin(originHeader)) ? originHeader : null;
}
