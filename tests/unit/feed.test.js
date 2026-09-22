import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueGroups, shouldAutoRefresh, feedGroupFor, FEED_GROUPS, feedAnchorFor } from '../../feed.js';

// IST is UTC+5:30, and the anchors are expressed in IST: India 08:30, US 18:00.
const ist = (s) => Date.parse(s + '+05:30');

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
