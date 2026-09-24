// Strict allow-list for what the app may send. Anything not listed is rejected outright, so
// money data (or a name, or contact details) can never be stored even by a buggy client.
export const FEATURES = ['stocks', 'mf', 'fd', 'metal', 'bond', 'div', 'ef', 'banksav', 'calc', 'expense', 'cc', 'personal', 'analysis', 'health', 'vault'];
// Feature ids the app no longer has, and what they became (the app's LEGACY_MODULE_IDS, feature-limit.js). An older
// app version still cached on somebody's phone keeps sending the old id; it is read as its successor, not refused -
// refusing one id throws away the whole report. Only add to this map.
export const LEGACY_FEATURES = { inflation: 'calc' };
export const featureOf = (id) => LEGACY_FEATURES[id] || id;
export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
export const GENDERS = ['Female', 'Male', 'Other'];
// 'beta': a free, admin-approved cohort membership (docs/beta-plan.md). Set and cleared through the same
// installs.plan column and the same admin action as 'paid' always has been.
export const PLANS = ['free', 'paid', 'beta'];
export const PLATFORMS = ['android', 'ios', 'windows', 'mac', 'linux', 'other'];

const ALLOWED_KEYS = ['v', 'installId', 'features', 'plan', 'appVersion', 'platform', 'timeZone', 'language', 'ageBand', 'gender', 'alias'];
const INSTALL_ID = /^[0-9a-f-]{32,36}$/;
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

const fail = (error) => ({ ok: false, error });

export function parsePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body must be an object');
  for (const k of Object.keys(body)) if (!ALLOWED_KEYS.includes(k)) return fail('unexpected field: ' + k);
  if (body.v !== 1) return fail('unsupported version');

  if (typeof body.installId !== 'string' || !INSTALL_ID.test(body.installId)) return fail('bad installId');

  if (!Array.isArray(body.features) || body.features.length > FEATURES.length) return fail('bad features');
  for (const f of body.features) if (!FEATURES.includes(featureOf(f))) return fail('unknown feature');
  const features = [...new Set(body.features.map(featureOf))].sort();

  if (!PLANS.includes(body.plan)) return fail('bad plan');
  if (!Number.isInteger(body.appVersion) || body.appVersion < 1 || body.appVersion > 1000000) return fail('bad appVersion');
  if (!PLATFORMS.includes(body.platform)) return fail('bad platform');

  const optional = (val, re, max) => {
    if (val == null || val === '') return { ok: true, value: null };
    if (typeof val !== 'string' || val.length > max || !re.test(val)) return { ok: false };
    return { ok: true, value: val };
  };
  const tz = optional(body.timeZone, TIME_ZONE, 48);
  if (!tz.ok) return fail('bad timeZone');
  const lang = optional(body.language, LANGUAGE, 16);
  if (!lang.ok) return fail('bad language');

  // Age group and gender are optional; a value outside the lists is refused (this is also
  // what keeps an "Under 18" band out: the app is 18+).
  let ageBand = null;
  if (body.ageBand != null && body.ageBand !== '') { if (!AGE_BANDS.includes(body.ageBand)) return fail('bad ageBand'); ageBand = body.ageBand; }
  // The anonymous name: one word of letters, as alias.js builds them. Anything else is refused outright.
  let alias = null;
  if (body.alias != null && body.alias !== '') {
    if (typeof body.alias !== 'string' || !/^[A-Za-z]{4,12}$/.test(body.alias)) return fail('bad alias');
    alias = body.alias;
  }
  let gender = null;
  if (body.gender != null && body.gender !== '') { if (!GENDERS.includes(body.gender)) return fail('bad gender'); gender = body.gender; }

  return {
    ok: true,
    value: {
      installId: body.installId, features, plan: body.plan, appVersion: body.appVersion, platform: body.platform,
      timeZone: tz.value, language: lang.value, ageBand, gender, alias,
    },
  };
}
