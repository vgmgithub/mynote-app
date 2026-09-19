// Pure logic for the anonymous usage counts: what is sent and when. No DOM, no storage, no network,
// so it can be unit tested against the server's own validator (server/lib/validate.js).
//
// What is sent (and nothing else - the server rejects any other field):
//   installId  random id made on first run (not derived from the device or the person)
//   features   the features currently switched on
//   plan       'free' or 'paid'
//   appVersion the app build number
//   platform   android / ios / windows / mac / linux / other
//   timeZone, language   from the device settings (country-level region, never GPS)
//   ageBand, gender      ONLY if the person chose to share them
// Never sent: any amount, holding, expense, note, name, contact detail or vault content.

export const RESEND_AFTER_MS = 7 * 24 * 3600 * 1000;   // a heartbeat about weekly
export const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;      // after a failed send, wait before trying again

export function detectPlatform(ua = '', uaPlatform = '') {
  const s = (ua + ' ' + uaPlatform).toLowerCase();
  if (/android/.test(s)) return 'android';
  if (/iphone|ipad|ipod|ios/.test(s)) return 'ios';
  if (/windows|win32|win64/.test(s)) return 'windows';
  if (/macintosh|mac os|macintel/.test(s)) return 'mac';
  if (/linux|x11|cros/.test(s)) return 'linux';
  return 'other';
}

export function buildPayload({ installId, features, plan = 'free', appVersion, platform, timeZone, language, profile }) {
  const p = {
    v: 1,
    installId,
    features: [...new Set(features || [])].sort(),
    plan,
    appVersion,
    platform,
  };
  if (timeZone) p.timeZone = timeZone;
  if (language) p.language = language;
  // Age group and gender travel only when the person chose to share them.
  if (profile && profile.share) {
    if (profile.ageBand) p.ageBand = profile.ageBand;
    if (profile.gender) p.gender = profile.gender;
  }
  return p;
}

// A short fingerprint of everything that would be sent, so an unchanged state is not re-sent.
export function signature(payload) {
  return JSON.stringify(payload);
}

// 'off' | 'send' | 'skip'
//   off  - the person turned the counts off: nothing is sent
//   send - first time, something changed, or a week has passed
//   skip - nothing new, or a recent failure is still cooling down
export function decideSend({ countsOn, now, last, sig, lastFailAt }) {
  if (!countsOn) return 'off';
  if (lastFailAt && now - lastFailAt < RETRY_AFTER_FAIL_MS) return 'skip';
  if (!last) return 'send';
  if (last.sig !== sig) return 'send';
  if (now - last.at >= RESEND_AFTER_MS) return 'send';
  return 'skip';
}

// The membership answer from the server, folded into what this device already believes.
//   answer: the parsed reply ({ plan, known }) or null when the server could not be reached
// A reply the app cannot trust (missing, wrong shape) changes nothing; being offline never removes Pro.
export function resolvePlan(cached, answer) {
  const have = cached === 'paid' ? 'paid' : 'free';
  if (!answer || (answer.plan !== 'paid' && answer.plan !== 'free')) return { plan: have, changed: false, reregister: false };
  return { plan: answer.plan, changed: answer.plan !== have, reregister: answer.known === false };
}
