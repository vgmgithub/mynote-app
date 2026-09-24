import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { windowFor, lastClosedWindow, validateFeedbackBody, scoreSubmission, rankCohort } from '../lib/beta.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// A UTC instant for a given IST wall-clock date/time, so tests can say "Friday 00:01 IST" directly.
const ist = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi, 0) - 330 * 60000);

test('windowFor: Friday 00:00 IST through Sunday 23:59:59.999 IST, whatever day it is asked from', () => {
  // 2026-09-25 is a Friday.
  const fri0001 = windowFor(ist(2026, 9, 25, 0, 1));
  assert.equal(fri0001.weekKey, '2026-09-25');
  assert.equal(fri0001.isOpen, true);
  const sat = windowFor(ist(2026, 9, 26, 12, 0));
  assert.equal(sat.weekKey, '2026-09-25'); assert.equal(sat.isOpen, true);
  const sunLate = windowFor(ist(2026, 9, 27, 23, 59));
  assert.equal(sunLate.weekKey, '2026-09-25'); assert.equal(sunLate.isOpen, true);
  const mon = windowFor(ist(2026, 9, 28, 0, 0));
  assert.equal(mon.weekKey, '2026-09-25'); assert.equal(mon.isOpen, false, 'Monday 00:00 IST: the window just closed');
  const wed = windowFor(ist(2026, 10, 1, 10, 0));
  assert.equal(wed.weekKey, '2026-09-25'); assert.equal(wed.isOpen, false);
  const nextFri = windowFor(ist(2026, 10, 2, 0, 0));
  assert.equal(nextFri.weekKey, '2026-10-02'); assert.equal(nextFri.isOpen, true, 'the next window opens on the dot');
  // The instant right before Friday 00:00 IST is still last week's window, closed.
  const thu2359 = windowFor(new Date(ist(2026, 9, 25, 0, 0).getTime() - 1));
  assert.equal(thu2359.weekKey, '2026-09-18'); assert.equal(thu2359.isOpen, false);
});

test('lastClosedWindow: the week just missed, whether asked mid-window or after it', () => {
  assert.equal(lastClosedWindow(ist(2026, 9, 28, 9, 0)).weekKey, '2026-09-25', 'Monday: the window that just closed');
  assert.equal(lastClosedWindow(ist(2026, 10, 1, 9, 0)).weekKey, '2026-09-25', 'Thursday: still that same closed window');
  assert.equal(lastClosedWindow(ist(2026, 9, 26, 9, 0)).weekKey, '2026-09-18', 'Saturday, mid-window: the week BEFORE this one');
  assert.equal(lastClosedWindow(ist(2026, 9, 25, 0, 1)).weekKey, '2026-09-18', 'the instant the new window opens, the prior one is what just closed');
});

test('feedback validation: every question answered, a title and a body, or it is refused', () => {
  const good = { installId: '4dcd6fca-1234-4abc-9def-0123456789ab', weekStart: '2026-09-25',
    answers: [{ key: 'q1', value: 'Yes' }, { key: 'q2', value: 'Sometimes' }], commentTitle: 'Bug report', commentBody: 'Found an issue with X.' };
  assert.equal(validateFeedbackBody(good).ok, true);
  assert.equal(validateFeedbackBody({ ...good, installId: 'bad' }).ok, false);
  assert.equal(validateFeedbackBody({ ...good, weekStart: '25-09-2026' }).ok, false);
  assert.equal(validateFeedbackBody({ ...good, answers: [] }).ok, false, 'nothing answered');
  assert.equal(validateFeedbackBody({ ...good, answers: [{ key: 'q1', value: '' }] }).ok, false, 'an unanswered question');
  assert.equal(validateFeedbackBody({ ...good, answers: [{ key: 'q1', value: '   ' }] }).ok, false, 'whitespace is not an answer');
  assert.equal(validateFeedbackBody({ ...good, commentTitle: '' }).ok, false, 'no heading');
  assert.equal(validateFeedbackBody({ ...good, commentBody: '' }).ok, false, 'no comment body');
  assert.equal(validateFeedbackBody(null).ok, false);
});

test('scoring: a submission\'s score is the average of its RATED answers; unrated answers do not drag it to zero', () => {
  assert.equal(scoreSubmission([{ score: 80 }, { score: 60 }]), 70);
  assert.equal(scoreSubmission([{ score: 90 }, { score: null }]), 90, 'an unrated answer is left out of the average, not counted as 0');
  assert.equal(scoreSubmission([{ score: null }]), null, 'nothing rated yet: no score at all, not a 0');
  assert.equal(scoreSubmission([]), null);
});

test('ranking: top 10% (floor, minimum 1) become Contributors; everyone else who completed becomes a Member', () => {
  // 20 people approved; person 1..20 scored, best first. Contributor count = floor(20*0.10) = 2.
  const pool_ = Array.from({ length: 20 }, (_, i) => ({ installId: 'i' + i, terminatedReason: null }));
  const scores = new Map(pool_.map((p, i) => [p.installId, { avg: 100 - i, firstSubmittedAt: '2026-09-26T10:00:00Z' }]));
  const ranked = rankCohort(pool_, scores);
  const tiers = Object.fromEntries(ranked.map((r) => [r.installId, r.tier]));
  assert.equal(tiers.i0, 'contributor'); assert.equal(tiers.i1, 'contributor');
  assert.equal(tiers.i2, 'member');
  assert.equal(ranked.filter((r) => r.tier === 'contributor').length, 2);
  assert.equal(ranked.filter((r) => r.tier === 'member').length, 18);
});

test('ranking: at least 1 winner whenever there is at least 1 eligible participant, even with very few', () => {
  for (const n of [1, 5, 9, 10]) {
    const pool_ = Array.from({ length: n }, (_, i) => ({ installId: 'i' + i, terminatedReason: null }));
    const scores = new Map(pool_.map((p, i) => [p.installId, { avg: 50 - i, firstSubmittedAt: '2026-09-26T10:00:00Z' }]));
    const winners = rankCohort(pool_, scores).filter((r) => r.tier === 'contributor').length;
    assert.equal(winners, 1, n + ' participants -> at least 1 winner');
  }
  // 40 -> 4, per the owner's own examples.
  const p40 = Array.from({ length: 40 }, (_, i) => ({ installId: 'i' + i, terminatedReason: null }));
  const s40 = new Map(p40.map((p, i) => [p.installId, { avg: 100 - i, firstSubmittedAt: '2026-09-26T10:00:00Z' }]));
  assert.equal(rankCohort(p40, s40).filter((r) => r.tier === 'contributor').length, 4);
});

test('ranking: terminated people still count toward the pool size, but never win a tier; a tie is decided deterministically', () => {
  const pool_ = [
    { installId: 'a', terminatedReason: null }, { installId: 'b', terminatedReason: null },
    { installId: 'c', terminatedReason: 'missed_week' }, { installId: 'd', terminatedReason: null },
    { installId: 'e', terminatedReason: null }, { installId: 'f', terminatedReason: null },
    { installId: 'g', terminatedReason: null }, { installId: 'h', terminatedReason: null },
    { installId: 'i', terminatedReason: null }, { installId: 'j', terminatedReason: null },
  ];
  // 10 people -> 1 winner. a and b are tied on score; a submitted first.
  const scores = new Map([
    ['a', { avg: 90, firstSubmittedAt: '2026-09-26T09:00:00Z' }], ['b', { avg: 90, firstSubmittedAt: '2026-09-26T10:00:00Z' }],
    ['c', { avg: 99, firstSubmittedAt: '2026-09-26T08:00:00Z' }], // highest score, but terminated - never wins
    ['d', { avg: 50, firstSubmittedAt: '2026-09-26T09:00:00Z' }],
  ]);
  const ranked = rankCohort(pool_, scores);
  const tiers = Object.fromEntries(ranked.map((r) => [r.installId, r.tier]));
  assert.equal(tiers.c, null, 'terminated: never a tier, however high the score');
  assert.equal(tiers.a, 'contributor', 'tie-break: earlier first submission wins');
  assert.equal(tiers.b, 'member');
  assert.equal(ranked.length, 10, 'the pool size (denominator) still includes the terminated person');
  for (const id of ['e', 'f', 'g', 'h', 'i', 'j']) assert.equal(tiers[id], null, 'no reviewed score yet: no tier either');
  // Run twice with the same inputs: never a different answer (no randomness anywhere in the tie-break).
  assert.deepEqual(rankCohort(pool_, scores), ranked);
});

test('the server accepts \'beta\' as a plan value, alongside free and paid', async () => {
  const { PLANS } = await import('../lib/validate.js');
  assert.deepEqual(PLANS, ['free', 'paid', 'beta']);
});

test('the missed-window sweep rides on the existing daily India cron, spending no extra Vercel cron job', () => {
  const vc = JSON.parse(read('vercel.json'));
  assert.equal(vc.crons.length, 2, 'Hobby allows two cron jobs, and both are already the two markets');
  const cron = read('api/cron-news.js');
  assert.match(cron, /if \(isCron && market === 'in'\) \{/);
  assert.match(cron, /sweepMissedWindows\(pool\)/);
  // Still reachable by hand (testing, catching up) - just never given its own schedule.
  assert.match(cron, /req\.query && req\.query\.job === 'beta'/);
});

test('the Beta price tiers are ordinary rows in plans/plan_prices, ranked equal to pro - no rank-ladder change needed', () => {
  const sql = read('schema/007_beta.sql');
  assert.match(sql, /'pro_beta_member', 'Pro Plan \(Beta Member price\)', 10, 1/);
  assert.match(sql, /'pro_beta_contributor', 'Pro Plan \(Beta Contributor price\)', 10, 1/);
  assert.match(sql, /'pro_beta_member', 'annual', 29900/);
  assert.match(sql, /'pro_beta_contributor', 'annual', 19900/);
  assert.match(sql, /ALTER TABLE installs ADD COLUMN beta_terminated_reason/);
});

test('server files stay within the Hobby plan\'s twelve serverless functions', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const walk = (dir) => readdirSync(new URL(dir, import.meta.url)).flatMap((name) => {
    const rel = dir + '/' + name;
    return statSync(new URL(rel, import.meta.url)).isDirectory() ? walk(rel) : (name.endsWith('.js') ? [rel] : []);
  });
  assert.equal(walk('../api').length, 12);
});

test('create-order checks for a Beta offer before falling back to the standard price; verify-payment redeems it', () => {
  const create = read('api/create-order.js');
  assert.match(create, /if \(plan === 'pro'\) \{/);
  assert.match(create, /const offer = await activeOffer\(pool, input\.installId\);/);
  assert.match(create, /if \(offer\) plan = offer\.planCode;/);
  const verify = read('api/verify-payment.js');
  assert.match(verify, /redeemOffer\(pool, input\.installId, row\.plan_code, input\.subscriptionId\)/);
});
