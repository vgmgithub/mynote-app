import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePayload, FEATURES } from '../lib/validate.js';
import { saveInstall, forgetInstall } from '../lib/store.js';
import { splitStatements, toInsertSql } from '../lib/sql.js';
import { matchOrigin, allowedOrigins, cleanOrigin, DEFAULT_ORIGINS } from '../lib/cors.js';

const good = () => ({ v: 1, installId: '4dcd6fca-1234-4abc-9def-0123456789ab', features: ['stocks', 'mf'], plan: 'free', appVersion: 598, platform: 'android', timeZone: 'Asia/Calcutta', language: 'en-US' });

test('a valid payload is accepted and normalised (features de-duplicated and sorted)', () => {
  const r = parsePayload({ ...good(), features: ['mf', 'stocks', 'mf'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.features, ['mf', 'stocks']);
  assert.equal(r.value.ageBand, null);
  assert.equal(r.value.gender, null);
});

test('the 32-hex fallback install id is accepted', () => {
  assert.equal(parsePayload({ ...good(), installId: 'a'.repeat(32) }).ok, true);
});

test('any field outside the allow-list is rejected, so money data or a name can never be stored', () => {
  for (const extra of ['amount', 'name', 'email', 'phone', 'notes', 'holdings', 'ip']) {
    const r = parsePayload({ ...good(), [extra]: 'x' });
    assert.equal(r.ok, false, extra + ' must be rejected');
  }
});

test('bad values are rejected: unknown feature, plan, platform, install id, time zone, version', () => {
  assert.equal(parsePayload({ ...good(), features: ['stocks', 'crypto'] }).ok, false);
  assert.equal(parsePayload({ ...good(), plan: 'gold' }).ok, false);
  assert.equal(parsePayload({ ...good(), platform: 'toaster' }).ok, false);
  assert.equal(parsePayload({ ...good(), installId: 'DROP TABLE installs;' }).ok, false);
  assert.equal(parsePayload({ ...good(), timeZone: 'Asia/Calcutta; DROP' }).ok, false);
  assert.equal(parsePayload({ ...good(), appVersion: 1.5 }).ok, false);
  assert.equal(parsePayload({ ...good(), v: 2 }).ok, false);
  assert.equal(parsePayload(null).ok, false);
  assert.equal(parsePayload([]).ok, false);
});

test('age and gender are optional, must come from the lists, and Under 18 is never accepted (app is 18+)', () => {
  const r = parsePayload({ ...good(), ageBand: '25-34', gender: 'Female' });
  assert.deepEqual([r.value.ageBand, r.value.gender], ['25-34', 'Female']);
  assert.equal(parsePayload({ ...good(), ageBand: 'Under 18' }).ok, false);
  assert.equal(parsePayload({ ...good(), gender: 'Robot' }).ok, false);
  const blank = parsePayload({ ...good(), ageBand: '', gender: '' });
  assert.deepEqual([blank.value.ageBand, blank.value.gender], [null, null]);
});

test('server feature list matches the app (15 features)', () => {
  assert.equal(FEATURES.length, 15);
});

// v777: Inflation Calculator became Financial Calculators. An app not yet updated still sends 'inflation'; refusing it
// would throw away that install's whole report, so it is read as 'calc' instead.
test('a retired feature id from an older app is accepted as what it became, never counted twice', () => {
  const r = parsePayload({ ...good(), features: ['stocks', 'inflation'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.features, ['calc', 'stocks']);
  const both = parsePayload({ ...good(), features: ['inflation', 'calc'] });
  assert.deepEqual(both.value.features, ['calc'], 'the old and new id together are one feature');
  assert.equal(parsePayload({ ...good(), features: ['stocks', 'nonsense'] }).ok, false, 'an unknown id is still refused');
});

function fakePool() {
  const log = [];
  const conn = {
    beginTransaction: async () => log.push(['begin']),
    query: async (sql, params) => { log.push(['query', sql.replace(/\s+/g, ' ').trim().slice(0, 40), params]); },
    commit: async () => log.push(['commit']),
    rollback: async () => log.push(['rollback']),
    release: () => log.push(['release']),
  };
  return { log, getConnection: async () => conn, conn };
}

test('saveInstall upserts the install, replaces its features and commits in one transaction', async () => {
  const p = fakePool();
  const v = parsePayload(good()).value;
  await saveInstall(p, v, new Date('2026-09-19T10:00:00Z'));
  assert.deepEqual(p.log.map((x) => x[0]), ['begin', 'query', 'query', 'query', 'query', 'commit', 'release']);
  assert.match(p.log[1][1], /^INSERT INTO installs/);
  assert.match(p.log[2][1], /^DELETE FROM install_features/);
  assert.match(p.log[3][1], /^INSERT INTO install_features/);
  assert.deepEqual(p.log[3][2][0], [[v.installId, 'mf'], [v.installId, 'stocks']]);
  assert.match(p.log[4][1], /^INSERT IGNORE INTO install_days/);
  assert.deepEqual(p.log[4][2], [v.installId, '2026-09-19'], 'one row per install per day, id and date only');
  // withdrawn demographics are written as NULL, which is how withdrawal takes effect
  const params = p.log[1][2];
  assert.equal(params[7], null);
  assert.equal(params[8], null);
});

test('saveInstall rolls back and releases the connection when a query fails', async () => {
  const p = fakePool();
  p.conn.query = async (sql) => { if (/^\s*DELETE/.test(sql)) throw new Error('boom'); };
  await assert.rejects(() => saveInstall(p, parsePayload(good()).value), /boom/);
  const names = p.log.map((x) => x[0]);
  assert.ok(names.includes('rollback') && names.at(-1) === 'release' && !names.includes('commit'));
});

test('saveInstall writes exactly the validated payload values and nothing else (no IP, no headers)', async () => {
  const p = fakePool();
  const v = parsePayload(good()).value;
  const now = new Date('2026-09-19T10:00:00Z');
  await saveInstall(p, v, now);
  const params = p.log[1][2];
  assert.equal(params.length, 9, 'plan is not a parameter: the server decides it');
  assert.deepEqual(params, [v.installId, now, now, v.appVersion, v.platform, v.timeZone, v.language, v.ageBand, v.gender]);
});

function forgetPool(planRows) {
  const p = fakePool();
  p.conn.query = async (sql, params) => {
    p.log.push(['query', sql.replace(/\s+/g, ' ').trim().slice(0, 40), params]);
    return /^\s*SELECT/i.test(sql) ? [planRows] : [[]];
  };
  return p;
}

test('forgetInstall on a free install deletes its features and the install itself, in one transaction', async () => {
  const p = forgetPool([{ plan: 'free' }]);
  await forgetInstall(p, 'a'.repeat(32));
  assert.deepEqual(p.log.map((x) => x[0]), ['begin', 'query', 'query', 'query', 'query', 'commit', 'release']);
  assert.match(p.log[1][1], /^SELECT plan FROM installs/);
  assert.match(p.log[2][1], /^DELETE FROM install_features/);
  assert.match(p.log[3][1], /^DELETE FROM installs/);
});

test('forgetInstall on an install the server never saw just runs the deletes (nothing to keep)', async () => {
  const p = forgetPool([]);
  await forgetInstall(p, 'a'.repeat(32));
  assert.match(p.log[3][1], /^DELETE FROM installs/);
});

test('forgetInstall on a PAID install erases the analytics details but keeps the id and the membership', async () => {
  const p = forgetPool([{ plan: 'paid' }]);
  await forgetInstall(p, 'a'.repeat(32));
  const sqls = p.log.map((x) => x[1]).join(' | ');
  assert.match(sqls, /DELETE FROM install_features/, 'features are erased');
  assert.match(sqls, /UPDATE installs SET time_zone = NULL/, 'details are blanked (the log keeps the first 40 characters)');
  assert.match(p.log[3][1], /^UPDATE installs/, 'the UPDATE replaces the DELETE of the row');
  assert.doesNotMatch(sqls, /DELETE FROM installs/, 'the paid row itself must survive');
  assert.deepEqual(p.log.map((x) => x[0]), ['begin', 'query', 'query', 'query', 'query', 'commit', 'release']);
});

test('splitStatements ignores comments and empty parts', () => {
  assert.deepEqual(splitStatements('-- c\nCREATE TABLE a (x INT);\n\n-- d\nCREATE TABLE b (y INT);\n'), ['CREATE TABLE a (x INT)', 'CREATE TABLE b (y INT)']);
});

test('toInsertSql builds restorable INSERTs, batched, using the supplied escaper', () => {
  const esc = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
  const sql = toInsertSql('t', [{ a: 1, b: "it's" }, { a: 2, b: null }, { a: 3, b: 'x' }], esc, 2);
  assert.equal(sql, "INSERT INTO `t` (`a`, `b`) VALUES\n(1, 'it''s'),\n(2, NULL);\nINSERT INTO `t` (`a`, `b`) VALUES\n(3, 'x');\n");
  assert.equal(toInsertSql('t', [], esc), '');
});

test('origins are matched exactly after cleaning up pasted slips (slash, spaces, quotes, case)', () => {
  const app = 'https://mynote-app-tau.vercel.app';
  for (const env of [app + ',http://localhost', app + '/,http://localhost', ' ' + app + ' , http://localhost ', '"' + app + '",http://localhost', app.toUpperCase() + ',http://localhost']) {
    assert.equal(matchOrigin(app, env), app, 'should allow with env: ' + env);
    assert.equal(matchOrigin('http://localhost', env), 'http://localhost');
  }
});

test('unlisted, look-alike and missing origins are refused', () => {
  const env = 'https://mynote-app-tau.vercel.app,http://localhost';
  assert.equal(matchOrigin('https://evil.example', env), null);
  assert.equal(matchOrigin('https://mynote-app-tau.vercel.app.evil.example', env), null);
  assert.equal(matchOrigin('http://mynote-app-tau.vercel.app', env), null, 'http vs https is a different origin');
  assert.equal(matchOrigin('https://mynote-app-tau.vercel.app:8443', env), null);
  assert.equal(matchOrigin(undefined, env), null);
  assert.deepEqual(allowedOrigins(' , ,'), DEFAULT_ORIGINS, 'an empty variable leaves only the built-in app address');
  assert.equal(cleanOrigin(null), '');
});

test('the app address works even when ALLOWED_ORIGINS is missing, empty or set to the wrong address', () => {
  const app = 'https://mynote-app-tau.vercel.app';
  for (const env of [undefined, '', 'https://mynotes-server.vercel.app,http://localhost']) {
    assert.equal(matchOrigin(app, env), app, 'app must be allowed with env: ' + env);
  }
  assert.equal(matchOrigin('http://localhost', 'https://mynotes-server.vercel.app,http://localhost'), 'http://localhost');
  assert.equal(matchOrigin('http://localhost', ''), null, 'localhost still needs the variable');
  assert.equal(matchOrigin('https://evil.example', ''), null);
});
