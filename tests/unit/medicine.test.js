import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expiryEnd, daysToExpiry, medStatus, comingUp, sortByExpiry, restockCopy, expiryLabel, statusText, MED_SOON_DAYS, MED_TYPES, MED_PURPOSES } from '../../medicine.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('a pack printed EXP 03/2027 is good through the last day of March 2027', () => {
  assert.equal(expiryEnd('2027-03'), '2027-03-31');
  assert.equal(expiryEnd('2028-02'), '2028-02-29', 'leap year');
  assert.equal(expiryEnd('2027-13'), null);
  assert.equal(expiryEnd(''), null);
  assert.equal(daysToExpiry('2026-10', '2026-10-31'), 0, 'its last day is still in date');
  assert.equal(daysToExpiry('2026-10', '2026-11-01'), -1);
  assert.equal(daysToExpiry('2026-10', '2026-10-01'), 30);
});

test('status: in date, coming up within 30 days, expired, closed, or no expiry', () => {
  const today = '2026-10-01';
  assert.equal(MED_SOON_DAYS, 30);
  assert.deepEqual(medStatus({ expiry: '2027-03' }, today).state, 'ok');
  assert.deepEqual(medStatus({ expiry: '2026-10' }, today), { state: 'soon', days: 30 });
  assert.deepEqual(medStatus({ expiry: '2026-09' }, today), { state: 'expired', days: -1 });
  assert.equal(medStatus({ expiry: '2026-09', status: 'disposed' }, today).state, 'disposed', 'a disposed pack is history, not a reminder');
  assert.equal(medStatus({ expiry: '2026-10', status: 'used' }, today).state, 'used');
  assert.equal(medStatus({}, today).state, 'unknown');
  assert.equal(statusText({ state: 'soon', days: 0 }), 'Expires today');
  assert.equal(statusText({ state: 'soon', days: 12 }), 'Expires in 12 days');
  assert.equal(statusText({ state: 'expired', days: -5 }), 'Expired');
  assert.equal(expiryLabel('2027-03'), 'Mar 2027');
});

test('Coming up: expired first then the soonest, never anything used up, disposed or far off', () => {
  const list = [
    { id: 1, name: 'Far', expiry: '2027-06' },
    { id: 2, name: 'Soon', expiry: '2026-10' },
    { id: 3, name: 'Gone', expiry: '2026-08' },
    { id: 4, name: 'Thrown', expiry: '2026-08', status: 'disposed' },
    { id: 5, name: 'Finished', expiry: '2026-10', status: 'used' },
  ];
  const up = comingUp(list, '2026-10-01');
  assert.deepEqual(up.map((m) => m.name), ['Gone', 'Soon']);
  assert.equal(up[0]._status.state, 'expired');
  assert.deepEqual(sortByExpiry([{ name: 'B', expiry: '' }, { name: 'A', expiry: '2027-01' }, { name: 'C', expiry: '2026-11' }]).map((m) => m.name), ['C', 'A', 'B']);
});

test('buy again copies the medicine, never the old expiry, purchase date or status', () => {
  const copy = restockCopy({ id: 9, name: 'Paracetamol', type: 'Tablet', purpose: 'Fever', usage: '1 after food', when: ['night', 'morning', 'bogus'], cures: ['Fever', 'fever ', 'Body pain'], personId: 2, expiry: '2026-08', boughtOn: '2025-01-01', status: 'disposed', closedOn: '2026-09-01' });
  assert.deepEqual(copy, { name: 'Paracetamol', type: 'Tablet', purpose: 'Fever', usage: '1 after food', when: ['morning', 'night'], cures: ['Fever', 'Body pain'], personId: 2, expiry: '', boughtOn: '', status: 'active', closedOn: null });
  assert.deepEqual(restockCopy({ name: 'Old record' }).when, [], 'a medicine noted before times existed copies none');
  assert.deepEqual(restockCopy({ name: 'Old record' }).cures, [], 'nor cures');
  assert.ok(MED_TYPES.includes('Syrup') && MED_PURPOSES.includes('First aid'));
});

test('the medicines store: added in DB v21, in every backup and restore, counted as real data, and cleared by a wipe', () => {
  const db = read('db.js'), app = read('app.js'), lock = read('lock.js');
  assert.match(db, /const VERSION = 21;/);
  assert.match(db, /if \(!db\.objectStoreNames\.contains\('medicines'\)\) \{\s*db\.createObjectStore\('medicines', \{ keyPath: 'id', autoIncrement: true \}\);/);
  assert.match(db, /this\.all\('medicines'\)\.catch\(\(\) => \[\]\),/, 'exported (a missing store never fails a backup)');
  assert.match(db, /\(data\.medicines \|\| \[\]\)\.forEach/, 'an old backup without medicines still imports');
  assert.match(db, /this\.clear\('medicines'\)/);
  assert.match(app, /const BACKED_UP_STORES = \[[^\]]*'medicines'\]/);
  assert.match(app, /const _RECORD_STORES = \[[^\]]*'medicines'\]/);
  assert.match(lock, /const stores = \[[^\]]*'medicines'\]/);
});

test('Health Check opens on Medicines, its first tab (then Family), reachable by swipe and with nobody added; Home Coming up reminds about it', () => {
  const h = read('health.js'), pf = read('personal-ui.js'), sw = read('service-worker.js'), ui = read('medicine-ui.js');
  assert.match(h, /class: 'hc-tab hc-tab-meds' \+ \(_hcView === 'meds' \? ' active' : ''\)/);
  const render = h.slice(h.indexOf('async function renderHealthCheck'), h.indexOf('function scrollCardBelowStickyHeaders'));
  const medsAt = render.indexOf("'hc-tab hc-tab-meds'"), familyAt = render.indexOf("'hc-tab hc-tab-family'");
  assert.ok(medsAt > 0 && medsAt < familyAt, 'Medicines is the first tab, Family the second');
  assert.match(h, /function resetHealthCheckView\(\) \{ _hcView = 'meds';/, 'every fresh entry lands on Medicines');
  assert.match(h, /const stripIds = \['meds', 'family', \.\.\.people\.map/);
  assert.ok(render.indexOf("if (_hcView === 'meds')") < render.indexOf('if (!people.length)'), 'Medicines works before anyone is added');
  assert.match(h, /await m\.renderMedicineCabinet\(host, \{ people, rerender: renderHealthCheck \}\);/);
  assert.match(pf, /const _kindModule = \{ FD: 'fd', BOND: 'bond', DIV: 'div', SIP: 'mf', MED: 'health' \};/);
  assert.match(pf, /h\.enterMedicinesNext\(\); setAppMode\('health'\);/);
  assert.match(ui, /'Buy again'/); assert.match(ui, /'🗑️ Dispose'/);
  assert.match(sw, /'\.\/medicine\.js',\s*'\.\/medicine-ui\.js',/);
});

test('Health Check footer: a red + fans out Add health check and Add medicine - no backup there - and the page has no corner + of its own', () => {
  const app = read('app.js'), h = read('health.js'), ui = read('medicine-ui.js'), html = read('index.html'), css = read('styles.css');
  assert.match(app, /if \(state\.appMode === 'health'\) \{[\s\S]{0,400}class: 'home-fab is-health'/);
  const fan = app.slice(app.indexOf('function setHealthFan'), app.indexOf('function buildHomeNav'));
  assert.match(fan, /\$\('#healthAddBtn'\)\.classList\.toggle\('hidden', !open\);/);
  assert.match(fan, /\$\('#medAddBtn'\)\.classList\.toggle\('hidden', !open\);/);
  assert.equal(fan.includes('backupFab'), false, 'no backup in the Health Check fan');
  assert.match(app, /\$\('#healthAddBtn'\)\.addEventListener\('click', \(\) => \{ setHealthFan\(false\); import\('\.\/health\.js'\)\.then\(\(m\) => m\.addHealthCheckFromFan\(\)\); \}\);/);
  assert.match(app, /\$\('#medAddBtn'\)\.addEventListener\('click', \(\) => \{ setHealthFan\(false\); import\('\.\/health\.js'\)\.then\(\(m\) => m\.addMedicineFromFan\(\)\); \}\);/);
  assert.match(html, /<button id="medAddBtn" class="fab fab-health fab-med hidden"[^>]*data-cap="Medicine"/);
  assert.match(html, /<button id="healthAddBtn"[^>]*data-cap="Health check"/);
  assert.match(css, /\.home-nav \.home-fab\.is-health \.home-fab-disc \{ background: linear-gradient\(145deg, #f87171 0%, #dc2626 55%, #991b1b 100%\);/, 'red gradient');
  assert.match(css, /\.home-fab\.is-health \.home-fab-disc svg \{[^}]*stroke-width: 3\.6;/, 'a bold +');
  assert.equal(/fab\.onclick|healthAddBtn/.test(h + ui), false, 'the page no longer drives the corner button itself');
  assert.match(h, /h2', \{ text: 'Whose health check\?' \}/, 'asks whose check it is away from a person\'s page');
});

test('the medicine form: no heading above Name, drawn type tiles, purpose chips, When to use, month + year expiry with quick picks and a live line', () => {
  const ui = read('medicine-ui.js');
  assert.match(ui, /function pickGroup\(options, value, cls, allowNone, onChange\)/);
  assert.equal(ui.includes("formSection('💊', 'Medicine'"), false, 'no Medicine heading above the name');
  assert.equal(/USAGE_CHIPS|medf-qchip', text: '\+ '/.test(ui), false, 'the dose chips under How to use are gone');
  assert.match(ui, /iconEl: \(\) => typeIcon\(t, 'medf-opt-ico'\)/, 'each type tile wears its drawing');
  assert.match(ui, /formSection\('🕒', 'How to use', \[usage, whenRow\]\)/, 'When to use sits right under the box');
  assert.match(ui, /const whenBtns = MED_TIMES\.map/);
  assert.match(ui, /when: normaliseWhen\(\[\.\.\.whenSel\]\),/, 'saved with the medicine');
  assert.match(ui, /el\('div', \{ class: 'med-tags' \}, \[[\s\S]{0,400}\.\.\.whenChips\(m\.when\),/, 'and shown on its card in the list, in its one line of tags');
  assert.match(ui, /\[\['\+6 months', 6\], \['\+1 year', 12\], \['\+2 years', 24\], \['\+3 years', 36\]\]/);
  assert.match(ui, /'✓ Good for about ' \+ goodFor\(s\.days\)/);
  assert.match(ui, /el\('select', \{ 'aria-label': 'Expiry month' \}/);
  assert.match(ui, /Filled in from the pack you noted before/);
  assert.match(ui, /if \(!expiry\) \{ toast\('Pick the expiry month and year from the pack'\)/, 'the expiry stays required');
});

test('every medicine type has its own drawing, and "What is it for?" offers Eye, Nose, Mouth and Wound', async () => {
  const { MED_TYPE_SVG, medTypeSvg } = await import('../../medicine-icons.js');
  for (const t of MED_TYPES) assert.match(MED_TYPE_SVG[t] || '', /^<svg viewBox="0 0 32 32"/, 'a drawing for ' + t);
  assert.equal(medTypeSvg('Something typed long ago'), MED_TYPE_SVG.Tablet, 'an unknown type still gets a picture');
  for (const p of ['Eye', 'Nose', 'Mouth', 'Wound']) assert.ok(MED_PURPOSES.includes(p), p);
  const ui = read('medicine-ui.js');
  assert.match(ui, /Eye: '👁️', Nose: '👃', Mouth: '👄', Wound: '🩹'/);
  assert.match(read('service-worker.js'), /'\.\/medicine-icons\.js',/);
});

test('cures: suggestions put what goes with the chosen type first (both type and purpose ahead of all), tags are tidied and capped', async () => {
  const { rankCures, normaliseCures, CURE_TAGS } = await import('../../medicine.js');
  const eyeDrops = rankCures('Drops', 'Eye', []);
  assert.deepEqual(eyeDrops.slice(0, 4), ['Red eyes', 'Eye infection', 'Dry eyes', 'Itchy eyes'], 'drops for the eye first');
  assert.deepEqual(eyeDrops.slice(4, 7), ['Ear pain', 'Blocked nose', 'Nose bleed'], 'then other drops');
  const tube = rankCures('Cream / ointment', '', []);
  assert.ok(tube.indexOf('Rash') < tube.indexOf('Fever') && tube.indexOf('Burn') < tube.indexOf('Cough'), 'an ointment suggests skin first');
  assert.equal(rankCures('Tablet', 'Fever', ['fever']).includes('Fever'), false, 'what is picked is not suggested again');
  assert.equal(rankCures('', '', []).length, CURE_TAGS.length, 'with no type, every suggestion, in list order');
  assert.deepEqual(normaliseCures([' Headache ', 'headache', '', 'Body   pain', 'x'.repeat(40)]), ['Headache', 'Body pain', 'x'.repeat(30)]);
  assert.equal(normaliseCures(Array.from({ length: 12 }, (_, i) => 'Cure ' + i)).length, 8, 'up to 8');
});

test('cures on screen: a tag box in the form with one scrolling line of suggestions, a "Cures i" button on the card, and search finds a cure', () => {
  const ui = read('medicine-ui.js'), css = read('styles.css');
  assert.match(ui, /field\('Cures', el\('div', \{\}, \[cureBox, cureSugg\]\)\)/);
  assert.match(ui, /rankCures\(type \? type\.value : base\.type, purpose \? purpose\.value : base\.purpose, cures\)/, 'ranked by the chosen type and purpose');
  assert.match(ui, /base\.type, 'is-tiles', true, \(\) => drawCureSugg\(\)\)/, 're-ranked when the type changes');
  assert.match(ui, /cures: normaliseCures\(cures\),/, 'saved with the medicine');
  assert.match(css, /\.medf-cure-sugg \{ display: flex; flex-wrap: nowrap; gap: 6px; overflow-x: auto;/, 'suggestions on one line, scrolled');
  assert.match(css, /\.med-tags \{ flex-wrap: nowrap; overflow-x: auto;/, 'the card\'s tags on one line, scrolled');
  assert.match(ui, /cureButton\(m\),/);
  assert.match(ui, /onclick: \(e\) => \{ e\.stopPropagation\(\); openCureSheet\(m\); \}/, 'the cures open from the i, not the card');
  assert.equal(/class: 'med-cure-chip'[\s\S]{0,40}m\.cures/.test(ui.slice(ui.indexOf('const card = '), ui.indexOf('const draw = '))), false, 'no cure tags on the card itself');
  assert.match(ui, /normaliseCures\(m\.cures\)\.join\(' '\)\]/, 'search reads the cures');
  assert.match(ui, /document\.createTextNode\(hit \? 'Cures ' \+ hit : 'Cures'\)/, 'and the button names the cure that matched');
});
