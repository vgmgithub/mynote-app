// Sends the anonymous usage counts to our server. All the rules live in usage-core.js.
//
// SWITCH: nothing is sent to anyone until USAGE_ENABLED is true. It is false on purpose, because the
// Privacy Policy still says "Not active yet". To go live: set it to true AND update legal-text.js
// (remove "Not active yet", say from which date). A unit test fails if only one of the two is done.
//
// For testing on your own device only: open the app with ?usagetest=1 in the address (or run
//   localStorage.mynoteUsageTest = '1'   in the console) and reload. That switches sending on for that browser
// alone; ?usagetest=0 switches it off again.
import { DB } from './db.js';
import {
  APP_VERSION, APP_MODULES, modOn, getEnabledModules, getInstallId, getUsageProfile, getUsageCountsOn, getUsageRegion,
} from './app.js';
import { buildPayload, decideSend, detectPlatform, resolvePlan, signature } from './usage-core.js';

export const USAGE_ENABLED = false;
const SERVER = 'https://mynotes-server.vercel.app';
const TIMEOUT_MS = 8000;

export function usageTestMode() {
  try { return localStorage.getItem('mynoteUsageTest') === '1'; } catch (_) { return false; }
}

// Reads ?usagetest=1 / ?usagetest=0 from the address. Returns 'on', 'off' or null (no change).
export function applyUsageTestParam() {
  try {
    const q = new URLSearchParams(location.search).get('usagetest');
    if (q === '1') { localStorage.setItem('mynoteUsageTest', '1'); return 'on'; }
    if (q === '0') { localStorage.removeItem('mynoteUsageTest'); return 'off'; }
  } catch (_) { /* storage blocked: leave as is */ }
  return null;
}

export function usageActive() {
  return USAGE_ENABLED || usageTestMode();
}

// Exactly what would be sent right now (the same object the sender posts).
export async function currentPayload() {
  const mods = await getEnabledModules();
  const features = mods ? APP_MODULES.filter((m) => modOn(mods, m.id)).map((m) => m.id) : [];
  const region = getUsageRegion();
  return buildPayload({
    installId: await getInstallId(),
    features,
    plan: 'free',
    appVersion: APP_VERSION,
    platform: detectPlatform(navigator.userAgent, (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''),
    timeZone: region.timeZone,
    language: region.locale,
    profile: await getUsageProfile(),
  });
}

async function post(path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    let json = null;
    if (r.status === 200 && r.json) { try { json = await r.json(); } catch (_) { json = null; } }
    return { status: r.status, json };
  } finally { clearTimeout(timer); }
}

// Safe to call any time, as often as you like: it decides for itself, and never throws.
export async function sendUsage() {
  try {
    if (!usageActive()) return 'inactive';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
    const mods = await getEnabledModules();
    if (!mods) return 'not-set-up';                        // features not chosen yet: nothing to report
    const countsOn = await getUsageCountsOn();
    if (!countsOn) { await forgetIfPending(); return 'off'; }
    const payload = await currentPayload();
    const sig = signature(payload);
    const lastRec = await DB.get('meta', 'usageLastSent').catch(() => null);
    const failRec = await DB.get('meta', 'usageFailAt').catch(() => null);
    const verdict = decideSend({ countsOn, now: Date.now(), last: lastRec && lastRec.value, sig, lastFailAt: failRec && failRec.value });
    if (verdict !== 'send') return verdict;
    const { status } = await post('/api/collect', payload);
    if (status === 204) {
      await DB.put('meta', { key: 'usageLastSent', value: { at: Date.now(), sig } });
      await DB.del('meta', 'usageFailAt').catch(() => {});
      return 'sent';
    }
    await DB.put('meta', { key: 'usageFailAt', value: Date.now() });
    return 'failed';
  } catch (_) {
    try { await DB.put('meta', { key: 'usageFailAt', value: Date.now() }); } catch (__) { /* ignore */ }
    return 'failed';
  }
}

// Turning the counts off (or clearing all data) asks the server to delete what it holds for this install.
// If that cannot be done right now it is remembered and retried on the next open.
export async function forgetNow(installId) {
  try {
    const { status } = await post('/api/forget', { installId });
    return status === 204;
  } catch (_) { return false; }
}
export async function requestForget() {
  if (!usageActive()) return;
  try {
    const id = await getInstallId();
    await DB.put('meta', { key: 'usageForgetPending', value: id });
    await DB.del('meta', 'usageLastSent').catch(() => {});
    if (await forgetNow(id)) await DB.del('meta', 'usageForgetPending').catch(() => {});
  } catch (_) { /* retried next open */ }
}
async function forgetIfPending() {
  const rec = await DB.get('meta', 'usageForgetPending').catch(() => null);
  if (rec && rec.value && await forgetNow(rec.value)) await DB.del('meta', 'usageForgetPending').catch(() => {});
}

// ---- Membership (Pro) -------------------------------------------------------------------------
// The plan is decided on the server by the admin; the app only ever reads it. It is remembered on this
// device so Pro still shows offline, and it is device-only (never in a backup), so restoring a backup
// on another phone cannot hand out Pro.
export async function getCachedPlan() {
  const r = await DB.get('meta', 'plan').catch(() => null);
  return r && r.value && r.value.plan === 'paid' ? 'paid' : 'free';
}

// Called each time the app opens (and when the phone comes back online). Sends only the random install id.
// Returns the plan the app should show now. Never throws, and being offline or failing changes nothing.
export async function checkPlan() {
  const cached = await getCachedPlan();
  try {
    if (!usageActive()) return cached;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return cached;
    const installId = await getInstallId();
    const { status, json } = await post('/api/plan', { installId });
    const res = resolvePlan(cached, status === 200 ? json : null);
    if (status === 200 && json) await DB.put('meta', { key: 'plan', value: { plan: res.plan, at: Date.now() } });
    // The server has no record of this install (for example its database was cleared): forget that we
    // already sent, so the next send registers it again.
    if (res.reregister && await getUsageCountsOn()) {
      await DB.del('meta', 'usageLastSent').catch(() => {});
      sendUsage().catch(() => {});
    }
    if (res.changed) { try { window.dispatchEvent(new CustomEvent('mynote-plan', { detail: { plan: res.plan } })); } catch (_) { /* no window */ } }
    return res.plan;
  } catch (_) { return cached; }
}

// What the Privacy screen shows under "Show what MyNotes would send".
export async function usageStatus() {
  const active = usageActive();
  const countsOn = await getUsageCountsOn();
  const last = await DB.get('meta', 'usageLastSent').catch(() => null);
  return { active, test: !USAGE_ENABLED && usageTestMode(), countsOn, lastSentAt: last && last.value ? last.value.at : null, payload: await currentPayload() };
}
