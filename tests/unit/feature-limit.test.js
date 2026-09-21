import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trimAutoAddedCc } from '../../feature-limit.js';

const LIMIT = 5;
const six = ['expense', 'cc', 'health', 'inflation', 'personal', 'vault'];   // the case seen on 21 Sep 2026

test('a Free install pushed to six by the old Credit Cards migration is put back to five', () => {
  const r = trimAutoAddedCc(six, LIMIT, false);
  assert.equal(r.changed, true);
  assert.equal(r.enabled.length, 5);
  assert.ok(!r.enabled.includes('cc'), 'only the auto-added Credit Cards comes off');
  assert.deepEqual(r.enabled, ['expense', 'health', 'inflation', 'personal', 'vault'], 'everything the person chose is kept, in order');
});

test('nothing changes at or under the limit', () => {
  for (const list of [[], ['expense'], ['expense', 'cc', 'health', 'inflation', 'personal']]) {
    const r = trimAutoAddedCc(list, LIMIT, false);
    assert.equal(r.changed, false, list.join());
    assert.deepEqual(r.enabled, list);
  }
});

test('a Pro member is never trimmed: they have every feature', () => {
  const all = ['stocks', 'mf', 'fd', 'metal', 'bond', 'div', 'ef', 'banksav', 'inflation', 'expense', 'cc', 'personal', 'health', 'vault'];
  const r = trimAutoAddedCc(all, LIMIT, true);
  assert.equal(r.changed, false);
  assert.equal(r.enabled.length, 14);
});

test('being over the limit for any OTHER reason is left alone, not guessed at', () => {
  const r = trimAutoAddedCc(['stocks', 'mf', 'fd', 'metal', 'bond', 'div'], LIMIT, false);
  assert.equal(r.changed, false, 'no Credit Cards to blame, so the picker handles it');
  assert.equal(r.enabled.length, 6);
});

test('it never invents a change from bad input, and does not modify what it was given', () => {
  assert.deepEqual(trimAutoAddedCc(null, LIMIT, false), { enabled: [], changed: false });
  assert.deepEqual(trimAutoAddedCc(undefined, LIMIT, false), { enabled: [], changed: false });
  const input = [...six];
  trimAutoAddedCc(input, LIMIT, false);
  assert.deepEqual(input, six);
});

// The bug itself: nothing may switch a feature on that the person did not pick.
test('the migration can no longer add Credit Cards for anybody', () => {
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /_modsCache\.add\('cc'\)/, 'an automatic add of Credit Cards is back');
  assert.match(app, /trimAutoAddedCc\(/, 'and the trim must be wired in');
  assert.match(readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8'), /feature-limit\.js/);
});
