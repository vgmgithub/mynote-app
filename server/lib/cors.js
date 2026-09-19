// Decides whether a browser origin may call the API. The allowed list comes from the ALLOWED_ORIGINS
// environment variable (comma separated). Entries are cleaned up first, because a value pasted into a
// dashboard often picks up a trailing slash, spaces or quote marks, and a browser's Origin header never has them.
export function cleanOrigin(s) {
  return String(s || '').trim().replace(/^["']+|["']+$/g, '').trim().replace(/\/+$/, '').toLowerCase();
}

export function allowedOrigins(envValue) {
  return String(envValue || '').split(',').map(cleanOrigin).filter(Boolean);
}

// Returns the origin to echo in Access-Control-Allow-Origin, or null if it is not allowed.
export function matchOrigin(originHeader, envValue) {
  if (!originHeader) return null;
  return allowedOrigins(envValue).includes(cleanOrigin(originHeader)) ? originHeader : null;
}
