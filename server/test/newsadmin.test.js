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
  assert.match(html, /Today \(0\)[\s\S]{0,200}All \(0\)/, 'the same Today / All split the Feed has');
  // Today lists what was CHECKED, not only what came back with something: a company checked and
  // found empty is the answer to "why does the app show no news for this one".
  assert.match(html, /filter\(\(c\) => c\.checkedToday\)/);
  assert.match(html, /Checked today, nothing found/);
  // The difference from the app's own reading is stated on the page rather than left to be discovered.
  assert.match(html, /filters each article against the user's own typed holding name/);
});
