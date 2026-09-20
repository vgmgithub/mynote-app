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
  // Features that are fully free have no popup entry and no Pro button.
  const ALL_FREE = ['vault'];
  assert.deepEqual(Object.keys(PRO_INFO).sort(), appIds().filter((id) => !ALL_FREE.includes(id)));
  for (const id of ALL_FREE) assert.equal(Object.values(MODE_FEATURE).includes(id), false, id + ' must not show the button');
  for (const [id, v] of Object.entries(PRO_INFO)) {
    assert.ok(v.name && v.name.length > 2, id + ' has a name');
    assert.ok(Array.isArray(v.items) && v.items.length >= 2, id + ' has items');
    for (const t of v.items) assert.ok(typeof t === 'string' && t.length > 8, id + ' has a bad item');
  }
  assert.ok(PRO_COMMON.length >= 1);
});

test('the popup never quotes a price or promises "free forever" (prices are shown before sale, not before they exist)', () => {
  const all = [...Object.values(PRO_INFO).flatMap((v) => [...v.items, ...(v.now || []), ...(v.free || [])]), ...PRO_COMMON].join('\n');
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

test('the landing comparison matches the limit the app actually enforces', () => {
  const health = readFileSync(new URL('../../health.js', import.meta.url), 'utf8');
  const landing = readFileSync(new URL('../../landing.js', import.meta.url), 'utf8') + readFileSync(new URL('../../plan-compare.js', import.meta.url), 'utf8');
  const limit = /FREE_PEOPLE_LIMIT = (\d+)/.exec(health);
  assert.ok(limit, 'health.js must state the free family-member limit');
  const row = /\['Family members in Health Check', '(\d+)'/.exec(landing);
  assert.ok(row, 'the landing page must list the family-member row');
  assert.equal(row[1], limit[1], 'the landing page quotes a different limit than health.js enforces');
  assert.match(landing, /Pro Plan is not on sale yet/, 'the landing page must not sell Pro before it exists');
});

test('the Pro badge uses the star image, and it is shipped and precached', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8');
  assert.match(html, /id="proBtn"[^>]*>\s*<img src="icons\/emoji\/pro-star\.png"/);
  assert.ok(sw.includes("'./icons/emoji/pro-star.png'"), 'star must be in the service worker precache list');
  const png = readFileSync(new URL('../../icons/emoji/pro-star.png', import.meta.url));
  assert.equal(png.slice(1, 4).toString(), 'PNG');
  assert.ok(png.length > 500 && png.length < 50000, 'a small icon, not a huge file');
});
