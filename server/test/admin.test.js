import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveInstall } from '../lib/store.js';
import { parsePayload } from '../lib/validate.js';
import { parseList, listSql, shapeInstalls, parsePlanChange, setPlan, getPlan, planAnswer, resolveAlias, LIST_SQL } from '../lib/installs.js';
import { aliasFor } from '../lib/alias.js';
import { requireAdmin, adminKeySet } from '../lib/admin.js';
import { readFileSync } from 'node:fs';
import { FEATURES } from '../lib/validate.js';

const ID = '4dcd6fca-1234-4abc-9def-0123456789ab';
const good = () => ({ v: 1, installId: ID, features: ['stocks'], plan: 'free', appVersion: 606, platform: 'android' });

function fakeConn() {
  const log = [];
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => { log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); },
  };
  return { log, getConnection: async () => conn };
}

test('a routine send never changes an install\'s plan: it is not in the UPDATE clause', async () => {
  const p = fakeConn();
  await saveInstall(p, parsePayload(good()).value);
  const upsert = p.log[0].sql;
  assert.match(upsert, /INSERT INTO installs/);
  const update = upsert.split('ON DUPLICATE KEY UPDATE')[1];
  assert.ok(update && !/plan/i.test(update), 'plan must not be updated by a send: ' + update);
});

test('a client claiming to be paid cannot start as paid: new installs are always inserted as free', async () => {
  const p = fakeConn();
  const claim = parsePayload({ ...good(), plan: 'paid' });   // the validator still accepts the field...
  await saveInstall(p, claim.value);                           // ...but the store ignores it
  assert.match(p.log[0].sql, /VALUES \(\?, \?, \?, \?, \?, 'free',/, 'plan is the literal free');
  assert.ok(!p.log[0].params.includes('paid'), 'the claimed plan never reaches the database');
});

const paging = (q) => { const { limit, offset } = parseList(q); return { limit, offset }; };

test('list paging is clamped so the page cannot be asked for everything at once', () => {
  assert.deepEqual(paging({}), { limit: 50, offset: 0 });
  assert.deepEqual(paging({ limit: '20', offset: '40' }), { limit: 20, offset: 40 });
  assert.equal(parseList({ limit: '99999' }).limit, 200);
  assert.equal(parseList({ limit: '0' }).limit, 50, 'zero falls back to the default');
  assert.equal(parseList({ limit: '-5' }).limit, 1);
  assert.equal(parseList({ offset: '-9' }).offset, 0);
  assert.deepEqual(paging({ limit: 'abc', offset: 'x' }), { limit: 50, offset: 0 });
  assert.match(LIST_SQL, /LIMIT \? OFFSET \?/, 'limit and offset are bound parameters, not concatenated');
});

test('a user filter is only accepted from the allow-list; anything else is dropped, not obeyed', () => {
  const f = parseList({ plan: 'paid', platform: 'android', activity: 'active7', q: 'A1B2', sort: 'firstSeen' });
  assert.deepEqual([f.plan, f.platform, f.activity, f.q, f.sort], ['paid', 'android', 'active7', 'a1b2', 'firstSeen']);
  const junk = parseList({ plan: 'vip', platform: 'toaster', activity: 'ever', sort: 'plan' });
  assert.deepEqual([junk.plan, junk.platform, junk.activity], [null, null, null]);
  assert.equal(junk.sort, 'lastSeen', 'an unknown sort falls back, it does not reach the SQL');
  assert.equal(parseList({ q: "'; DROP TABLE installs; --" }).q, null, 'a search that is not an id prefix is dropped');
  assert.equal(parseList({ activity: 'constructor' }).activity, null, 'inherited property names are not filters');
  assert.equal(parseList({ sort: 'toString' }).sort, 'lastSeen');
});

test('the filtered statement binds every value and counts exactly what it lists', () => {
  const { rows, count, params } = listSql(parseList({ plan: 'paid', platform: 'ios', activity: 'lapsed', q: 'ab' }));
  assert.deepEqual(params, ['paid', 'ios', 'ab%'], 'values are parameters, never pasted into the SQL');
  assert.ok(!/paid|ios|ab%/.test(rows), 'no filter value appears in the statement itself');
  // lastIndexOf: the SELECT carries a sub-query with a WHERE of its own, which is not the filter clause.
  const where = (s) => s.slice(s.lastIndexOf('WHERE')).split('ORDER BY')[0].trim();
  assert.equal(where(rows), where(count), 'rows and count share one WHERE, so the total always matches');
  assert.match(rows, /ORDER BY last_seen DESC/);
  assert.match(rows, /LIMIT \? OFFSET \?/);
  const none = listSql(parseList({}));
  assert.deepEqual(none.params, []);
  // The SELECT always carries one WHERE of its own, inside the features sub-query. With no filters that
  // must be the only one, and the count must have none at all.
  assert.equal(none.rows.split('WHERE').length - 1, 1, 'no filters adds no WHERE of its own');
  assert.ok(!none.count.includes('WHERE'), 'the count is unfiltered too');
});

test('install rows are shaped for the page, with features split into a list', () => {
  const rows = [{ install_id: ID, first_seen: 'a', last_seen: 'b', app_version: 606, platform: 'android', plan: 'paid',
    time_zone: 'Asia/Calcutta', language: 'en-IN', age_band: '25-34', gender: null, features: 'mf,stocks' },
    { install_id: 'b'.repeat(32), plan: 'free', features: null }];
  const s = shapeInstalls(rows, 2, 50, 0);
  assert.equal(s.total, 2);
  assert.deepEqual(s.installs[0].features, ['mf', 'stocks']);
  assert.equal(s.installs[0].plan, 'paid');
  assert.deepEqual(s.installs[1].features, [], 'no features is an empty list, not null');
  assert.deepEqual(shapeInstalls(undefined, 0, 50, 0).installs, []);
});

test('a plan change must name a real install id and one of the two plans', () => {
  assert.equal(parsePlanChange({ installId: ID, plan: 'paid' }).ok, true);
  assert.equal(parsePlanChange({ installId: ID, plan: 'free' }).ok, true);
  for (const bad of [null, 'x', [], { installId: ID }, { plan: 'paid' }, { installId: ID, plan: 'gold' },
    { installId: ID, plan: 'PAID' }, { installId: "x'; DROP TABLE installs;--", plan: 'paid' }, { installId: 'short', plan: 'paid' }]) {
    assert.equal(parsePlanChange(bad).ok, false, JSON.stringify(bad));
  }
});

test('setPlan updates exactly one install with bound parameters, and reports whether it existed', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: params[1] === ID ? 1 : 0 }]; } };
  assert.equal(await setPlan(pool, ID, 'paid'), true);
  assert.equal(await setPlan(pool, 'c'.repeat(32), 'paid'), false);
  assert.equal(calls[0].sql, 'UPDATE installs SET plan = ? WHERE install_id = ?');
  assert.deepEqual(calls[0].params, ['paid', ID]);
});

test('getPlan returns the stored plan, or null for an install the server has never seen', async () => {
  const pool = { query: async (sql, params) => [params[0] === ID ? [{ plan: 'paid' }] : []] };
  assert.equal(await getPlan(pool, ID), 'paid');
  assert.equal(await getPlan(pool, 'd'.repeat(32)), null);
});

test('admin is open when no ADMIN_KEY is set, and locks the moment one is', () => {
  const saved = process.env.ADMIN_KEY;
  try {
    delete process.env.ADMIN_KEY;
    assert.equal(adminKeySet(), false);
    assert.equal(requireAdmin({ headers: {} }), null, 'open by the owner\'s decision');
    process.env.ADMIN_KEY = 'secret-123';
    assert.equal(adminKeySet(), true);
    assert.equal(requireAdmin({ headers: {} }), 'bad admin key');
    assert.equal(requireAdmin({ headers: { 'x-admin-key': 'nope' } }), 'bad admin key');
    assert.equal(requireAdmin({ headers: { 'x-admin-key': 'secret-123' } }), null);
    assert.equal(requireAdmin({ headers: {}, query: { k: 'secret-123' } }), null);
  } finally {
    if (saved === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = saved;
  }
});

test('the membership answer says the plan and whether the server knows this install', async () => {
  const pool = { query: async (sql, params) => [params[0] === ID ? [{ plan: 'paid' }] : []] };
  assert.deepEqual(await planAnswer(pool, ID), { plan: 'paid', known: true });
  assert.deepEqual(await planAnswer(pool, 'e'.repeat(32)), { plan: 'free', known: false }, 'an unseen install is free and unknown');
  const freePool = { query: async () => [[{ plan: 'free' }]] };
  assert.deepEqual(await planAnswer(freePool, ID), { plan: 'free', known: true });
});

// The dashboard labels features from its own maps. If a feature is added to the allow-list and not to
// them, it would show on the page as a bare id like 'banksav' - so the page is checked against the list.
test('the admin page has a name and an icon for every feature the server accepts', () => {
  const page = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
  const map = (name) => {
    const at = page.indexOf('const ' + name + ' =');
    assert.ok(at > -1, name + ' map is missing from admin.html');
    return page.slice(at, page.indexOf('};', at));
  };
  const names = map('NAMES');
  const icons = map('ICONS');
  // Plain string search, not a regex: the maps are written `id:'value'`, so this is exact and there is no
  // escaping to get wrong.
  for (const id of FEATURES) {
    assert.ok(names.includes(id + ":'"), id + ' has no display name in admin.html');
    assert.ok(icons.includes(id + ":'"), id + ' has no icon in admin.html');
  }
});

// The anonymous name: a person quotes it when asking for help, and the admin page has to find them by it.
test('the search box takes either an anonymous name or an install-id prefix', () => {
  const byName = parseList({ q: '@swift-otter-4821' });
  assert.equal(byName.alias, 'swift-otter-4821', 'the @ is optional and the name is lower-cased');
  assert.equal(byName.q, null, 'a name is not treated as an id prefix');
  assert.equal(parseList({ q: 'Swift-Otter-4821' }).alias, 'swift-otter-4821');

  const byId = parseList({ q: 'abd4bd' });
  assert.equal(byId.q, 'abd4bd');
  assert.equal(byId.alias, null);

  for (const junk of ['not a name', 'swift-otter', "'; DROP TABLE installs; --"]) {
    const f = parseList({ q: junk });
    assert.equal(f.alias, null, junk);
  }
});

test('a name is resolved to the one install behind it, and an unknown name matches nobody', async () => {
  const ids = ['4dcd6fca-1234-4abc-9def-0123456789ab', 'abd4bd72-0000-4000-8000-000000000001'];
  const pool = { query: async () => [ids.map((install_id) => ({ install_id }))] };
  const known = aliasFor(ids[1]);
  assert.equal(await resolveAlias(pool, known), ids[1]);
  assert.equal(await resolveAlias(pool, '@' + known), ids[1], 'with or without the @');
  assert.equal(await resolveAlias(pool, 'nobody-here-1111'), null, 'an unknown name finds no one');
  assert.equal(await resolveAlias(pool, ''), null);
});

test('every listed install carries its anonymous name, so the admin page can show it', () => {
  const rows = [{ install_id: '4dcd6fca-1234-4abc-9def-0123456789ab', plan: 'free', features: null }];
  const s = shapeInstalls(rows, 1, 50, 0);
  assert.equal(s.installs[0].alias, aliasFor(rows[0].install_id));
  assert.match(s.installs[0].alias, /^[a-z]+-[a-z]+-\d{4}$/);
});
