import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import crypto from 'node:crypto';
import { verifySignature, planFromEvent, rawBody, EVENTS } from '../lib/webhook.js';
import { parseClockInput, KEYS, CLOCK_KEY } from '../lib/settings.js';

const srv = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const SECRET = 'whsec_test';
const sign = (raw) => crypto.createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex');

const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const evt = (event, o = {}) => JSON.stringify({
  event,
  payload: { subscription: { entity: {
    id: 'sub_123', current_end: 1790000000, notes: { installId: ID }, ...o,
  } } },
});

test('folding kept the function count at the limit, not over it', () => {
  const count = (dir) => readdirSync(dir).reduce((n, f) => {
    const p = new URL(f, dir);
    return n + (statSync(p).isDirectory() ? count(new URL(f + '/', dir)) : 1);
  }, 0);
  assert.ok(count(new URL('../api/', import.meta.url)) <= 12, 'still within Hobby');
});

test('a webhook is only believed when it is signed over the exact bytes sent', () => {
  const raw = evt('subscription.charged');
  assert.equal(verifySignature(raw, sign(raw), SECRET), true);
  // Re-serialising changes whitespace and key order, and must stop matching - which is why the
  // handler reads the raw stream instead of req.body.
  const reserialised = JSON.stringify(JSON.parse(raw));
  if (reserialised !== raw) assert.equal(verifySignature(reserialised, sign(raw), SECRET), false);
  assert.equal(verifySignature(raw + ' ', sign(raw), SECRET), false, 'one byte is enough');
  assert.equal(verifySignature(raw, 'deadbeef', SECRET), false, 'a short signature is refused, not thrown at');
  assert.equal(verifySignature(raw, sign(raw), 'other'), false);
  for (const bad of [null, '', undefined]) {
    assert.equal(verifySignature(bad, sign(raw), SECRET), false);
    assert.equal(verifySignature(raw, bad, SECRET), false);
    assert.equal(verifySignature(raw, sign(raw), bad), false, 'no secret is a closed door');
  }
});

test('an already-consumed body is refused rather than guessed at', async () => {
  assert.equal(await rawBody({ readable: false }), null);
  assert.equal(await rawBody({ rawBody: '{"a":1}' }), '{"a":1}');
  assert.equal(await rawBody({ rawBody: Buffer.from('{"b":2}') }), '{"b":2}');
});

test('each event says what it means for the subscription', () => {
  const charged = planFromEvent(JSON.parse(evt('subscription.charged')));
  assert.deepEqual([charged.ok, charged.status, charged.installId, charged.id], [true, 'active', ID, 'sub_123']);
  assert.equal(charged.currentEnd.toISOString(), new Date(1790000000000).toISOString(), 'Razorpay\'s own end date is used');
  // A failed mandate stops renewals but never cuts short a term already paid for.
  assert.equal(planFromEvent(JSON.parse(evt('subscription.halted'))).status, 'halted');
  assert.equal(planFromEvent(JSON.parse(evt('subscription.cancelled'))).status, 'cancelled');
  assert.equal(planFromEvent(JSON.parse(evt('subscription.completed'))).status, 'cancelled');
  for (const e of EVENTS) assert.equal(planFromEvent(JSON.parse(evt(e))).ok, true, e);
});

test('an event that cannot be attached to anybody is dropped, never guessed', () => {
  assert.equal(planFromEvent(JSON.parse(evt('subscription.charged', { notes: {} }))).ok, false);
  assert.equal(planFromEvent(JSON.parse(evt('subscription.charged', { notes: { installId: 'nope' } }))).ok, false);
  assert.equal(planFromEvent({ event: 'subscription.charged', payload: {} }).ok, false);
  // An event we do not act on is ignored rather than failed: a non-2xx makes Razorpay retry forever.
  const other = planFromEvent({ event: 'payment.captured', payload: {} });
  assert.deepEqual([other.ok, other.ignored], [false, true]);
  assert.equal(planFromEvent({}).ignored, true);
});

test('the webhook branch is separate from checkout, and cannot be reached unsigned', () => {
  const src = srv('api/verify-payment.js');
  // The branch is the first thing, before any parsing or CORS.
  assert.match(src, /if \(req\.query && req\.query\.hook === '1'\) return handleWebhook/);
  // Inside the exported handler only: `matchOrigin` also appears in the imports at the top.
  const entry = src.slice(src.indexOf('export default'));
  assert.ok(entry.indexOf('handleWebhook(req, res)') < entry.indexOf('matchOrigin('), 'the fold happens before CORS');
  // No secret, no signature, no grant. And the signature check precedes anything that writes.
  assert.match(src, /if \(!secret\) return json\(res, 503/);
  assert.ok(src.indexOf('verifySignature(') < src.indexOf('applySubscriptionEvent('), 'verified before applied');
  assert.match(src, /rawBody\(req\)/, 'the raw body, not req.body');
  // A checkout grant must not be reachable from the webhook path.
  const hook = src.slice(src.indexOf('async function handleWebhook'), src.indexOf('export default'));
  assert.equal(/grantPaid|verifyPayment\(/.test(hook), false, 'the webhook cannot grant Pro by itself');
});

test('the settings fold sits behind the same admin check as a plan change', () => {
  const src = srv('api/admin/plan.js');
  // Admin is checked before the branch, so neither path can skip it.
  assert.ok(src.indexOf('requireAdmin(req)') < src.indexOf("req.query.settings === '1'"), 'admin first');
  assert.match(src, /Cache-Control', 'no-store'/, 'a write is never cached');
  // Only known keys can be written at all.
  assert.deepEqual(KEYS, [CLOCK_KEY]);
});

test('the clock is rejected rather than quietly coerced', () => {
  const ok = parseClockInput({ enabled: true, monthly: '1h', annual: '2h', remindBefore: '15m' });
  assert.deepEqual(ok.value, { enabled: true, monthly: '1h', annual: '2h', remindBefore: '15m' });
  // A tester watching the wrong clock reports a bug that is not one, so a bad field fails loudly.
  assert.equal(parseClockInput({ enabled: true, monthly: 'soon', annual: '2h', remindBefore: '15m' }).ok, false);
  assert.equal(parseClockInput({ enabled: true, monthly: '1h', annual: '2h' }).ok, false, 'missing field');
  assert.equal(parseClockInput({ enabled: true, monthly: '', annual: '2h', remindBefore: '5m' }).ok, false);
  assert.equal(parseClockInput({}).ok, false);
  // Off is a valid state, and the durations still have to make sense so it can be switched on.
  assert.equal(parseClockInput({ enabled: false, monthly: '30m', annual: '1d', remindBefore: '5m' }).value.enabled, false);
});
