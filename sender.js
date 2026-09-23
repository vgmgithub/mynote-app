// Sends the anonymous usage counts to our server. All the rules live in usage-core.js.
//
// SWITCH: nothing is sent to anyone unless USAGE_ENABLED is true. It went live on 20 September 2026 together with
// the Privacy Policy text (which no longer says "Not active yet"). A unit test fails if only one of the two changes.
//
// For testing on your own device only: open the app with ?usagetest=1 in the address (or run
//   localStorage.mynoteUsageTest = '1'   in the console) and reload. That switches sending on for that browser
// alone; ?usagetest=0 switches it off again.
import { DB } from './db.js';
import {
  APP_VERSION, APP_MODULES, modOn, getEnabledModules, getInstallId, getAlias, setAlias, ensureAlias, getUsageProfile, getUsageCountsOn, getUsageRegion,
} from './app.js';
import { buildPayload, decideSend, detectPlatform, resolvePlan, signature } from './usage-core.js';
import { SERVER_URL } from './config.js';

export const USAGE_ENABLED = true;
// Which server this copy talks to depends on the environment (config.js). A production copy with no
// production server configured has none, and sends nothing rather than writing into the test database.
const SERVER = SERVER_URL;
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

// The automated tests run the real app against a throw-away database; they must never post to the live server,
// so on that database only the explicit test switch turns sending on (the tests stub the network for that).
const onTestDb = () => { try { return /[?&]testdb=1/.test(location.search); } catch (_) { return false; } };
export function usageActive() {
  return (USAGE_ENABLED && !onTestDb()) || usageTestMode();
}

// Exactly what would be sent right now (the same object the sender posts).
export async function currentPayload() {
  const mods = await getEnabledModules();
  const features = mods ? APP_MODULES.filter((m) => modOn(mods, m.id)).map((m) => m.id) : [];
  const region = getUsageRegion();
  return buildPayload({
    installId: await getInstallId(),
    alias: await getAlias(),
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
  if (!SERVER) throw new Error('no server configured for this environment');
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
    // An install from before names existed gets one now, using whatever gender it had already shared.
    await ensureAlias((await getUsageProfile()).gender || '');
    const payload = await currentPayload();
    const sig = signature(payload);
    const lastRec = await DB.get('meta', 'usageLastSent').catch(() => null);
    const failRec = await DB.get('meta', 'usageFailAt').catch(() => null);
    const verdict = decideSend({ countsOn, now: Date.now(), last: lastRec && lastRec.value, sig, lastFailAt: failRec && failRec.value });
    if (verdict !== 'send') return verdict;
    const { status, json } = await post('/api/collect', payload);
    // 200 carries the settled name: the database has the unique index, so it decides. 204 means there was
    // nothing to report and whatever this device has stands.
    if (status === 200 || status === 204) {
      if (json && json.alias) await setAlias(json.alias);
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
  if (!r || !r.value) return 'free';
  // The term itself is enforced locally too, not only on the next server round trip - time keeps
  // passing while the device is offline, and without this Pro would keep working right up until
  // whenever the app next manages to reach /api/plan, however long that takes. `until` is what the
  // server itself told us on the last successful check, so trusting it between syncs is the same thing
  // any app store subscription client does with its own cached receipt. A missing `until` (lifetime, or
  // a cached record from before schema/006) never expires this way.
  if (r.value.plan === 'paid' && r.value.until && new Date(r.value.until).getTime() <= Date.now()) {
    // Corrected in storage, not just in the return value - so the SAME transition is not re-detected
    // (and the "your plan has ended" popup re-shown) on every offline open from here on. The one call
    // that catches it flipping is startup's own read of the record before this runs (app.js).
    // endedAt keeps the moment it ended, for "Pro expired ..." on the account sheet, offline included.
    await DB.put('meta', { key: 'plan', value: { ...r.value, plan: 'free', endedAt: r.value.until } }).catch(() => {});
    return 'free';
  }
  return r.value.plan === 'paid' ? 'paid' : 'free';
}

// The whole cached record, for the one screen that wants more than free/paid: when this term ends,
// which period it is, and whether it renews or simply stops. Null when nothing is stored yet.
export async function getPlanDetail() {
  const r = await DB.get('meta', 'plan').catch(() => null);
  return r && r.value ? r.value : null;
}

// Called each time the app opens (and when the phone comes back online). Sends only the random install id.
// Returns the plan the app should show now. Never throws, and being offline or failing changes nothing.
export async function checkPlan() {
  // What the app was showing BEFORE getCachedPlan() gets a chance to correct a term past its end date.
  // Comparing against the corrected value instead is what used to hide every expiry: the local check
  // quietly wrote Free, the server then agreed, "nothing changed", and the ended-plan popup never came.
  const before = await DB.get('meta', 'plan').catch(() => null);
  const shown = before && before.value && before.value.plan === 'paid' ? 'paid' : 'free';
  const cached = await getCachedPlan();
  const endedLocally = () => {
    if (shown === 'paid' && cached === 'free') {
      try { window.dispatchEvent(new CustomEvent('mynote-plan', { detail: { plan: 'free', wasPaid: true } })); } catch (_) { /* no window */ }
    }
    return cached;
  };
  try {
    if (!usageActive()) return endedLocally();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return endedLocally();
    const installId = await getInstallId();
    const { status, json } = await post('/api/plan', { installId });
    if (status !== 200 || !json) return endedLocally();
    const res = resolvePlan(shown, json);
    // The subscription detail rides along with the plan so the Payment history can say when the term
    // ends without a request of its own. Absent for lifetime (which never ends) and for a server that
    // has not had schema/006 run yet, so every reader has to cope with it being undefined.
    if (status === 200 && json) {
      // Dates are moved onto this device's clock (by how far it is from the server's), so the local
      // expiry check and the timers below fire when the server says, even on a phone set a few minutes out.
      const skew = json.serverNow ? Date.now() - new Date(json.serverNow).getTime() : 0;
      const local = (iso) => (iso && !isNaN(new Date(iso)) ? new Date(new Date(iso).getTime() + (Number.isFinite(skew) ? skew : 0)).toISOString() : null);
      await DB.put('meta', { key: 'plan', value: {
        plan: res.plan, at: Date.now(),
        until: local(json.until), remindAt: res.plan === 'paid' ? local(json.remindAt) : null,
        termMs: res.plan === 'paid' && Number.isFinite(json.termMs) ? json.termMs : null,
        // The end of the last term, kept after it runs out: from the server when it says so, else the
        // end date this device already had (a term that ended locally, offline, a moment ago).
        endedAt: res.plan === 'paid' ? null : (local(json.endedAt) || (before && before.value && before.value.until) || (before && before.value && before.value.endedAt) || null),
        period: json.period || '', renewing: json.renewing !== false,
      } });
      armPlanTimers().catch(() => {});
    }
    // The server has no record of this install (for example its database was cleared): forget that we
    // already sent, so the next send registers it again.
    if (res.reregister && await getUsageCountsOn()) {
      await DB.del('meta', 'usageLastSent').catch(() => {});
      sendUsage().catch(() => {});
    }
    if (res.changed) { try { window.dispatchEvent(new CustomEvent('mynote-plan', { detail: { plan: res.plan, wasPaid: shown === 'paid' } })); } catch (_) { /* no window */ } }
    // The server only ever hands back a notice once per term (it marks reminded_for the instant it does),
    // so seeing one here means "say this now" - there is no push notification to fall back on, this open
    // is the only chance. Fired as its own event so app.js decides how to show it without this file
    // needing to know about toasts.
    if (status === 200 && json && json.notice) {
      try { window.dispatchEvent(new CustomEvent('mynote-plan-notice', { detail: json.notice })); } catch (_) { /* no window */ }
    }
    return res.plan;
  } catch (_) { return endedLocally(); }
}

// The term a verified payment just bought, stored as the plan at once, then the timers armed. The
// same shape and clock correction as a plan check (checkPlan), so the next check simply agrees with it.
export async function storePaidTerm(json) {
  if (!json || json.plan !== 'paid') return;
  const skew = json.serverNow ? Date.now() - new Date(json.serverNow).getTime() : 0;
  const local = (iso) => (iso && !isNaN(new Date(iso)) ? new Date(new Date(iso).getTime() + (Number.isFinite(skew) ? skew : 0)).toISOString() : null);
  await DB.put('meta', { key: 'plan', value: {
    plan: 'paid', at: Date.now(), until: local(json.until), remindAt: local(json.remindAt),
    termMs: Number.isFinite(json.termMs) ? json.termMs : null,
    period: json.period || '', renewing: true, endedAt: null,
  } });
  await armPlanTimers();
}

// Two moments matter in a term, and neither can wait for the next poll (every 5 minutes, and a test
// clock's warning window may be shorter than that): when the "ends soon" card goes up, and when the
// term ends. Both are timers on the stored plan record, re-armed on every open and every server answer,
// so they work offline and survive a reload. At the end the plan is simply checked again, which ends
// it locally (getCachedPlan) even with no network and raises the ended-plan popup through checkPlan.
const _planTimers = [];
const MAX_TIMER = 2147483000; // setTimeout's limit (~24.8 days); a later date is armed by a later open
export async function armPlanTimers() {
  while (_planTimers.length) clearTimeout(_planTimers.pop());
  const r = await DB.get('meta', 'plan').catch(() => null);
  const v = r && r.value;
  if (!v || v.plan !== 'paid' || !v.until) return;
  const end = new Date(v.until).getTime();
  const now = Date.now();
  if (!Number.isFinite(end) || end - now > MAX_TIMER) return;
  const remind = v.remindAt ? new Date(v.remindAt).getTime() : NaN;
  if (Number.isFinite(remind) && end > now) {
    _planTimers.push(setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent('mynote-plan-notice', { detail: {
        state: v.renewing === false ? 'ending' : 'renewing', endsAt: new Date(end).toISOString(), msLeft: Math.max(0, end - Date.now()), period: v.period || '', local: true,
        windowMs: end - remind,
      } })); } catch (_) { /* no window */ }
    }, Math.max(0, remind - now)));
  }
  _planTimers.push(setTimeout(() => { checkPlan().catch(() => {}); }, Math.max(0, end - now) + 1500));
}

// What the Privacy screen shows under "Show what MyNotes would send".
export async function usageStatus() {
  const active = usageActive();
  const countsOn = await getUsageCountsOn();
  const last = await DB.get('meta', 'usageLastSent').catch(() => null);
  return { active, test: !USAGE_ENABLED && usageTestMode(), countsOn, lastSentAt: last && last.value ? last.value.at : null, payload: await currentPayload() };
}
