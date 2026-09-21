import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aliasFor, handleFor, ADJECTIVES, ANIMALS } from '../../alias.js';

const ID = '4dcd6fca-1234-4abc-9def-0123456789ab';
const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('the same install always gets the same name, so nothing needs storing or syncing', () => {
  assert.equal(aliasFor(ID), aliasFor(ID));
  assert.match(aliasFor(ID), /^[a-z]+-[a-z]+-\d{4}$/);
  assert.equal(handleFor(ID), '@' + aliasFor(ID));
});

test('different installs get different names', () => {
  const ids = Array.from({ length: 400 }, (_, i) => '0000' + String(i).padStart(4, '0') + '-1234-4abc-9def-0123456789ab');
  const names = ids.map(aliasFor);
  assert.equal(new Set(names).size, names.length, 'no two of 400 installs share a name');
});

test('the name says nothing about the person: it is only the random id in another form', () => {
  const a = aliasFor(ID);
  assert.ok(!a.includes(ID.slice(0, 8)), 'no part of the id survives into the name');
  // Changing one character of the id gives an unrelated name, so names cannot be read as "close to" each other.
  assert.notEqual(aliasFor('5dcd6fca-1234-4abc-9def-0123456789ab'), a);
});

test('anything that is not an id gives an empty string, never "undefined"', () => {
  for (const bad of ['', null, undefined, 0, {}]) {
    assert.equal(aliasFor(bad), '');
    assert.equal(handleFor(bad), '');
  }
});

test('the word lists are clean: unique, lower case, no hyphens to confuse the format', () => {
  for (const [name, list] of [['adjectives', ADJECTIVES], ['animals', ANIMALS]]) {
    assert.equal(new Set(list).size, list.length, name + ' has a duplicate');
    assert.ok(list.length >= 100, name + ' is too short to spread ids over');
    for (const w of list) assert.match(w, /^[a-z]+$/, name + ' has a bad word: ' + w);
  }
});

test('names spread evenly enough that a small group will not collide', () => {
  const seen = new Map();
  for (let i = 0; i < 5000; i++) {
    const n = aliasFor(i + '-1234-4abc-9def-0123456789ab');
    seen.set(n, (seen.get(n) || 0) + 1);
  }
  const dupes = [...seen.values()].filter((c) => c > 1).length;
  assert.ok(dupes <= 1, 'expected at most one collision in 5000, got ' + dupes);
});

test('the server has an identical copy, because it is deployed on its own and cannot import the app file', () => {
  assert.equal(read('server/lib/alias.js'), read('alias.js'), 'alias.js and server/lib/alias.js have drifted apart');
});

test('the app shows the name where somebody would look for it, and never in a record', () => {
  const app = read('app.js');
  assert.match(app, /Your anonymous name/, 'the menu offers it');
  assert.match(app, /aliasCard\(handle\)/, 'Help us improve shows it');
  assert.match(app, /This is your anonymous name/);
  assert.match(read('service-worker.js'), /\.\/alias\.js/);
  // It is worked out on the spot, so it must never be written into the person's data or the usage payload.
  assert.doesNotMatch(read('usage-core.js'), /alias/i, 'the name must not be sent with the usage counts');
});
