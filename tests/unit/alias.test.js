import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeAlias, endingsFor, isAlias, normaliseAlias, handleFor, MAX_LEN, MIN_LEN } from '../../alias.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
// A fixed sequence stands in for chance, so these tests never flap.
const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };

test('a name is one word of letters, within the length the owner asked for', () => {
  for (const gender of ['Female', 'Male', 'Other', '', undefined]) {
    for (let i = 0; i < 2000; i++) {
      const n = makeAlias(gender);
      assert.match(n, /^[A-Z][a-z]+$/, gender + ' produced ' + n);
      assert.ok(n.length >= MIN_LEN && n.length <= MAX_LEN, n + ' is ' + n.length + ' letters');
    }
  }
  assert.equal(MAX_LEN, 12);
});

test('the ending is what makes a name read as a woman, a man, or neither', () => {
  assert.notDeepEqual(endingsFor('Female'), endingsFor('Male'));
  assert.deepEqual(endingsFor(''), endingsFor('Other'), 'no answer and "Other" both read neither way');
  assert.deepEqual(endingsFor('female'), endingsFor('Female'), 'case does not matter');
  assert.deepEqual(endingsFor('nonsense'), endingsFor(''), 'anything unexpected is treated as no answer');
  // The same draw with a different gender gives a differently-ending name.
  const r = () => 0.5;
  assert.notEqual(makeAlias('Female', r), makeAlias('Male', r));
});

test('names are drawn from a large pool, so the server rarely has to swap one', () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(makeAlias('Female'));
  assert.ok(seen.size > 5000, 'expected a wide spread, got ' + seen.size);
});

test('nothing in a name comes from the person: it is drawn by chance alone', () => {
  // Same chance, same name, whoever is asking. makeAlias takes nothing but a gender.
  assert.equal(makeAlias('Male', seq([0.1, 0.2, 0.9, 0.4, 0.5])), makeAlias('Male', seq([0.1, 0.2, 0.9, 0.4, 0.5])));
  // Its only inputs are a gender and a source of chance; nothing identifying can reach it.
  assert.match(read('alias.js'), /export function makeAlias\(gender, rand = defaultRand\)/);
});

test('a name is recognised with or without the @, and junk is not', () => {
  assert.equal(isAlias('Meharika'), true);
  assert.equal(isAlias('@Meharika'), true);
  assert.equal(normaliseAlias('@Meharika'), 'Meharika');
  assert.equal(normaliseAlias('  Meharika '), 'Meharika');
  for (const bad of ['abc', 'Waytoolonganame', 'Meha rika', 'Meha-1234', '', null, 12, '@@x']) {
    assert.equal(isAlias(bad), false, String(bad));
    assert.equal(normaliseAlias(bad), '');
  }
  assert.equal(handleFor('Meharika'), '@Meharika');
  assert.equal(handleFor('@Meharika'), '@Meharika', 'never doubled');
  assert.equal(handleFor(''), '');
});

test('the server has an identical copy, because it is deployed on its own', () => {
  assert.equal(read('server/lib/alias.js'), read('alias.js'), 'alias.js and server/lib/alias.js have drifted apart');
});

test('the name is made once and kept, and the server settles which one it is', () => {
  const app = read('app.js');
  assert.match(app, /export async function ensureAlias/);
  assert.match(app, /const have = await getAlias\(\);\s*\n\s*if \(have\) return have;/, 'an install that has a name keeps it');
  assert.match(app, /export async function setAlias/, 'the server can hand back a different one');
  // It is shown where somebody would look for it.
  assert.match(app, /This is your anonymous name/);
  assert.match(app, /menu-alias/, 'and beside the Menu heading, not as a row of its own');
  assert.match(app, /Setting up your anonymous name/, 'with a loader while the server settles it');
});

test('it travels with the usage counts, and only as its own field', () => {
  const core = read('usage-core.js');
  assert.match(core, /if \(alias\) p\.alias = alias;/);
  assert.match(read('sender.js'), /alias: await getAlias\(\)/);
  assert.match(read('server/lib/validate.js'), /'alias'/, 'the server allow-list must accept it');
  // It is a label for an id the server already holds: it must never be written into the person's own records.
  assert.doesNotMatch(read('backup.js'), /alias/i, 'the name must not go into a backup file');
});
