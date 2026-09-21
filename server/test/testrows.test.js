import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEED_PLATFORM, SEED_VERSION, KNOWN_TEST_INSTALL_IDS, MAX_DELETE, FIND_SQL, FIND_PARAMS, planCleanup, deleteStatements,
} from '../lib/testrows.js';

const row = (i) => ({ install_id: String(i).padStart(8, '0') + '-1234-4abc-9def-0123456789ab', first_seen: '2026-09-19', last_seen: '2026-09-19' });

test('a candidate must be BOTH the test platform and the old test version, so a real install is never matched', () => {
  assert.equal(SEED_PLATFORM, 'windows');
  assert.equal(SEED_VERSION, 607);
  assert.match(FIND_SQL, /platform = \? AND app_version = \?/);
  assert.deepEqual(FIND_PARAMS, ['windows', 607]);
  assert.ok(!/\bOR\b/i.test(FIND_SQL), 'no OR: the two conditions can never widen each other');
});

test('the plan says what stays, and does nothing when nothing matches', () => {
  const p = planCleanup(Array.from({ length: 18 }, (_, i) => row(i)), 19);
  assert.equal(p.ok, true);
  assert.equal(p.ids.length, 18);
  assert.match(p.note, /18 of 19.*1 stay/);
  assert.deepEqual(planCleanup([], 19), { ok: true, ids: [], note: 'nothing to remove' });
});

test('it refuses when the plan looks wrong, rather than deleting', () => {
  const many = planCleanup(Array.from({ length: MAX_DELETE + 1 }, (_, i) => row(i)), 500);
  assert.equal(many.ok, false, 'far more matches than expected means the signature is wrong');
  const all = planCleanup([row(1), row(2)], 2);
  assert.equal(all.ok, false, 'removing every install is never the aim');
  assert.match(all.note, /not the database you think/);
});

test('every delete is bound, child tables go before installs, and only the named ids are touched', () => {
  const ids = [row(1).install_id, row(2).install_id];
  const s = deleteStatements(ids);
  assert.deepEqual(s.map((x) => x.sql.replace('DELETE FROM ', '').split(' WHERE')[0]), ['install_features', 'install_days', 'news_quota', 'installs']);
  for (const x of s) {
    assert.match(x.sql, /WHERE install_id IN \(\?\)$/, 'ids are a bound parameter, never pasted in');
    assert.ok(!/DROP|TRUNCATE/i.test(x.sql));
    assert.equal(x.params.length, 1);
  }
  assert.ok(s[0].params[0].includes(KNOWN_TEST_INSTALL_IDS[0]), 'the named probe id is cleaned from the child tables too');
  assert.deepEqual(s[3].params[0], ids, 'but the installs table only loses the matched rows');
});

test('an empty list never becomes a delete-everything', () => {
  const s = deleteStatements([]);
  assert.deepEqual(s[3].params[0], [''], 'IN () with nothing matches nothing');
});

test('the script goes through the host guard before it opens a connection, and defaults to a dry run', () => {
  const src = readFileSync(new URL('../scripts/clean-test-installs.js', import.meta.url), 'utf8');
  assert.ok(src.indexOf('checkTarget(') > -1 && src.indexOf('checkTarget(') < src.indexOf('await getPool()'));
  assert.match(src, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.match(src, /if \(!apply\)/, 'the dry-run branch exits before any delete');
  assert.ok(src.indexOf('if (!apply)') < src.indexOf('deleteStatements(plan.ids)'), 'and it comes before the deletes');
});
