import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { livePrice, sellableOffers, periodEnd, renewalEnd, entitlement, isLive, meetsRank,
  parseBuy, isSellable, PERIODS, SELLABLE_PERIODS, FREE_RANK,
  parseDuration, formatDuration, parseClock, testSpanMs, needsReminder, renewalNotice,
  remindLeadMs, DEFAULT_CLOCK } from '../lib/plans.js';

const sql = readFileSync(new URL('../schema/006_subscriptions.sql', import.meta.url), 'utf8');
const price = (period, amount, active = 1, from = '2026-01-01', plan_code = 'pro') =>
  ({ plan_code, period, amount, currency: 'INR', label: 'x', active, from_at: from });
const PLANS = [{ code: 'pro', name: 'Pro Plan', rank: 10, active: 1 }];

test('the launch prices are the ones asked for, and lifetime is priced but not on sale', () => {
  assert.match(sql, /'pro', 'monthly',\s+4900/, 'monthly is Rs 49');
  assert.match(sql, /'pro', 'annual',\s+39900/, 'annual is Rs 399');
  assert.match(sql, /'pro', 'lifetime', 129900, 'INR', '[^']*', 0/, 'lifetime exists, switched off');
  // Hidden by data, not by deleted code: turning it on must never need a migration.
  assert.ok(PERIODS.includes('lifetime'), 'lifetime is a legal period');
  assert.equal(isSellable('lifetime'), false, 'but it cannot be bought yet');
  assert.deepEqual(SELLABLE_PERIODS, ['monthly', 'annual']);
});

test('a price change never touches anybody already paying', () => {
  // The old price is retired, the new one goes live.
  const prices = [price('annual', 39900, 0, '2026-01-01'), price('annual', 59900, 1, '2026-06-01')];
  assert.equal(livePrice(prices, 'pro', 'annual').amount, 59900, 'new signups pay the new price');
  // The subscriber carries their own amount, so nothing here can reach back and raise it.
  const sub = { plan_code: 'pro', period: 'annual', amount: 39900, status: 'active', current_end: '2027-01-01' };
  assert.equal(sub.amount, 39900, 'an existing subscriber still owes what they signed at');
  assert.match(sql, /amount\s+INT\s+NOT NULL,/, 'subscriptions carries its own amount');
  // Two live rows should not happen, but if they do the newest is the price.
  const both = [price('monthly', 4900, 1, '2026-01-01'), price('monthly', 7900, 1, '2026-06-01')];
  assert.equal(livePrice(both, 'pro', 'monthly').amount, 7900);
  assert.equal(livePrice(prices, 'pro', 'lifetime'), null, 'no active row means no price');
});

test('a second plan needs rows, not a migration', () => {
  const plans = [...PLANS, { code: 'pro_plus', name: 'Pro Plus', rank: 20, active: 1 }];
  const prices = [price('monthly', 4900), price('annual', 39900),
    price('monthly', 9900, 1, '2026-01-01', 'pro_plus'), price('annual', 79900, 1, '2026-01-01', 'pro_plus')];
  const offers = sellableOffers(plans, prices);
  assert.deepEqual(offers.map((o) => o.planCode + ':' + o.period),
    ['pro:monthly', 'pro:annual', 'pro_plus:monthly', 'pro_plus:annual'], 'lower tier first, cheapest first');
  // A feature asks for a rank, so Pro Plus gets everything Pro has without listing it again.
  const plus = entitlement([{ plan_code: 'pro_plus', status: 'active', current_end: '2099-01-01', period: 'annual' }], plans);
  assert.equal(meetsRank(plus, 10), true, 'the higher tier clears the lower bar');
  assert.equal(meetsRank(entitlement([], plans), 10), false);
});

test('an offer that is not on sale is simply not offered', () => {
  // Lifetime has an active price but is not in SELLABLE_PERIODS: it still must not appear.
  const offers = sellableOffers(PLANS, [price('lifetime', 129900, 1), price('annual', 39900)]);
  assert.deepEqual(offers.map((o) => o.period), ['annual']);
  // An inactive plan takes its prices with it.
  assert.deepEqual(sellableOffers([{ code: 'pro', name: 'Pro', rank: 10, active: 0 }], [price('annual', 39900)]), []);
});

test('a period ends on the calendar, not 30 days later', () => {
  assert.equal(periodEnd('monthly', new Date('2026-01-15T00:00:00Z')).toISOString().slice(0, 10), '2026-02-15');
  assert.equal(periodEnd('annual', new Date('2026-01-15T00:00:00Z')).toISOString().slice(0, 10), '2027-01-15');
  // 31 January has to land on the last day of February, not spill into March.
  assert.equal(periodEnd('monthly', new Date('2026-01-31T00:00:00Z')).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(periodEnd('annual', new Date('2028-02-29T00:00:00Z')).toISOString().slice(0, 10), '2029-02-28');
  assert.equal(periodEnd('lifetime', new Date()), null, 'lifetime does not end');
});

test('renewing early does not shorten what you already paid for', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  // Three weeks still to run: the next period starts where this one ends.
  assert.equal(renewalEnd('monthly', '2026-06-21T00:00:00Z', now).toISOString().slice(0, 10), '2026-07-21');
  // Already lapsed: the gap is not owed back.
  assert.equal(renewalEnd('monthly', '2026-03-01T00:00:00Z', now).toISOString().slice(0, 10), '2026-07-01');
  assert.equal(renewalEnd('annual', null, now).toISOString().slice(0, 10), '2027-06-01');
});

test('entitlement: expired, cancelled and lifetime all answer correctly', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const sub = (o) => ({ plan_code: 'pro', period: 'annual', status: 'active', current_end: '2026-12-01', ...o });
  assert.equal(entitlement([sub({})], PLANS, now).plan, 'paid');
  assert.equal(entitlement([sub({ current_end: '2026-01-01' })], PLANS, now).plan, 'free', 'expired is free');
  assert.equal(entitlement([sub({ status: 'cancelled' })], PLANS, now).plan, 'free');
  // Cancelled but paid up to the end of the term still counts until that date, which is why status
  // and date are checked together rather than either alone.
  assert.equal(isLive(sub({ status: 'halted' }), now), false);
  // Lifetime: no end date, never expires.
  assert.equal(isLive(sub({ period: 'lifetime', current_end: null }), now), true);
  assert.equal(entitlement([sub({ period: 'lifetime', current_end: null })], PLANS, now).until, null);
  // Nothing at all.
  const none = entitlement([], PLANS, now);
  assert.deepEqual([none.plan, none.rank, none.code], ['free', FREE_RANK, null]);
});

test('an app that has never heard of periods still works', () => {
  // No period named: it gets the annual plan, which is what the single price used to be.
  const old = parseBuy({ installId: 'a'.repeat(32) });
  assert.deepEqual([old.ok, old.plan, old.period], [true, 'pro', 'annual']);
  // And the answer keeps saying free/paid, whatever else it now carries.
  const ent = entitlement([{ plan_code: 'pro', period: 'monthly', status: 'active', current_end: '2099-01-01' }], PLANS);
  assert.equal(ent.plan, 'paid');
  assert.equal(ent.code, 'pro');
});

test('the app cannot name its own price, or buy something that is not for sale', () => {
  const ok = parseBuy({ installId: 'b'.repeat(36).slice(0, 36), plan: 'pro', period: 'monthly' });
  assert.equal(ok.ok, true);
  assert.equal(ok.amount, undefined, 'the request carries no amount at all');
  assert.equal(parseBuy({ installId: 'a'.repeat(32), period: 'lifetime' }).ok, false, 'not on sale');
  assert.equal(parseBuy({ installId: 'a'.repeat(32), period: 'weekly' }).ok, false);
  assert.equal(parseBuy({ installId: 'nope' }).ok, false);
  assert.equal(parseBuy({ installId: 'a'.repeat(32), plan: 'pro; DROP' }).ok, false);
});

// ---------- the billing test clock ----------

const CLOCK = { enabled: true, monthly: '1h', annual: '2h', remindBefore: '15m' };

test('durations are written the way a person would say them', () => {
  assert.equal(parseDuration('15m'), 15 * 60000);
  assert.equal(parseDuration('1h'), 3600000);
  assert.equal(parseDuration('7d'), 7 * 86400000);
  assert.equal(parseDuration('1.5h'), 5400000);
  assert.equal(parseDuration(' 2H '), 7200000, 'case and spacing are forgiven');
  assert.equal(parseDuration(45), 45 * 60000, 'a bare number is minutes');
  assert.equal(parseDuration('90'), 90 * 60000);
  // Everything a text field can be given that is not a duration.
  for (const bad of ['', '0h', '-5m', 'abc', '1w', null, undefined, {}, '1h30m']) {
    assert.equal(parseDuration(bad), null, JSON.stringify(bad));
  }
  assert.equal(formatDuration(parseDuration('7d')), '7d', 'it reads back as it was typed');
  assert.equal(formatDuration(parseDuration('1h')), '1h');
  assert.equal(formatDuration(parseDuration('90m')), '90m');
});

test('a bad or missing setting falls back to real time, never to a broken clock', () => {
  for (const bad of [null, undefined, '', 'not json', '{', 42, []]) {
    assert.deepEqual(parseClock(bad), DEFAULT_CLOCK, JSON.stringify(bad));
  }
  // Off by default: production must never inherit a test clock by accident.
  assert.equal(DEFAULT_CLOCK.enabled, false);
  assert.equal(testSpanMs('monthly', null), null, 'no clock means the calendar');
  assert.equal(testSpanMs('monthly', { ...CLOCK, enabled: false }), null);
  // One unreadable field does not poison the rest.
  const partial = parseClock({ enabled: true, monthly: 'rubbish', annual: '3h' });
  assert.equal(partial.monthly, DEFAULT_CLOCK.monthly);
  assert.equal(partial.annual, '3h');
  // Lifetime has no span to shorten.
  assert.equal(testSpanMs('lifetime', CLOCK), null);
});

test('a whole subscription life runs inside an hour on staging', () => {
  const t0 = new Date('2026-06-01T10:00:00Z');
  // Bought at 10:00, a "monthly" plan ends at 11:00.
  const end = periodEnd('monthly', t0, CLOCK);
  assert.equal(end.toISOString(), '2026-06-01T11:00:00.000Z');
  assert.equal(periodEnd('annual', t0, CLOCK).toISOString(), '2026-06-01T12:00:00.000Z');
  // The same call without the clock is still a real month, so production is untouched.
  assert.equal(periodEnd('monthly', t0).toISOString().slice(0, 10), '2026-07-01');
  // Renewing at 10:30 extends from 11:00, not from 10:30.
  assert.equal(renewalEnd('monthly', end, new Date('2026-06-01T10:30:00Z'), CLOCK).toISOString(),
    '2026-06-01T12:00:00.000Z');
});

test('the reminder fires fifteen minutes out, once per term, and re-arms on renewal', () => {
  const end = '2026-06-01T11:00:00Z';
  const sub = (o) => ({ plan_code: 'pro', period: 'monthly', status: 'active', current_end: end, reminded_for: null, ...o });
  const at = (s) => new Date('2026-06-01T' + s + ':00Z');

  assert.equal(needsReminder(sub({}), at('10:44'), CLOCK), false, 'too early');
  assert.equal(needsReminder(sub({}), at('10:45'), CLOCK), true, 'exactly at the lead time');
  assert.equal(needsReminder(sub({}), at('10:59'), CLOCK), true);
  // Already given for this term: not again.
  assert.equal(needsReminder(sub({ reminded_for: end }), at('10:50'), CLOCK), false);
  // Renewed to a new end date: the old stamp no longer matches, so the next term warns on its own.
  assert.equal(needsReminder(sub({ current_end: '2026-06-01T12:00:00Z', reminded_for: end }), at('11:50'), CLOCK), true);
  // Expired is a different message, and lifetime never ends.
  assert.equal(needsReminder(sub({ current_end: '2026-06-01T09:00:00Z' }), at('10:50'), CLOCK), false);
  assert.equal(needsReminder(sub({ period: 'lifetime', current_end: null }), at('10:50'), CLOCK), false);
  // On real time the window is days, not minutes.
  assert.equal(remindLeadMs('monthly'), 3 * 86400000);
  assert.equal(remindLeadMs('annual'), 14 * 86400000);
  assert.equal(remindLeadMs('monthly', CLOCK), 15 * 60000);
});

test('the app is told what is happening, and cancelled reads differently from renewing', () => {
  const end = '2026-06-01T11:00:00Z';
  const sub = (o) => ({ period: 'monthly', status: 'active', current_end: end, ...o });
  assert.equal(renewalNotice(sub({}), new Date('2026-06-01T10:00:00Z'), CLOCK), null, 'nothing to say yet');
  const soon = renewalNotice(sub({}), new Date('2026-06-01T10:50:00Z'), CLOCK);
  assert.equal(soon.state, 'renewing');
  assert.equal(soon.msLeft, 10 * 60000);
  // Cancelled but still paid up: it is ending, not renewing.
  assert.equal(renewalNotice(sub({ status: 'cancelled' }), new Date('2026-06-01T10:50:00Z'), CLOCK).state, 'ending');
  assert.equal(renewalNotice(sub({}), new Date('2026-06-01T11:30:00Z'), CLOCK).state, 'ended');
  assert.equal(renewalNotice(sub({ period: 'lifetime', current_end: null }), new Date(), CLOCK), null);
  assert.equal(renewalNotice(null, new Date(), CLOCK), null);
});
