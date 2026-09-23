import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBudget, budgetForMarket, cronAuthorized, planSweep, runSweep, isMarket,
  DEFAULT_DAILY_BUDGET } from '../lib/cron.js';
import { parseMarket, parseNewsQuery } from '../lib/news.js';

const srv = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('the sweep never spends more than the plan allows, whatever the environment says', () => {
  assert.equal(parseBudget('240'), 240);
  // A missing, broken or nonsense value under-fetches rather than overspending.
  for (const bad of [undefined, '', 'lots', '0', '-5', 'NaN']) assert.equal(parseBudget(bad), DEFAULT_DAILY_BUDGET);
  // The two runs together can never exceed the day's allowance.
  for (const total of [90, 100, 240, 1000]) {
    assert.ok(budgetForMarket('in', total) + budgetForMarket('us', total) <= total, 'total ' + total);
  }
  assert.ok(budgetForMarket('in', 100) > budgetForMarket('us', 100), 'India carries more companies');
  assert.equal(budgetForMarket('nope', 100), 0);
});

test('only the scheduler can start a run, because every run costs money', () => {
  assert.equal(cronAuthorized('Bearer s3cret', 's3cret'), true);
  assert.equal(cronAuthorized('Bearer wrong!', 's3cret'), false);
  assert.equal(cronAuthorized('s3cret', 's3cret'), false, 'the scheme is required');
  assert.equal(cronAuthorized('', 's3cret'), false);
  assert.equal(cronAuthorized(undefined, 's3cret'), false);
  // No secret configured is a closed door, not an open one.
  assert.equal(cronAuthorized('Bearer anything', ''), false);
  assert.equal(cronAuthorized('Bearer anything', undefined), false);
});

const co = (n, f) => ({ nameKey: n, name: n, followers: f });

test('most-followed first, already-fetched skipped, and the budget is a hard stop', () => {
  const companies = [co('a', 9), co('b', 5), co('c', 2), co('d', 1)];
  const all = planSweep(companies, [], 10);
  assert.deepEqual(all.todo.map((c) => c.nameKey), ['a', 'b', 'c', 'd']);

  // A re-run, or a company somebody already pulled on demand, costs nothing.
  const partial = planSweep(companies, ['a', 'c'], 10);
  assert.deepEqual(partial.todo.map((c) => c.nameKey), ['b', 'd']);

  // Out of budget stops on the long tail, never on the names everybody holds.
  const capped = planSweep(companies, [], 2);
  assert.deepEqual(capped.todo.map((c) => c.nameKey), ['a', 'b']);
  assert.equal(capped.skipped, 2);
});

test('one dead company does not end the sweep, but a dead provider does', async () => {
  const written = [];
  const flaky = async (c) => (c.nameKey === 'b' ? null : [{ title: c.nameKey }]);
  const r = await runSweep({ todo: [co('a', 1), co('b', 1), co('c', 1)], fetchOne: flaky,
    onWrite: (c, a) => { written.push([c.nameKey, a.length]); } });
  assert.deepEqual([r.fetched, r.failed, r.stopped], [2, 1, false]);
  assert.deepEqual(written, [['a', 1], ['c', 1]]);

  // Five refusals in a row is the provider saying no, not five odd companies.
  const dead = await runSweep({ todo: Array.from({ length: 40 }, (_, i) => co('x' + i, 1)),
    fetchOne: async () => null, stopAfterFailures: 5 });
  assert.equal(dead.stopped, true);
  assert.equal(dead.failed, 5, 'it stops rather than burning the rest of the budget');
});

test('a company with no news today is an answer, and is archived as one', async () => {
  const written = [];
  const r = await runSweep({ todo: [co('a', 1), co('b', 1)],
    fetchOne: async (c) => (c.nameKey === 'a' ? [] : [{ title: 't' }]),
    onWrite: (c, a) => { written.push([c.nameKey, a.length]); } });
  assert.deepEqual([r.fetched, r.empty, r.failed], [1, 1, 0]);
  // Both are written: an archived empty day is what stops it being asked again today.
  assert.deepEqual(written, [['a', 0], ['b', 1]]);
});

test('a thrown fetch is a failure, not a crashed sweep', async () => {
  const r = await runSweep({ todo: [co('a', 1), co('b', 1)],
    fetchOne: async (c) => { if (c.nameKey === 'a') throw new Error('socket'); return [{ title: 't' }]; } });
  assert.deepEqual([r.fetched, r.failed], [1, 1]);
});

test('the market is optional and closed: anything unknown is absent, not an error', () => {
  assert.equal(parseMarket('in'), 'in');
  assert.equal(parseMarket('us'), 'us');
  for (const bad of ['IN', 'uk', '', undefined, null, 'in; DROP', 1]) assert.equal(parseMarket(bad), null);
  assert.ok(isMarket('in') && isMarket('us') && !isMarket('uk'));
  // An older app that sends no market must still get its news.
  const q = parseNewsQuery({ name: 'Infosys', installId: 'a'.repeat(32) });
  assert.equal(q.ok, true);
  assert.equal(q.value.market, null);
});

test('the sweep runs before the app asks, and is wired to the two markets', () => {
  const vc = JSON.parse(srv('vercel.json'));
  assert.equal(vc.crons.length, 2, 'Hobby allows two');
  const at = Object.fromEntries(vc.crons.map((c) => [c.path.replace(/.*market=/, ''), c.schedule]));
  // 03:00 UTC = 08:30 IST (India) and 13:00 UTC = 18:30 IST (US), the owner's times. Hobby runs a daily
  // cron within its hour, so on the hour is the latest start that is never before the chosen minute.
  assert.equal(at.in, '0 3 * * *');
  assert.equal(at.us, '0 13 * * *');

  const feed = readFileSync(new URL('../../feed.js', import.meta.url), 'utf8');
  const anchors = feed.match(/FEED_ANCHORS = \{([\s\S]*?)\};/)[1];
  assert.match(anchors, /india: \{ h: 8, m: 30 \}/);
  assert.match(anchors, /us: \{ h: 18, m: 30 \}/, 'the US anchor sits after the US sweep');
});

test('the cron endpoint refuses before it spends, and stays inside the function limit', () => {
  const src = srv('api/cron-news.js');
  assert.match(src, /const isCron = cronAuthorized\(/);
  assert.match(src, /if \(!isCron && !isManual\) return json\(res, 401/);
  assert.ok(src.indexOf('cronAuthorized(') < src.indexOf('runSweep('), 'authorised before anything is fetched');
  assert.ok(src.indexOf('cronAuthorized(') < src.indexOf('getPool('), 'and before the database is touched');
  // The status check must not cost an upstream call: that is its whole purpose.
  const news = srv('api/news.js');
  const status = news.slice(news.indexOf("q.status === '1'"), news.indexOf('parseNewsQuery'));
  assert.equal(/marketauxUrl|takeQuota/.test(status), false, 'asking whether news is ready is free');
});

test('the admin page can trigger a run by hand, only when it is genuinely an admin request', () => {
  const src = srv('api/cron-news.js');
  assert.match(src, /req\.query && req\.query\.trigger === 'admin' && requireAdmin\(req\) === null/);
  assert.match(src, /import \{ requireAdmin \} from '\.\.\/lib\/admin\.js';/);
  // A manual run that fetched nothing (the market was already fully covered) must not overwrite a real
  // sweep's timestamp with a no-op one.
  assert.match(src, /if \(isCron \|\| todo\.length\) await setSweepState/);
  const html = srv('public/admin.html');
  assert.match(html, /id="nfSyncIn"/);
  assert.match(html, /id="nfSyncUs"/);
  assert.match(html, /trigger=admin/);
  assert.match(html, /function pendingCount\(m\)/);
});
