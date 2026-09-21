// Gives every copy of the app that is NOT production its own icons (yellow), so a staging or local copy is never
// mistaken for the real one on a home screen or in a browser tab. Production keeps the existing green icons: on
// production this file changes nothing at all, so a release can never alter the live icon.
//
// What it swaps: the web manifest (which carries the installed app icon), the favicon, and the iPhone home-screen icon.
// The staging files live in icons/staging/ and manifest.staging.webmanifest, which a test keeps identical to the
// production manifest apart from the icon paths.
//
// The environment comes from config.js, the same single source the rest of the app uses.
import { ENV } from './config.js';

export const STAGING_MANIFEST = 'manifest.staging.webmanifest';
export const STAGING_ICON_DIR = 'icons/staging/';

export const usesStagingIcons = (env) => env !== 'production';

export function stagingPaths() {
  return {
    manifest: STAGING_MANIFEST,
    favicon: STAGING_ICON_DIR + 'icon-192.png',
    apple: STAGING_ICON_DIR + 'icon-180.png',
  };
}

// Returns true if it changed anything. On production it returns false without touching the page.
export function applyIcons(doc, env) {
  if (!usesStagingIcons(env) || !doc) return false;
  const p = stagingPaths();
  const set = (sel, href) => { const n = doc.querySelector(sel); if (n) n.setAttribute('href', href); };
  set('link[rel="manifest"]', p.manifest);
  set('link[rel="icon"]', p.favicon);
  set('link[rel="apple-touch-icon"]', p.apple);
  return true;
}

if (typeof document !== 'undefined') applyIcons(document, ENV);
