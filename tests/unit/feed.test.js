import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dueGroups, shouldAutoRefresh, feedGroupFor, FEED_GROUPS, feedAnchorFor, isFeedExempt } from '../../feed.js';

// IST is UTC+5:30, and the anchors are expressed in IST: India 08:30, US 18:00.
const ist = (s) => Date.parse(s + '+05:30');

// An SGB (category BONDS) and an ETF/commodity tracker have no company to have news about - neither
// is fetched, shown, or spends one of the 100 daily requests. Every other category still is.
test('isFeedExempt: Bonds (SGBs) and ETFs/Commodities are left out of the Feed, everything else stays in', () => {
  assert.equal(isFeedExempt({ category: 'BONDS' }), true);
  assert.equal(isFeedExempt({ category: 'Bonds' }), true, 'case-insensitive, like every other category check here');
  assert.equal(isFeedExempt({ category: 'ETFs & Commodities' }), true);
  assert.equal(isFeedExempt({ category: 'etfs & commodities' }), true);
  assert.equal(isFeedExempt({ category: 'Technology' }), false);
  assert.equal(isFeedExempt({ category: '' }), false);
  assert.equal(isFeedExempt({}), false);
});

test('each market syncs on its own anchor', () => {
  assert.deepEqual(feedAnchorFor('me-in'), { h: 8, m: 30 });
  assert.deepEqual(feedAnchorFor('wife-in'), { h: 8, m: 30 });
  // 18:30, half an hour after the server's own US sweep at 18:00 IST, so the archive is already
  // filled by the time a phone asks (server/vercel.json crons).
  assert.deepEqual(feedAnchorFor('me-us'), { h: 18, m: 30 });
  assert.deepEqual(feedGroupFor('me-in'), ['me-in', 'wife-in'], 'the India portfolios sync together');
  assert.deepEqual(feedGroupFor('wife-in'), ['me-in', 'wife-in']);
  assert.deepEqual(feedGroupFor('me-us'), ['me-us'], 'the US is its own group');
});

test('a market that is past its anchor is due, one sync per session however often the app is opened', () => {
  const now = ist('2026-09-21T19:00:00');
  assert.equal(shouldAutoRefresh(ist('2026-09-21T18:30:00'), 'me-us', now), false, 'already synced after 18:00 today');
  assert.equal(shouldAutoRefresh(ist('2026-09-21T17:00:00'), 'me-us', now), true, 'last sync was before today\'s anchor');
  assert.equal(shouldAutoRefresh(0, 'me-us', now), true, 'never synced');
  // Before the anchor, yesterday's sync still counts.
  const morning = ist('2026-09-21T09:00:00');
  assert.equal(shouldAutoRefresh(ist('2026-09-20T19:00:00'), 'me-us', morning), false, 'the US anchor has not come round yet');
  assert.equal(shouldAutoRefresh(ist('2026-09-20T19:00:00'), 'me-in', morning), true, 'India passed 08:30 this morning');
});

// The bug this guards against: the auto-sync used to look only at the portfolio on screen, so somebody
// who lives on the India tab never synced the US one - it needed them to open the app with the US tab
// selected AND be past 18:00 IST. The US feed sat days behind.
test('every market that is due is returned, not just the one being looked at', () => {
  const now = ist('2026-09-21T19:00:00');          // past both anchors today
  const lastFetch = {
    'me-in': ist('2026-09-21T09:00:00'),           // India already synced this morning
    'wife-in': ist('2026-09-21T09:00:00'),
    'me-us': ist('2026-09-17T18:30:00'),           // the US has not synced in four days
  };
  const due = dueGroups((p) => lastFetch[p], now);
  assert.deepEqual(due, [['me-us']], 'the US is due even while India is up to date');

  const allStale = dueGroups(() => ist('2026-09-15T12:00:00'), now);
  assert.deepEqual(allStale, FEED_GROUPS, 'both markets due means both are synced');

  const fresh = dueGroups((p) => (p === 'me-us' ? ist('2026-09-21T18:30:00') : ist('2026-09-21T09:00:00')), now);
  assert.deepEqual(fresh, [], 'nothing due means nothing is fetched');

  // One stale portfolio pulls its whole group, because they are fetched together anyway.
  const halfIndia = dueGroups((p) => (p === 'wife-in' ? ist('2026-09-15T12:00:00') : ist('2026-09-21T18:30:00')), now);
  assert.deepEqual(halfIndia, [['me-in', 'wife-in']]);
});

// v768: the server collects once a day per market; phones read it, and Sync now waits for the round.
test('Sync now opens at 8:35 AM / 6:35 PM, or as soon as the round has run', async () => {
  const f = await import('../../feed.js');
  const at = (hhmm) => ist('2026-09-24T' + hhmm + ':00');
  const inA = f.todayAnchorMs('me-in', at('07:00'));
  assert.equal(f.fmtIST(inA), '8:30 AM');
  assert.equal(f.fmtIST(f.todayAnchorMs('me-us', at('07:00'))), '6:30 PM');
  const s = (hhmm, ready, p = 'me-in') => f.syncButtonState({ online: true, nowMs: at(hhmm), anchorMs: f.todayAnchorMs(p, at(hhmm)), ready });
  assert.deepEqual([s('07:00', false).enabled, s('07:00', false).label], [false, 'Opens 8:35 AM'], 'before the round');
  assert.equal(s('08:34', false).enabled, false);
  assert.equal(s('08:35', false).enabled, true, 'opens 5 minutes after the anchor even if the round is late');
  assert.equal(s('08:31', true).enabled, true, 'opens as soon as the round has run');
  assert.equal(s('12:00', false, 'me-us').label, 'Opens 6:35 PM', 'US waits for its own evening round');
  assert.equal(f.syncButtonState({ online: false, nowMs: at('10:00'), anchorMs: inA, ready: true }).enabled, false, 'offline');
});

test('an automatic sync reads only when there is something new, and never before the round', async () => {
  const f = await import('../../feed.js');
  const d = (o) => f.autoSyncDecision({ lastFetchMs: 1, anchorDue: false, ready: false, beforeTodayAnchor: false, lastWrite: null, seenWrite: null, ...o });
  assert.equal(d({ lastFetchMs: 0 }), 'read', 'a device that never synced reads what the archive holds');
  assert.equal(d({ anchorDue: true, ready: true }), 'read', 'the round has run: read it');
  assert.equal(d({ anchorDue: true, ready: false }), 'wait', 'the round is due but has not run: wait, do not ask every company');
  assert.equal(d({ anchorDue: true, beforeTodayAnchor: true }), 'read', 'before today\'s time, the round that passed is yesterday\'s');
  assert.equal(d({ lastWrite: '2026-09-24T03:10:00.000Z', seenWrite: '2026-09-24T03:05:00.000Z' }), 'read', 'the server gained news since the last read');
  assert.equal(d({ lastWrite: '2026-09-24T03:05:00.000Z', seenWrite: '2026-09-24T03:05:00.000Z' }), 'wait', 'nothing new');
});

test('automatic syncs send read=1 and the header trusts the device, not the round counter', () => {
  const src = readFileSync(new URL('../../feed-ui.js', import.meta.url), 'utf8');
  assert.match(src, /\{ read: silent \}/);
  assert.equal(/st\.sweep && \(st\.sweep\.fetched \|\| 0\)/.test(src), false, 'the "no new stories" line no longer comes from the round\'s own counter');
  assert.match(src, /if \(device\) return;/, 'the server answer never overwrites what the device holds');
  assert.match(src, /export function watchFeedSync\(\)/);
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  assert.match(app, /watchFeedSync\(\);/);
  const feed = readFileSync(new URL('../../feed.js', import.meta.url), 'utf8');
  assert.match(feed, /if \(read\) params\.set\('read', '1'\);/);
});

test('every holdings list the Feed builds - the tab, the cross-portfolio digest, and the actual fetch - excludes the same categories', () => {
  const src = readFileSync(new URL('../../feed-ui.js', import.meta.url), 'utf8');
  const uses = [...src.matchAll(/!mod\.isFeedExempt\(s\)/g)].length;
  assert.equal(uses, 3, 'renderFeed, _buildCrossPortfolioDigest and the fetch-scope builder must all call the one shared predicate');
  assert.doesNotMatch(src, /toUpperCase\(\) !== 'BONDS'/, 'no leftover hand-rolled BONDS check now that isFeedExempt covers it');
});
