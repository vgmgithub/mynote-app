// SEO tags that must differ by environment. Everything environment-agnostic (description, Open Graph,
// Twitter card, structured data) is static in index.html's <head> - only the one thing that would cause
// real harm if wrong lives here: a staging or local copy must never be indexed by a search engine. The
// static <meta name="robots"> in the HTML defaults to noindex for exactly that reason; this file's only
// job is to relax it back to index,follow on the one host that is actually meant to be found.
//
// The environment comes from config.js, the same single source the rest of the app uses - never a
// second guess at the hostname here.
import { IS_PRODUCTION } from './config.js';

const robots = document.querySelector('meta[name="robots"]');
if (robots && IS_PRODUCTION) robots.setAttribute('content', 'index, follow');
