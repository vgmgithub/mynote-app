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
  const ALL_FREE = ['vault', 'calc', 'analysis'];
  assert.deepEqual(Object.keys(PRO_INFO).sort(), appIds().filter((id) => !ALL_FREE.includes(id)));
  for (const id of ALL_FREE) assert.equal(Object.values(MODE_FEATURE).includes(id), false, id + ' must not show the button');
  for (const [id, v] of Object.entries(PRO_INFO)) {
    assert.ok(v.name && v.name.length > 2, id + ' has a name');
    // The member view leads on this, so a screen without one would open on nothing.
    assert.ok(v.purpose && v.purpose.length > 30, id + ' says what the screen is for');
    assert.doesNotMatch(v.purpose, /\bPro\b|\bplan\b/i, id + ' purpose describes the feature, not the plan');
    assert.ok(Array.isArray(v.items) && v.items.length >= 2, id + ' has items');
    // The cards ride a rail, so a card has to fit one. Long prose belongs in `worksWith`, which sits
    // under the rail as small print rather than inside a slide.
    for (const n of v.now || []) {
      const c = typeof n === 'string' ? { title: n } : n;
      assert.ok(c.title.length <= 28, id + ' card title too long: ' + c.title);
      if (c.text) assert.ok(c.text.length <= 80, id + ' card text too long: ' + c.text);
    }
    for (const t of v.items) assert.ok(typeof t === 'string' && t.length > 8, id + ' has a bad item');
  }
  assert.ok(PRO_COMMON.length >= 1);
});

test('the popup never quotes a price or promises "free forever" (prices are shown before sale, not before they exist)', () => {
  const all = [...Object.values(PRO_INFO).flatMap((v) => [...v.items, ...(v.now || []).map((n) => (typeof n === 'string' ? n : [n.title, n.text, n.tag].filter(Boolean).join(' '))), ...(v.free || []), v.purpose, ...(v.worksWith ? [v.worksWith] : [])]), ...PRO_COMMON].join('\n');
  assert.doesNotMatch(all, /[₹$]|\bINR\b|\bRs\b|per month|per year|forever/i);
});

test('every screen mode that gets the button maps to a feature that has an entry', () => {
  for (const [mode, id] of Object.entries(MODE_FEATURE)) assert.ok(PRO_INFO[id], mode + ' maps to a missing feature ' + id);
  for (const hub of ['home', 'investment', 'savings']) assert.equal(MODE_FEATURE[hub], undefined, hub + ' must not show the button');
});

test('the popup says Pro cannot be bought, and marks what is only planned', () => {
  assert.match(app, /NOT ON SALE YET/, 'a non-member must be told Pro cannot be bought');
  assert.match(app, /Planned next/, 'ideas that are not built must be labelled');
  assert.match(app, /openProInfo/);
});

test('a member gets the purpose of the screen, not a pitch', () => {
  const sheet = app.slice(app.indexOf('export function openProInfo'), app.indexOf('export function openLegal'));
  const memberView = sheet.slice(sheet.indexOf('if (member) {'), sheet.indexOf("openModal(el('div', { class: 'sheet pro-sheet' }"));
  assert.match(memberView, /info\.purpose/, 'it leads on what the screen is for');
  assert.match(memberView, /What you have here/);
  assert.match(memberView, /cards\(true\)/, 'the benefits read as owned');
  // Two or more benefits swipe; one stays a plain card, because a single slide is not a slide show.
  assert.match(sheet, /const many = info\.now\.length > 1;/);
  assert.match(sheet, /if \(!many\) return \[rail/);
  assert.match(sheet, /scroll-snap|is-rail/);
  // Nothing on sale, and no comparison with a plan they are not on.
  assert.equal(/PRO_PRICE|plan-compare-buy|startProCheckout/.test(memberView), false, 'a member is sold nothing');
  assert.equal(/info\.free|On the Free Plan/.test(memberView), false, 'the Free comparison is gone');
});

test('the feature popup can sell, but only where a payment can actually be taken', () => {
  const sheet = app.slice(app.indexOf('export function openProInfo'), app.indexOf('export function openLegal'));
  // Same guard as the plan comparison: never on production, never to somebody who already paid.
  assert.match(sheet, /const canBuy = !IS_PRODUCTION && !member;/);
  // The actual sale happens through the shared Monthly/Annual row (tested on its own in pay.test.js),
  // not a one-off button re-implemented here.
  assert.match(sheet, /_buyPeriodButtons\(closeModal\)/);
  assert.match(sheet, /Test mode: no real money is taken/);
  // The badge must not contradict the row sitting under it.
  assert.match(sheet, /canBuy \? MONTHLY_PRICE[\s\S]{0,60}: 'NOT ON SALE YET'/);
  // A member is sold nothing, on any environment.
  assert.equal(/canBuy = [^;]*\bmember\b/.test(sheet), true, 'membership is part of the guard');
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
