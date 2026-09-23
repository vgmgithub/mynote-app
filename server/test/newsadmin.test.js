import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { shapeNewsAdmin, dayVerdict, articleSentiment, POS, NEG } from '../lib/newsadmin.js';

const art = (o = {}) => ({ title: 't', source: 's', url: 'https://x', published_at: '2026-09-22T05:00:00Z', entities: [], ...o });
const ent = (name, score) => ({ name, sentiment_score: score });
const row = (name_key, day, articles, name) => ({ name_key, day, name: name || name_key, payload: JSON.stringify(articles), fetched_at: '2026-09-22T04:00:00Z' });

test('an article is scored by THIS company\'s entity, not an average across everyone mentioned', () => {
  const a = art({ entities: [ent('Suzlon', 0.8), ent('Tata Steel', -0.9)] });
  assert.equal(articleSentiment(a, 'Suzlon'), 0.8);
  assert.equal(articleSentiment(a, 'Tata Steel'), -0.9);
  // No entity for this company: fall back to the average rather than inventing a number.
  assert.equal(articleSentiment(art({ entities: [ent('X', 0.4), ent('Y', 0.6)] }), 'Suzlon'), 0.5);
  // Nothing to go on is neutral, never a crash.
  assert.equal(articleSentiment(art({ entities: [] }), 'Suzlon'), 0);
  assert.equal(articleSentiment(art({ entities: [ent('Suzlon', null)] }), 'Suzlon'), 0);
  assert.equal(articleSentiment(null, 'Suzlon'), 0);
});

test('a day takes the majority, on the same thresholds the app uses', () => {
  const pos = art({ entities: [ent('A', 0.5)] });
  const neg = art({ entities: [ent('A', -0.5)] });
  const neu = art({ entities: [ent('A', 0.01)] });
  assert.equal(dayVerdict([pos, pos, neg], 'A').sentiment, 'pos');
  assert.equal(dayVerdict([neg, neg, pos], 'A').sentiment, 'neg');
  assert.equal(dayVerdict([pos, neg], 'A').sentiment, 'neu', 'a tie is neutral');
  assert.equal(dayVerdict([neu, neu], 'A').sentiment, 'neu');
  assert.equal(dayVerdict([], 'A').sentiment, 'neu');
  // The thresholds themselves, so a drift in either direction is caught.
  assert.equal(POS, 0.15);
  assert.equal(NEG, -0.15);
  assert.equal(dayVerdict([art({ entities: [ent('A', 0.15)] })], 'A').sentiment, 'neu', 'exactly at the line is not positive');
});

test('companies are grouped, newest day first, and today is told apart from the week', () => {
  const rows = [
    row('suzlon', '2026-09-22', [art({ entities: [ent('Suzlon', -0.5)] })], 'Suzlon'),
    row('suzlon', '2026-09-20', [art({ entities: [ent('Suzlon', 0.5) ] })], 'Suzlon'),
    row('lg', '2026-09-21', [art({ entities: [ent('LG', 0.6)] })], 'LG'),
  ];
  const s = shapeNewsAdmin(rows, new Map([['suzlon', 9], ['lg', 2]]), '2026-09-22');
  const suz = s.companies.find((c) => c.nameKey === 'suzlon');
  assert.deepEqual(suz.days.map((d) => d.day), ['2026-09-22', '2026-09-20'], 'newest first');
  assert.equal(suz.todayCount, 1);
  assert.equal(suz.checkedToday, true);
  assert.equal(suz.followers, 9);
  assert.equal(suz.total, 2);
  // LG has nothing today: still listed, but not counted as today's news.
  const lg = s.companies.find((c) => c.nameKey === 'lg');
  assert.equal(lg.todayCount, 0);
  assert.equal(lg.checkedToday, false);
  // The company with news today sorts above one without, whatever the follower counts say.
  assert.equal(s.companies[0].nameKey, 'suzlon');
  assert.deepEqual(s.totals, { companies: 2, withNewsToday: 1, checkedToday: 1, articlesToday: 1, articles: 3 });
});

test('a day the sweep checked and found nothing is not the same as a company never looked at', () => {
  const s = shapeNewsAdmin([row('a', '2026-09-22', [], 'A')], new Map(), '2026-09-22');
  const a = s.companies[0];
  assert.equal(a.checkedToday, true, 'we did look');
  assert.equal(a.todayCount, 0, 'and found nothing');
  assert.equal(s.totals.checkedToday, 1);
  assert.equal(s.totals.withNewsToday, 0);
});

// MySQL DATE columns come back from mysql2 as JS Date objects, not 'YYYY-MM-DD' strings - the pool
// in lib/db.js does not set dateStrings. Every test above passes strings, which is exactly why they
// all stayed green while Today, Quiet and the coverage bar read zero on a real database: a Date
// never equals a date string, so nothing was ever "checked today". readArchive (lib/newsstore.js)
// already normalises this; the shaper has to as well, since it is the boundary rows arrive at.
test('a day arrives as a Date object from MySQL and is read the same as a string', () => {
  const asDate = shapeNewsAdmin([
    { name_key: 'a', day: new Date('2026-09-22T00:00:00Z'), name: 'A', payload: JSON.stringify([art({ entities: [ent('A', 0.5)] })]), fetched_at: null },
    { name_key: 'a', day: new Date('2026-09-20T00:00:00Z'), name: 'A', payload: JSON.stringify([art({ entities: [ent('A', -0.5)] })]), fetched_at: null },
    { name_key: 'b', day: new Date('2026-09-22T00:00:00Z'), name: 'B', payload: JSON.stringify([]), fetched_at: null },
  ], new Map(), '2026-09-22');

  const a = asDate.companies.find((c) => c.nameKey === 'a');
  assert.equal(a.checkedToday, true, 'a Date for today must count as today');
  assert.equal(a.todayCount, 1);
  // The day must be a plain string downstream: the sort, the lookup and the dot label all assume it.
  assert.deepEqual(a.days.map((d) => d.day), ['2026-09-22', '2026-09-20'], 'newest first, as strings');
  // Sorting Date objects via String() orders them by weekday name, so this is what caught it.
  assert.equal(typeof a.days[0].day, 'string');
  // And the totals, which are what the Today / Quiet tabs and the coverage bar are counted from.
  assert.equal(asDate.totals.checkedToday, 2);
  assert.equal(asDate.totals.withNewsToday, 1);
  const b = asDate.companies.find((c) => c.nameKey === 'b');
  assert.equal(b.checkedToday, true, 'checked and empty is still checked');
  assert.equal(b.todayCount, 0);
});

test('a company with no followers recorded still shows, counted as zero rather than dropped', () => {
  const s = shapeNewsAdmin([row('x', '2026-09-22', [art({ entities: [ent('X', 0.9)] })], 'X')], new Map(), '2026-09-22');
  assert.equal(s.companies[0].followers, 0);
});

test('a payload that is not readable is an empty day, never a crash', () => {
  const bad = [{ name_key: 'x', day: '2026-09-22', name: 'X', payload: 'not json', fetched_at: null }];
  assert.doesNotThrow(() => shapeNewsAdmin(bad, new Map(), '2026-09-22'));
  assert.equal(shapeNewsAdmin(bad, new Map(), '2026-09-22').companies[0].total, 0);
  assert.deepEqual(shapeNewsAdmin([], new Map(), '2026-09-22').companies, []);
  assert.doesNotThrow(() => shapeNewsAdmin(null, undefined, '2026-09-22'));
});

test('the admin news view is folded in, behind the same admin check, and stays inside the function limit', () => {
  const src = readFileSync(new URL('../api/admin/installs.js', import.meta.url), 'utf8');
  assert.ok(src.indexOf('requireAdmin(req)') < src.indexOf("view === 'news'"), 'admin is checked before the branch');
  assert.match(src, /Cache-Control', 'no-store'/);
  // The follower join must stay a COUNT over hashed followers - never a row that names anybody.
  assert.match(src, /COUNT\(DISTINCT follower\)/);
  assert.equal(/SELECT[^;]*\binstall_id\b[^;]*FROM stock_usage/.test(src), false, 'no install id is read out of stock_usage');
  const count = (dir) => readdirSync(dir).reduce((n, f) => {
    const p = new URL(f, dir);
    return n + (statSync(p).isDirectory() ? count(new URL(f + '/', dir)) : 1);
  }, 0);
  assert.ok(count(new URL('../api/', import.meta.url)) <= 12, 'still within Hobby');
});

test('the admin page reads the same window and says how its reading differs from a phone\'s', () => {
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /view=news/);
  assert.match(html, /nf-users/, 'follower count is shown, which the app never does');
  // Four tabs, in the order they answer questions: what came back, what was asked and had nothing,
  // what the allowance never reached, and the whole window.
  assert.match(html, /id="nfToday"[\s\S]{0,200}id="nfQuiet"[\s\S]{0,200}id="nfExpired"[\s\S]{0,200}id="nfAll"/);
  assert.match(html, /nfMode === 'today'\) list = list\.filter\(\(c\) => c\.todayCount > 0\)/);
  assert.match(html, /nfMode === 'quiet'\) list = list\.filter\(\(c\) => c\.checkedToday && c\.todayCount === 0\)/);
  assert.match(html, /nfMode === 'expired'\) list = list\.filter\(\(c\) => !c\.checkedToday\)/);
  assert.match(html, /Checked today, nothing found/);
  // Dots are for All alone: the other three are a single date, so a timeline there says nothing.
  assert.match(html, /const isAll = nfMode === 'all'/);
  assert.match(html, /if \(isAll && c\.days\.length\)/);
  // One company fetched is one upstream request, so "checked today" is the request count.
  assert.match(html, /nfData\.totals\.checkedToday, limit = nfData\.budget/);
  // This endpoint is behind ADMIN_KEY, so it must go through adminFetch - the thing that prompts for
  // the key and remembers it. A bare fetch just returns 401 with nowhere to type.
  assert.match(html, /adminFetch\('\/api\/admin\/installs\?view=news'\)/);
  assert.equal(/fetch\('\/api\/admin\/installs\?view=news'/.test(html), false, 'never a bare fetch');
});

test('one Refresh covers every tab already opened, and never spends a Razorpay call on one that was not', () => {
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const fn = html.slice(html.indexOf('async function refreshAll'), html.indexOf("document.getElementById('refresh').addEventListener"));
  assert.match(fn, /jobs = \[load\(true\)\]/, 'stats always refresh');
  // Each of the other three only when that tab has actually been opened. Payments is the one that
  // matters: it calls Razorpay's API, so refreshing it for somebody who never opened the tab would
  // spend a request on their behalf.
  assert.match(fn, /if \(payLoaded\) jobs\.push\(loadPayments\(\)\)/);
  assert.match(fn, /if \(nfData\) jobs\.push\(loadNewsFeed\(\)\)/);
  assert.match(fn, /if \(usersLoaded\) jobs\.push\(loadUsers\(false\)\)/);
  // allSettled, not all: one endpoint being down must not stop the others refreshing.
  assert.match(fn, /Promise\.allSettled\(jobs\)/);
  // A second press while one is in flight does nothing, and the button says what is happening.
  assert.match(fn, /if \(refreshing\) return/);
  assert.match(fn, /btn\.disabled = true/);
  assert.match(fn, /finally/, 'the button is always restored, including on failure');

  // Coming back to a long-open tab refreshes, but only if it has actually gone stale - otherwise
  // flicking between tabs would fire a burst of requests.
  assert.match(html, /visibilityState !== 'visible'\) return/);
  assert.match(html, /Date\.now\(\) - lastRefreshAt < REFRESH_STALE_MS\) return/);
  assert.equal(/setInterval\(\s*refreshAll/.test(html), false, 'no polling: it costs Razorpay calls with nobody watching');
  // The difference from the app's own reading is stated on the page rather than left to be discovered.
  assert.match(html, /filters each article against the user's own typed holding name/);
});

// v766: India and US told apart on the admin page.
test('each company carries its market, and the page groups and badges by it', () => {
  const row = (key, day, name) => ({ name_key: key, day, name, payload: '[]', fetched_at: day + 'T03:10:00Z' });
  const s = shapeNewsAdmin([row('tcs', '2026-09-22', 'TCS'), row('aapl', '2026-09-22', 'Apple'), row('x', '2026-09-22', 'X')],
    new Map(), '2026-09-22', new Map([['tcs', 'in'], ['aapl', 'us']]));
  const by = Object.fromEntries(s.companies.map((c) => [c.nameKey, c.market]));
  assert.deepEqual(by, { tcs: 'in', aapl: 'us', x: null });
  assert.deepEqual(s.markets, { in: 1, us: 1, other: 1 });
  assert.equal(shapeNewsAdmin([row('a', '2026-09-22', 'A')], new Map(), '2026-09-22').companies[0].market, null, 'no market map: null, not a crash');
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="nfMkts"/);
  assert.match(html, /class: 'mkt ' \+ m/);
  assert.match(html, /\['in', 'India'\], \['us', 'US'\]/, 'India first, then the US, under their own headings');
});

test('the admin key is asked once, kept for a day, and one question serves every waiting request', () => {
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /const KEY_TTL_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(html, /if \(keyAsk\) return keyAsk;/, 'single question in flight');
  assert.equal(/window\.prompt\(/.test(html), false, 'no plain-text prompt for a secret');
  assert.match(html, /id="keyIn" type="password"/);
  assert.match(html, /class: 'upkg ' \+ sub\.period/, 'the package pill sits with the features');
});

test('regions read as countries (old aliases included) and languages as names', () => {
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const tz = html.match(/const TZ_CC = Object\.fromEntries\('([^']+)'/)[1];
  const map = Object.fromEntries(tz.split(',').map((p) => p.split(':')));
  assert.equal(map['Asia/Calcutta'], 'IN', 'the alias phones still report');
  assert.equal(map['Asia/Kolkata'], 'IN');
  assert.equal(map['America/New_York'], 'US');
  assert.equal(map['Europe/London'], 'GB');
  assert.ok(Object.keys(map).length > 400);
  assert.match(html, /byCountry\(d\.regions\)/);
  assert.match(html, /languageOf\(l\.key\)/);
});
