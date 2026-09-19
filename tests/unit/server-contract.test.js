import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURES, AGE_BANDS, GENDERS } from '../../server/lib/validate.js';

const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');

test('server accepts exactly the feature ids the app defines', () => {
  const block = app.slice(app.indexOf('APP_MODULES = ['));
  const ids = [...block.slice(0, block.indexOf('];')).matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]).sort();
  assert.ok(ids.length >= 13, 'found the app feature list');
  assert.deepEqual([...FEATURES].sort(), ids);
});

test('server age bands and genders match the app lists (minus the blank "Prefer not to say")', () => {
  const list = (name) => {
    const start = app.indexOf('export const ' + name + ' = [');
    assert.ok(start >= 0, name + ' found in app.js');
    const body = app.slice(start, app.indexOf('];', start));
    return [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]).filter(Boolean);
  };
  assert.deepEqual(AGE_BANDS, list('AGE_BANDS'));
  assert.deepEqual(GENDERS, list('GENDERS'));
});
