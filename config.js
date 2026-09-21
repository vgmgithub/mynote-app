// Which environment this copy of the app is running in, and which server it talks to.
//
// There are three, told apart by the address the app is opened from (never by a setting somebody could
// forget to change):
//   local       - localhost, for development on a computer.
//   staging     - every address that is not production. Today that includes the original
//                 mynote-app-tau.vercel.app, which is the development and staging copy.
//   production  - only the addresses listed in PRODUCTION_HOSTS below.
//
// Each environment has its own server and its own database, so testing can never touch real users' data.
// The browser keeps app data per address, so the environments cannot see each other's data either.
//
// To go live: fill in PRODUCTION_HOSTS and PRODUCTION_SERVER (see docs/environments.md), then release.

export const STAGING_SERVER = 'https://mynotes-server.vercel.app';

// Left empty until the production domain exists. Until then nothing is production, so nothing can talk
// to a production server by accident.
export const PRODUCTION_HOSTS = [];
export const PRODUCTION_SERVER = '';

export function envFor(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (PRODUCTION_HOSTS.includes(h)) return 'production';
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '') return 'local';
  return 'staging';
}

// The server for an environment. A production copy with no production server configured gets NO server
// rather than falling back to the staging one: a live app must never write into the test database.
export function serverFor(env) {
  return env === 'production' ? PRODUCTION_SERVER : STAGING_SERVER;
}

export const ENV = envFor(typeof location !== 'undefined' ? location.hostname : '');
export const SERVER_URL = serverFor(ENV);
export const IS_PRODUCTION = ENV === 'production';
