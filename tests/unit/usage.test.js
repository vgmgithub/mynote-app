import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPayload, decideSend, detectPlatform, resolvePlan, signature, RESEND_AFTER_MS, RETRY_AFTER_FAIL_MS } from '../../usage-core.js';
import { parsePayload } from '../../server/lib/validate.js';
import { PRIVACY } from '../../legal-text.js';

const base = () => ({
  installId: '4dcd6fca-1234-4abc-9def-0123456789ab', features: ['mf', 'stocks'], plan: 'free', appVersion: 601,
  platform: 'android', timeZone: 'Asia/Calcutta', language: 'en-IN', profile: null,
});

test('what the app builds is accepted by the server validator, so the two can never drift apart', () => {
  assert.equal(parsePayload(buildPayload(base())).ok, true);
  const shared = buildPayload({ ...base(), profile: { share: true, ageBand: '25-34', gender: 'Female' } });
  const r = parsePayload(shared);
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.ageBand, r.value.gender], ['25-34', 'Female']);
});

test('age group and gender are left out unless the person chose to share them', () => {
  for (const profile of [null, undefined, { share: false, ageBand: '25-34', gender: 'Female' }, { ageBand: '25-34' }]) {
    const p = buildPayload({ ...base(), profile });
    assert.ok(!('ageBand' in p) && !('gender' in p), 'demographics leaked for ' + JSON.stringify(profile));
  }
  const p = buildPayload({ ...base(), profile: { share: true, ageBand: '', gender: 'Male' } });
  assert.ok(!('ageBand' in p) && p.gender === 'Male');
});

test('the payload contains only the documented fields', () => {
  const p = buildPayload({ ...base(), profile: { share: true, ageBand: '35-44', gender: 'Other' } });
  assert.deepEqual(Object.keys(p).sort(), ['ageBand', 'appVersion', 'features', 'gender', 'installId', 'language', 'plan', 'platform', 'timeZone', 'v']);
});

test('features are de-duplicated and sorted so the same state always gives the same message', () => {
  const a = buildPayload({ ...base(), features: ['stocks', 'mf', 'stocks'] });
  const b = buildPayload({ ...base(), features: ['mf', 'stocks'] });
  assert.equal(signature(a), signature(b));
});

test('platform detection', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel)', ''), 'android');
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17)', ''), 'ios');
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0)', 'Windows'), 'windows');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)', ''), 'mac');
  assert.equal(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)', ''), 'linux');
  assert.equal(detectPlatform('', ''), 'other');
  assert.equal(parsePayload(buildPayload({ ...base(), platform: detectPlatform('weird agent', '') })).ok, true);
});

test('when to send: never when off, first time, on change, daily, and not again straight after a failure', () => {
  const now = 1_000_000_000_000, sig = 'S';
  const d = (o) => decideSend({ countsOn: true, now, last: null, sig, lastFailAt: null, ...o });
  assert.equal(d({ countsOn: false }), 'off');
  assert.equal(d({ countsOn: false, last: null }), 'off');
  assert.equal(d({}), 'send');
  assert.equal(d({ last: { at: now - 1000, sig } }), 'skip');
  assert.equal(d({ last: { at: now - 1000, sig: 'other' } }), 'send');
  assert.equal(d({ last: { at: now - RESEND_AFTER_MS + 1000, sig } }), 'skip');
  assert.equal(d({ last: { at: now - RESEND_AFTER_MS, sig } }), 'send');
  assert.equal(d({ lastFailAt: now - 1000 }), 'skip');
  assert.equal(d({ lastFailAt: now - RETRY_AFTER_FAIL_MS - 1 }), 'send');
  assert.equal(d({ countsOn: false, lastFailAt: now - 1000 }), 'off');
});

test('sending stays OFF until the Privacy text is updated in the same change', () => {
  const src = readFileSync(new URL('../../sender.js', import.meta.url), 'utf8');
  const live = /export const USAGE_ENABLED = true/.test(src);
  const text = PRIVACY.flatMap((s) => s[1]).join('\n');
  const saysInactive = /Not active yet/.test(text);
  assert.equal(live, !saysInactive, live
    ? 'USAGE_ENABLED is true but the Privacy Policy still says "Not active yet": update legal-text.js'
    : 'the Privacy Policy no longer says "Not active yet" but USAGE_ENABLED is still false: they must change together');
});

test('the sender never sends anything that is not built by usage-core (no ad-hoc fields)', () => {
  const src = readFileSync(new URL('../../sender.js', import.meta.url), 'utf8');
  const posts = [...src.matchAll(/post\('([^']+)', ([^)]+)\)/g)].map((m) => m[1] + ' <- ' + m[2]);
  assert.deepEqual(posts.sort(), ["/api/collect <- payload", "/api/forget <- { installId }", "/api/plan <- { installId }"].sort());
});

test('membership: the server\'s answer wins, but being offline or a bad reply never removes Pro', () => {
  assert.deepEqual(resolvePlan('free', { plan: 'paid', known: true }), { plan: 'paid', changed: true, reregister: false });
  assert.deepEqual(resolvePlan('paid', { plan: 'free', known: true }), { plan: 'free', changed: true, reregister: false }, 'admin can take Pro away');
  assert.deepEqual(resolvePlan('paid', { plan: 'paid', known: true }), { plan: 'paid', changed: false, reregister: false });
  for (const bad of [null, undefined, {}, { plan: 'gold' }, { plan: 1 }, 'paid']) {
    assert.deepEqual(resolvePlan('paid', bad), { plan: 'paid', changed: false, reregister: false }, 'unusable reply keeps Pro: ' + JSON.stringify(bad));
  }
  assert.equal(resolvePlan(undefined, null).plan, 'free', 'nothing cached and nothing heard is free');
  assert.equal(resolvePlan('nonsense', null).plan, 'free', 'a corrupted cache is treated as free');
});

test('membership: an install the server does not know is told to register again', () => {
  assert.equal(resolvePlan('free', { plan: 'free', known: false }).reregister, true);
  assert.equal(resolvePlan('free', { plan: 'free', known: true }).reregister, false);
  assert.equal(resolvePlan('free', { plan: 'free' }).reregister, false, 'an older server reply without "known" does not loop');
});

test('the plan check is switched on and off by the same switch as the usage counts', () => {
  const src = readFileSync(new URL('../../sender.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function checkPlan'), src.indexOf('// What the Privacy screen shows'));
  assert.match(fn, /if \(!usageActive\(\)\) return cached;/, 'no network call unless sending is active');
});
