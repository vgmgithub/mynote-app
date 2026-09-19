import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRO_INFO, PRO_COMMON, MODE_FEATURE } from '../../pro-info.js';

const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const appIds = () => {
  const block = app.slice(app.indexOf('APP_MODULES = ['));
  return [...block.slice(0, block.indexOf('];')).matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]).sort();
};

test('every app feature has a popup entry with a name and at least two items', () => {
  assert.deepEqual(Object.keys(PRO_INFO).sort(), appIds());
  for (const [id, v] of Object.entries(PRO_INFO)) {
    assert.ok(v.name && v.name.length > 2, id + ' has a name');
    assert.ok(Array.isArray(v.items) && v.items.length >= 2, id + ' has items');
    for (const t of v.items) assert.ok(typeof t === 'string' && t.length > 8, id + ' has a bad item');
  }
  assert.ok(PRO_COMMON.length >= 1);
});

test('the popup never quotes a price or promises "free forever" (prices are shown before sale, not before they exist)', () => {
  const all = [...Object.values(PRO_INFO).flatMap((v) => v.items), ...PRO_COMMON].join('\n');
  assert.doesNotMatch(all, /[₹$]|\bINR\b|\bRs\b|per month|per year|forever/i);
});

test('every screen mode that gets the button maps to a feature that has an entry', () => {
  for (const [mode, id] of Object.entries(MODE_FEATURE)) assert.ok(PRO_INFO[id], mode + ' maps to a missing feature ' + id);
  for (const hub of ['home', 'investment', 'savings']) assert.equal(MODE_FEATURE[hub], undefined, hub + ' must not show the button');
});

test('the popup states it is planned and not available yet', () => {
  assert.match(app, /PLANNED - NOT AVAILABLE YET/);
  assert.match(app, /openProInfo/);
});
