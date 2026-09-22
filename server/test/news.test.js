import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseNewsQuery, cacheKeyFor, trimArticles, marketauxUrl, weekKey, installHash, clampSince, dayStr, ARCHIVE_DAYS, PROVIDER_BACKOFF_MS } from '../lib/news.js';
import { todayIsFresh, providerBlocked, noteProviderFailure, clearProviderFailure } from '../lib/newsstore.js';

const ID = '4dcd6fca-1234-4abc-9def-0123456789ab';

test('a news request must name a real company and a real install', () => {
  const ok = parseNewsQuery({ name: 'Reliance Industries', installId: ID });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, 'Reliance Industries');
  for (const bad of [{}, { name: 'R', installId: ID }, { name: 'Reliance' }, { name: 'Reliance', installId: 'nope' },
    { name: 'x'.repeat(81), installId: ID }, { name: '<script>alert(1)</script>', installId: ID },
    { name: "Reliance'; DROP TABLE news_archive; --", installId: ID }]) {
    assert.equal(parseNewsQuery(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(parseNewsQuery({ name: 'Larsen & Toubro (L-T)', installId: ID }).ok, true, 'real names carry & ( ) and -');
  assert.equal(parseNewsQuery({ name: '  Tata   Motors  ', installId: ID }).value.name, 'Tata Motors', 'spacing is tidied');
});

test('one cache entry per company however it was typed', () => {
  const k = cacheKeyFor('Reliance Industries');
  assert.equal(cacheKeyFor('  reliance   industries '), k);
  assert.equal(cacheKeyFor('RELIANCE INDUSTRIES.'), k);
  assert.notEqual(cacheKeyFor('Reliance Power'), k);
});

test('how far back a client may ask is clamped, so a long-shut app gets what exists instead of an error', () => {
  const now = Date.parse('2026-09-21T10:00:00Z');
  const oldest = dayStr(now - (ARCHIVE_DAYS - 1) * 86400000);
  assert.equal(clampSince('2020-01-01', now), oldest, 'a month ago is pulled forward to the archive window');
  assert.equal(clampSince('2026-09-20', now), '2026-09-20', 'a day inside the window is kept');
  assert.equal(clampSince('2099-01-01', now), '2026-09-21', 'the future is pulled back to today');
  assert.equal(clampSince(undefined, now), oldest);
  assert.equal(clampSince('rubbish', now), oldest);
});

test('only the fields the Feed reads are stored, and each is bounded', () => {
  const trimmed = trimArticles({ data: [{
    title: 'T'.repeat(500), description: 'D'.repeat(900), source: 'src', url: 'https://x/y',
    published_at: '2026-09-21T09:00:00Z', uuid: 'drop-me', similar: [1, 2, 3],
    entities: [{ name: 'Reliance', symbol: 'RELIANCE.NS', sentiment_score: 0.4, industry: 'drop-me' }],
  }] });
  assert.equal(trimmed.length, 1);
  assert.deepEqual(Object.keys(trimmed[0]).sort(), ['description', 'entities', 'published_at', 'source', 'title', 'url']);
  assert.equal(trimmed[0].title.length, 300, 'long fields are cut, not stored whole');
  assert.equal(trimmed[0].description.length, 600);
  assert.deepEqual(Object.keys(trimmed[0].entities[0]).sort(), ['name', 'sentiment_score', 'symbol']);
  assert.deepEqual(trimArticles(null), [], 'a malformed provider response is an empty day, not a crash');
  assert.equal(trimArticles({ data: new Array(20).fill({ title: 'x' }) }).length, 3, 'at most three a day');
});

test('the provider key goes in the upstream URL and nowhere near the client', () => {
  const url = marketauxUrl('Reliance', 'SECRET-KEY', Date.parse('2026-09-21T10:00:00Z'));
  assert.ok(url.startsWith('https://api.marketaux.com/'));
  assert.match(url, /api_token=SECRET-KEY/);
  assert.match(url, /published_after=2026-09-20T10%3A00%3A00/, 'the last 24 hours only');
});

test('a follower cannot be traced to an install, joined across weeks, or grouped into a portfolio', async () => {
  const w1 = weekKey(new Date('2026-09-21T00:00:00Z'));
  const w2 = weekKey(new Date('2026-09-28T00:00:00Z'));
  assert.notEqual(w1, w2, 'the week rolls');

  const reliance = cacheKeyFor('Reliance');
  const tcs = cacheKeyFor('TCS');
  const a = await installHash(ID, 'secret', w1, reliance);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(await installHash(ID, 'secret', w1, reliance), a, 'stable within a week, so a person counts once');

  // The three things that must NOT be derivable:
  assert.notEqual(await installHash(ID, 'secret', w2, reliance), a, 'a new week is a new value: weeks cannot be joined');
  assert.notEqual(await installHash(ID, 'secret', w1, tcs), a, 'a different company is a different value: no basket to group');
  assert.notEqual(await installHash(ID, 'other-secret', w1, reliance), a, 'without the secret the value cannot be reproduced');
  assert.ok(!a.includes(ID.slice(0, 8)), 'the install id does not survive into the stored value');
});

// One upstream call per company per day. The allowance is a hundred requests, so a company opened in
// the morning and again in the evening must not cost two of them.
test('a company already fetched today is not fetched again until tomorrow', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const today = dayStr(now);
  assert.equal(todayIsFresh([{ day: today, fetchedAt: new Date(now - 60 * 60 * 1000) }], now), true, 'an hour old is done');
  assert.equal(todayIsFresh([{ day: today, fetchedAt: new Date(now - 13 * 60 * 60 * 1000) }], now), true,
    'and so is thirteen hours old - the day is what counts, not a rolling window');
  // An empty day is an answer, not a failure: the provider was asked and had nothing.
  assert.equal(todayIsFresh([{ day: today, fetchedAt: new Date(now), data: [] }], now), true);
  // A day that was never written - provider down, or refused - has no row, so it is retried.
  assert.equal(todayIsFresh([{ day: dayStr(now - 86400000), fetchedAt: new Date(now) }], now), false, 'yesterday is not today');
  assert.equal(todayIsFresh([], now), false);
});

// After the provider refuses us, stop asking for a while. Without this, every sync from every phone
// keeps calling a provider that is already saying no, and each refusal still counts against the daily
// allowance - a bad key drained a whole day's requests in minutes on 21 Sep 2026.
test('a provider refusal starts a cool-off, and a success ends it', async () => {
  const rows = new Map();
  const pool = { query: async (sql, params) => {
    if (/INSERT INTO news_state/i.test(sql)) { rows.set('provider_fail', params[0]); return [{}]; }
    if (/DELETE FROM news_state/i.test(sql)) { rows.delete('provider_fail'); return [{}]; }
    if (/SELECT at FROM news_state/i.test(sql)) {
      const at = rows.get('provider_fail');
      return [at ? [{ at }] : []];
    }
    return [[]];
  } };
  const now = Date.parse('2026-09-21T12:00:00Z');
  assert.equal(await providerBlocked(pool, now), false, 'nothing refused yet: the provider is tried');

  await noteProviderFailure(pool, new Date(now));
  assert.equal(await providerBlocked(pool, now + 60 * 1000), true, 'a minute later we are still holding off');
  assert.equal(await providerBlocked(pool, now + PROVIDER_BACKOFF_MS + 1000), false, 'the cool-off expires on its own');

  await noteProviderFailure(pool, new Date(now));
  await clearProviderFailure(pool);
  assert.equal(await providerBlocked(pool, now + 60 * 1000), false, 'a working call lets everyone straight back through');
});

test('the cool-off never blocks the Feed when the database itself is unhappy', async () => {
  const broken = { query: async () => { throw new Error('db down'); } };
  assert.equal(await providerBlocked(broken), false, 'on doubt, try the provider rather than block');
  await noteProviderFailure(broken);   // must not throw
  await clearProviderFailure(broken);  // must not throw
});

// Every endpoint the APP calls must answer with CORS, because the app and the server are different
// origins. /api/news went without it for a long time and the failure was invisible from the server's
// side: the request arrives, the work is done, the day is archived, and only the browser ever sees the
// problem - it throws the answer away, every company counts as an error, and the Feed's "last synced"
// stamp is never written. This guards the whole app-facing set, not just the one that broke.
test('every app-facing endpoint sets CORS headers and answers a preflight', () => {
  for (const f of ['news.js', 'plan.js', 'collect.js', 'forget.js', 'create-order.js', 'verify-payment.js']) {
    const src = readFileSync(new URL('../api/' + f, import.meta.url), 'utf8');
    assert.match(src, /matchOrigin\(req\.headers\.origin/, f + ' does not set an allowed origin');
    assert.match(src, /Access-Control-Allow-Origin/, f + ' never sends the header');
    assert.match(src, /OPTIONS/, f + ' does not answer a preflight');
  }
});
