import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dbHost, checkTarget } from '../lib/dbtarget.js';

const URL_A = 'mysql://user:secret@gateway01.example.tidbcloud.com:4000/mynotes';

test('the host is read from the database URL, lower-cased, and never includes the password', () => {
  assert.equal(dbHost(URL_A), 'gateway01.example.tidbcloud.com');
  assert.equal(dbHost('MYSQL://u:p@HOST.Example.COM/db'), 'host.example.com');
  assert.equal(dbHost(''), '');
  assert.equal(dbHost('not a url'), '');
});

test('a write is refused until the person names the host they mean', () => {
  const none = checkTarget(URL_A, '');
  assert.equal(none.ok, false);
  assert.match(none.why, /CONFIRM_DB_HOST=gateway01\.example\.tidbcloud\.com/, 'it tells them which host it was about to touch');
  assert.doesNotMatch(none.why, /secret/, 'and never echoes the password');

  assert.equal(checkTarget(URL_A, 'some-other-host.com').ok, false, 'naming a DIFFERENT host is refused');
  assert.equal(checkTarget(URL_A, 'gateway01.example.tidbcloud.com').ok, true);
  assert.equal(checkTarget(URL_A, '  GATEWAY01.example.tidbcloud.com ').ok, true, 'case and spacing do not matter');
});

test('a missing or broken URL is refused rather than guessed at', () => {
  assert.equal(checkTarget(undefined, 'x').ok, false);
  assert.equal(checkTarget('garbage', 'garbage').ok, false);
});

test('the migration script goes through the guard before it opens a connection', () => {
  const src = readFileSync(new URL('../scripts/migrate.js', import.meta.url), 'utf8');
  const guard = src.indexOf('checkTarget(');
  const pool = src.indexOf('await getPool()');
  assert.ok(guard > -1 && pool > -1, 'both must be present');
  assert.ok(guard < pool, 'the guard must run before any connection is made');
  assert.match(src, /process\.exit\(1\)/);
});
