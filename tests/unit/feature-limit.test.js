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

// v772: five features picked on the website become the app's choice after the welcome, without asking again.
test('the website picks are cleaned like the picker would, and only a full choice skips it', async () => {
  const { websitePicks } = await import('../../feature-limit.js');
  const M = [{ id: 'stocks' }, { id: 'mf' }, { id: 'div', requires: 'stocks' }, { id: 'expense' }, { id: 'health' }, { id: 'vault' }, { id: 'cc' }];
  assert.deepEqual(websitePicks(['vault', 'mf', 'stocks', 'div', 'health'], M, 5), ['stocks', 'mf', 'div', 'health', 'vault'], "in the app's own order");
  assert.deepEqual(websitePicks(['div', 'mf', 'health'], M, 5), ['mf', 'health'], 'Dividends dropped without Stocks');
  assert.deepEqual(websitePicks(['mf', 'gone', 'health'], M, 5), ['mf', 'health'], 'a feature that no longer exists is ignored');
  assert.equal(websitePicks(['stocks', 'mf', 'div', 'expense', 'health', 'vault', 'cc'], M, 5).length, 5, 'never more than Free allows');
  assert.deepEqual(websitePicks(null, M, 5), []);
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  const go = app.slice(app.indexOf('const goChoose = async () => {'), app.indexOf('// Every card is an icon tile'));
  assert.ok(go.indexOf('recordLegalAcceptance()') < go.indexOf("key: 'enabledModules'"), 'applied only after the terms are accepted');
  assert.match(go, /web\.length === FREE_FEATURE_LIMIT/, 'only a full choice skips the picker');
  assert.match(go, /!cur &&/, 'never overwrites a choice the app already has');
});

test('the install offer is caught before any module runs, so the website button can install directly', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /addEventListener\('beforeinstallprompt', function \(e\) \{ e\.preventDefault\(\); window\.__installOffer = e; \}\)/);
  assert.ok(head.indexOf('__installOffer') < html.indexOf('src="app.js"'), 'before app.js loads');
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  assert.match(app, /window\.__installOffer/, 'app.js reads the early catch');
  const landing = readFileSync(new URL('../../landing.js', import.meta.url), 'utf8');
  assert.match(landing, /ready \? 'Install' : 'How to install'/, 'the bottom bar says Install when one tap can install');
});

// Review fixes (v772): the carry-over promise only where it holds, the notice on the page, picks kept off backups.
test('the website promises carry-over only where the installed app shares this browser, and says so on the page', () => {
  const landing = readFileSync(new URL('../../landing.js', import.meta.url), 'utf8');
  assert.match(landing, /const carriesPicks = \(\) => canInstall\(\) && !installedHere;/);
  assert.equal(/PLATFORM === 'ios' \?/.test(landing), false, 'no longer guessed from the user agent (an iPad reads as a Mac)');
  assert.match(landing, /DB\.get\('meta', 'landingPicks'\)\.then/, 'picks from an earlier visit are shown again');
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  assert.match(app, /onboard-web-set/, 'said on the next page, not in a toast hidden behind the setup');
  const go = app.slice(app.indexOf('const goChoose = async () => {'), app.indexOf('// Every card is an icon tile'));
  assert.equal(/toast\(/.test(go), false);
  const db = readFileSync(new URL('../../db.js', import.meta.url), 'utf8');
  assert.match(db, /const DEVICE_ONLY_META = \[[^\]]*'landingPicks'[^\]]*\]/, 'never carried by a backup to another install');
});

// A restore must not send an existing person back through Get started, or delete their name on the way.
test('a restore keeps the terms acceptance and the name, and never re-runs the welcome over real data', () => {
  const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const db = read('db.js'), app = read('app.js');
  assert.equal(/const DEVICE_ONLY_META = \[[^\]]*'legalAccepted'/.test(db), false, 'legalAccepted travels with the backup');
  assert.match(db, /if \(ownLegal && ownLegal\.value && !backupLegal\) keptDevice\.push\(ownLegal\);/, 'an old backup without it keeps this device\'s own');
  const counted = app.slice(app.indexOf('const BACKED_UP_STORES'), app.indexOf('async function dataCount'));
  assert.match(counted, /'healthPeople', 'healthChecks'/, 'Health-only data counts as real data');
  const onboard = app.slice(app.indexOf('async function maybeShowOnboarding'), app.indexOf('export function _homeCard'));
  assert.ok(onboard.indexOf('dataCount()) > 0') < onboard.indexOf('openFeaturePicker({ first: true })'), 'data is checked before the welcome');
  assert.match(onboard, /value: \{ healed: true, at: /, 'a healed flag, not a claimed 18+ acceptance');
  assert.match(app, /getUserName\(\)\.then\(\(n\) => \{ if \(n && !nameIn\.value\) nameIn\.value = n; \}\)/, 'the name box starts with the saved name');
});
