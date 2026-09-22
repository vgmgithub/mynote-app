import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveInstall } from '../lib/store.js';
import { parsePayload } from '../lib/validate.js';
import { parseList, listSql, shapeInstalls, parsePlanChange, setPlan, getPlan, planAnswer, LIST_SQL } from '../lib/installs.js';
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

// A term that has run out has to end the plan on its own: nobody sits watching the dates, and an
// install left on 'paid' with an expired subscription is a free ride that never stops. The write-back
// matters as much as the answer - without it every future check has to re-derive the same thing.
test('an expired subscription drops the install back to free, and says so once', async () => {
  const writes = [];
  const pool = (subs) => ({
    query: async (sql, params) => {
      if (/FROM installs/.test(sql) && /^SELECT/.test(sql.trim())) return [[{ plan: 'paid' }]];
      if (/FROM subscriptions/.test(sql)) return [subs];
      if (/FROM plans/.test(sql)) return [[{ code: 'pro', rank: 10 }]];
      if (/^UPDATE installs/.test(sql.trim())) { writes.push(params); return [{ affectedRows: 1 }]; }
      throw new Error('unexpected query: ' + sql);
    },
  });
  const past = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  const expired = await planAnswer(pool([{ plan_code: 'pro', period: 'monthly', status: 'active', current_end: past }]), ID);
  assert.equal(expired.plan, 'free');
  assert.equal(expired.expired, true);
  assert.deepEqual(writes, [[ID]], 'the row is corrected, not just the answer');

  writes.length = 0;
  const live = await planAnswer(pool([{ plan_code: 'pro', period: 'annual', status: 'active', current_end: future }]), ID);
  assert.equal(live.plan, 'paid');
  assert.equal(live.period, 'annual');
  assert.deepEqual(writes, [], 'a term still running is never written to');

  // Granted by hand from the admin page: no subscription row at all, and it must keep working.
  writes.length = 0;
  const byHand = await planAnswer(pool([]), ID);
  assert.equal(byHand.plan, 'paid');
  assert.deepEqual(writes, []);
});

// A term nearing its end gets an in-app notice, exactly once: MyNotes has no push notifications, so
// this open is the only chance to say it, and the server marks the term as reminded the instant it
// hands the notice back, keyed to the end date so a renewal re-arms it on its own next term.
test('a term ending soon gets a notice once, and never again for the same end date', async () => {
  const writes = [];
  const end = new Date(Date.now() + 86400000).toISOString(); // 1 day out - inside the real 3-day window
  const row = { id: 7, plan_code: 'pro', period: 'annual', status: 'active', current_end: end, reminded_for: null };
  const pool = (subRow) => ({
    query: async (sql, params) => {
      const flat = sql.replace(/\s+/g, ' ').trim();
      if (/FROM installs/.test(flat) && /^SELECT/.test(flat)) return [[{ plan: 'paid' }]];
      if (/FROM subscriptions/.test(flat) && /^SELECT/.test(flat)) return [[subRow]];
      if (/FROM plans/.test(flat)) return [[{ code: 'pro', rank: 10 }]];
      if (/CREATE TABLE/.test(flat)) return [[]];
      if (/FROM settings/.test(flat)) return [[]];                       // no clock row: real time
      if (/^UPDATE subscriptions SET reminded_for/.test(flat)) { writes.push(params); return [{ affectedRows: 1 }]; }
      throw new Error('unexpected query: ' + sql);
    },
  });

  const first = await planAnswer(pool(row), ID);
  assert.equal(first.plan, 'paid');
  assert.ok(first.notice, 'a term one day from ending is inside the real 3-day reminder window');
  assert.equal(first.notice.state, 'renewing');
  assert.deepEqual(writes, [[end, 7]], 'reminded_for is written, keyed to this end date');

  // Simulate the server having already reminded for this exact end date: no second notice.
  writes.length = 0;
  const already = await planAnswer(pool({ ...row, reminded_for: end }), ID);
  assert.equal(already.notice, undefined, 'already reminded for this term');
  assert.deepEqual(writes, []);
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
  const byName = parseList({ q: '@Meharika' });
  assert.equal(byName.alias, 'Meharika', 'the @ is optional and the case typed is kept');
  assert.equal(byName.q, null, 'a name is not treated as an id prefix');

  const byId = parseList({ q: 'abd4bd' });
  assert.equal(byId.q, 'abd4bd');
  assert.equal(byId.alias, null);

  for (const junk of ['not a name', 'abc', 'Waytoolonganame13', '@@x']) {
    assert.equal(parseList({ q: junk }).alias, null, junk);
  }
});

test('a name is matched exactly, as a bound parameter', () => {
  const { rows, count, params } = listSql(parseList({ q: 'Meharika' }));
  assert.deepEqual(params, ['Meharika']);
  assert.match(rows, /alias = \?/);
  assert.ok(!rows.includes('Meharika'), 'the name is never pasted into the statement');
  assert.ok(count.includes('alias = ?'), 'the count filters the same way');
});

test('every listed install carries its stored anonymous name', () => {
  const rows = [{ install_id: ID, alias: 'Meharika', plan: 'free', features: null },
    { install_id: 'b'.repeat(32), alias: null, plan: 'free', features: null }];
  const s = shapeInstalls(rows, 2, 50, 0);
  assert.equal(s.installs[0].alias, 'Meharika');
  assert.equal(s.installs[1].alias, '', 'an install without one yet reads as empty, not null');
});
