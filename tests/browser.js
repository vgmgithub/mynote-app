// Integration tests: drive the REAL app in a frame, against a separate test database.
// Open /tests/ in a browser (or read window.__results). Never touches real data.
import { DB } from '../db.js';
import * as backup from '../backup.js';

// Safety: only ever run against the test database.
if (!/[?&]testdb=1/.test(location.search)) { location.replace(location.pathname + '?testdb=1'); throw new Error('redirecting to the test database'); }

const frame = document.getElementById('app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STORES = ['stocks', 'snapshots', 'monthly', 'meta', 'feed', 'funds', 'fds', 'dividends', 'metals', 'bonds', 'emergency', 'bankSavings',
  'creditCards', 'allocations', 'ccReimbursements', 'monthlySheet', 'spends', 'personalSpends', 'vault', 'healthPeople', 'healthChecks', 'healthParams'];
const w = () => frame.contentWindow;
const d = () => frame.contentDocument;
const $ = (s) => d().querySelector(s);
const $$ = (s) => [...d().querySelectorAll(s)];
const byText = (sel, t) => $$(sel).find((e) => e.textContent.includes(t));
const visible = (e) => !!e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none';
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), (msg || 'not equal') + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b));

const ALL = ['stocks', 'mf', 'fd', 'metal', 'bond', 'div', 'ef', 'banksav', 'inflation', 'expense', 'personal', 'health', 'vault'];
// The usage test switch is switched OFF here and after every test (see the runner), so the app under test
// can never send to the real server by accident.
async function wipe() { localStorage.removeItem('mynoteUsageTest'); for (const s of STORES) await DB.clear(s).catch(() => {}); }
function load() {
  return new Promise((res) => { frame.onload = async () => { await sleep(2200); res(); }; frame.src = '../?testdb=1&t=' + Date.now(); });
}
async function boot(mods, seed) {
  await wipe();
  if (mods) { await DB.put('meta', { key: 'enabledModules', value: mods }); await DB.put('meta', { key: 'onboarded', value: true }); }
  if (seed) await seed();
  await load();
}
async function go(mode) {
  w().history.pushState({ appMode: mode, depth: 1 }, '');
  w().dispatchEvent(new (w().PopStateEvent)('popstate', { state: { appMode: mode, depth: 1 } }));
  await sleep(1100);
}
const stock = (name, category, extra) => Object.assign({ portfolio: 'me-in', name, category: category || '', status: 'holding', units: 10, buyPrice: 100, currentPrice: 120, history: [] }, extra || {});
const dialog = () => $('.app-dialog-msg')?.textContent || '';
const dialogBtn = (t) => $$('.app-dialog .btn').find((b) => b.textContent.includes(t));
const closeSheet = () => $('#modalHost')?.classList.add('hidden');
async function openBackupSheet() {
  $('#menuBtn').click(); await sleep(500);
  byText('.menu-list button', 'Backup & Restore').click(); await sleep(1100);
}
async function opfs(name) {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(name, { recursive: true }); } catch (_) {}
  const parent = await root.getDirectoryHandle(name, { create: true });
  window.showDirectoryPicker = async () => parent;
  const target = await backup.pickFolder();
  return { root, target };
}
const filesIn = async (dir) => { const a = []; for await (const [n] of dir.entries()) a.push(n); return a; };
const readBackup = async (dir, n) => JSON.parse(await (await (await dir.getFileHandle(n)).getFile()).text());

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------- data / backup format
test('backup: format marker, version and every store present', async () => {
  await wipe();
  const e = await DB.exportAll();
  eq(e.app, 'mynote-stocks'); eq(e.version, 19);
  STORES.filter((s) => s !== 'meta').forEach((s) => ok(Array.isArray(e[s]), 'missing store ' + s));
});
test('backup: an old-format backup restores every store and keeps this device folder', async () => {
  await wipe();
  await DB.put('meta', { key: 'backupFolderHandle', value: { name: 'kept-folder' } });
  const data = { app: 'mynote-stocks', version: 19, meta: [{ key: 'lastBackup', value: 5 }, { key: 'backupFolderHandle', value: {} }] };
  STORES.forEach((s) => { data[s] = data[s] || []; });
  data.stocks = [stock('OLD', 'x')]; data.funds = [{ owner: 'me', name: 'F' }]; data.fds = [{ owner: 'me', bank: 'B' }];
  data.bonds = [{ owner: 'me', name: 'Bo' }]; data.metals = [{ metal: 'gold', grams: 1 }]; data.emergency = [{ kind: 'target', name: 'T' }];
  data.spends = [{ ym: '2026-09', amount: 1 }]; data.healthPeople = [{ name: 'P' }]; data.vault = [{ updatedAt: 1, iv: 'x', ct: 'y' }];
  await DB.importAll(data);
  for (const s of ['stocks', 'funds', 'fds', 'bonds', 'metals', 'emergency', 'spends', 'healthPeople', 'vault']) eq((await DB.all(s)).length, 1, s + ' count');
  eq((await DB.get('meta', 'backupFolderHandle')).value.name, 'kept-folder', 'device folder kept');
  ok(!(await DB.exportAll()).meta.some((m) => m.key === 'backupFolderHandle'), 'handle must not be exported');
});
test('backup: device-only keys (install id, last backup) are never exported and never overwritten by a restore', async () => {
  await wipe();
  await DB.put('meta', { key: 'installId', value: 'this-device' });
  await DB.put('meta', { key: 'lastBackup', value: 111 });
  await DB.put('meta', { key: 'usageProfile', value: { ageBand: '25-34', gender: '' } });
  const e = await DB.exportAll();
  ok(!e.meta.some((m) => m.key === 'installId'), 'installId must not be exported');
  ok(e.meta.some((m) => m.key === 'usageProfile'), 'usageProfile travels with the person');
  ok(!e.meta.some((m) => m.key === 'lastBackup'), 'lastBackup must not be exported');
  const data = { app: 'mynote-stocks', version: 19, meta: [{ key: 'installId', value: 'other-phone' }, { key: 'lastBackup', value: 999 }] };
  STORES.forEach((s) => { data[s] = data[s] || []; });
  data.stocks = [stock('X', 'x')];
  await DB.importAll(data);
  eq((await DB.get('meta', 'installId')).value, 'this-device', 'restore keeps this install id');
  eq((await DB.get('meta', 'lastBackup')).value, 111, 'restoring must not overwrite (or tick) this device\'s last backup');
});
test('backup safety: empty app refuses to save; a smaller backup cannot silently replace a fuller one; empty backups cannot be restored', async () => {
  await boot(['stocks']);
  const { root, target } = await opfs('t-backup');
  await load();
  await openBackupSheet();
  byText('.modal-host .btn', 'Backup now').click(); await sleep(700);
  ok(/nothing to back up/i.test(dialog()), 'empty backup should be refused');
  dialogBtn('OK').click(); await sleep(200);
  eq(await filesIn(target), [], 'no file written for an empty app');
  closeSheet();
  for (let i = 1; i <= 3; i++) await DB.put('stocks', stock('S' + i));
  await load(); await openBackupSheet();
  byText('.modal-host .btn', 'Backup now').click(); await sleep(1000);
  const f = await filesIn(target); eq(f.length, 1, 'one backup file');
  eq((await readBackup(target, f[0])).stocks.length, 3, 'records in backup');
  await DB.clear('stocks'); await DB.put('stocks', stock('ONLY'));
  await load(); await openBackupSheet();
  byText('.modal-host .btn', 'Backup now').click(); await sleep(700);
  ok(/already holds 3 records/.test(dialog()), 'shrink prompt: ' + dialog());
  dialogBtn('Cancel').click(); await sleep(400);
  eq((await readBackup(target, f[0])).stocks.length, 3, 'fuller backup untouched');
  const eh = await target.getFileHandle('mynote-stocks-backup-2020-01-01.json', { create: true });
  const wr = await eh.createWritable(); await wr.write(JSON.stringify({ app: 'mynote-stocks', version: 19, stocks: [], meta: [] })); await wr.close();
  await load(); await openBackupSheet();
  $$('.modal-host .backup-row').find((r) => r.textContent.includes('2020')).querySelector('.btn').click(); await sleep(700);
  ok(/no records in it/i.test(dialog()), 'empty restore refused: ' + dialog());
  dialogBtn('OK').click(); await sleep(200);
  eq((await DB.all('stocks')).map((s) => s.name), ['ONLY'], 'data untouched');
  await root.removeEntry('t-backup', { recursive: true });
});

// ---------------------------------------------------------------- features / gating
test('onboarding: fresh install shows welcome, free plan is 5, Dividends needs Stocks', async () => {
  await wipe(); await load();
  ok($('.onboard'), 'welcome overlay');
  byText('.onboard .btn', 'Get started').click(); await sleep(300);
  const tile = (n) => $$('.onboard-opt').find((o) => o.querySelector('.onboard-opt-name').textContent === n);
  eq($('.onboard-count').textContent, '0 of 5 selected');
  ok(tile('Dividends').disabled, 'Dividends locked without Stocks');
  ['Stocks', 'Mutual Funds', 'Fixed Deposits', 'Gold & Silver', 'Bonds'].forEach((n) => tile(n).click());
  eq($('.onboard-count').textContent, '5 of 5 selected');
  tile('Health Records').click(); await sleep(300);
  ok(/free features/i.test(dialog()), 'sixth pick shows the upsell');
  dialogBtn('Cancel').click(); await sleep(200);
  ok(!tile('Health Records').classList.contains('on'), 'sixth not added');
});
test('usage sharing is opt-in: it is asked after choosing features, Skip sends nothing, Share is stored', async () => {
  const toAbout = async () => {
    await wipe(); await load();
    ok(!$('.onboard-demo'), 'welcome screen no longer asks');
    ok(/18 or older/.test($('.legal-consent').textContent), 'welcome consent line includes the 18+ confirmation');
    byText('.onboard .btn', 'Get started').click(); await sleep(300);
    const tile = $$('.onboard-opt').find((o) => o.querySelector('.onboard-opt-name').textContent === 'Stocks');
    tile.click(); await sleep(100);
    $('.onboard-bar .btn.primary').click(); await sleep(400);
    ok(/Help us improve/i.test($('.onboard').textContent), 'usage page comes after the feature choice');
  };
  await toAbout();
  const acc = (await DB.get('meta', 'legalAccepted')).value;
  ok(acc.adult === true && /^\d{4}-\d\d-\d\dT/.test(acc.at) && acc.version, 'Get started records 18+ confirmation, version and time: ' + JSON.stringify(acc));
  byText('.onboard .btn', 'Skip').click(); await sleep(300);
  eq(await DB.get('meta', 'usageProfile'), undefined, 'skip stores nothing');
  await toAbout();
  const sel = $$('.onboard select');
  sel[0].value = '25-34'; sel[1].value = 'Female';
  byText('.onboard .btn', 'Share').click(); await sleep(300);
  const v = (await DB.get('meta', 'usageProfile')).value;
  eq([v.share, v.ageBand, v.gender], [true, '25-34', 'Female'], 'share stores the choice');
  await toAbout();
  byText('.onboard .btn', 'Share').click(); await sleep(300);
  eq(await DB.get('meta', 'usageProfile'), undefined, 'sharing with both left on Prefer not to say stores nothing');
});
test('anonymous usage counts: on by default, can be turned off from the Privacy Policy sheet, and the switch is stored', async () => {
  await boot(['stocks']);
  const app = await w().eval('import("' + new URL('../app.js', location.href).href + '")');
  eq(await app.getUsageCountsOn(), true, 'on by default');
  app.openLegal('privacy'); await sleep(400);
  const off = byText('.legal-sheet .btn', 'Turn off anonymous usage counts');
  ok(off, 'turn-off button is in the Privacy Policy sheet');
  off.click(); await sleep(200);
  eq((await DB.get('meta', 'usageCountsOff')).value, true, 'switch stored');
  eq(await app.getUsageCountsOn(), false, 'reads back as off');
  await app.setUsageCountsOn(true);
  eq(await DB.get('meta', 'usageCountsOff'), undefined, 'turning on removes the switch');
});
test('Pro info button: hidden on Home, shown on a feature screen, opens a popup that says it is planned', async () => {
  await boot(['stocks', 'mf', 'fd', 'expense', 'health']);
  eq($('#proBtn').classList.contains('hidden'), true, 'no button on Home');
  for (const [mode, name] of [['stocks', 'Stocks'], ['mf', 'Mutual Funds'], ['fd', 'Fixed Deposits'], ['expense', 'Household Expenses'], ['health', 'Health Records']]) {
    await go(mode);
    eq($('#proBtn').classList.contains('hidden'), false, 'button on ' + mode);
    $('#proBtn').click(); await sleep(250);
    const sheet = $('.pro-sheet');
    ok(sheet, 'popup opens on ' + mode);
    ok(sheet.textContent.includes(name), mode + ' popup names the feature: ' + sheet.querySelector('h2').textContent);
    ok(/PLANNED - NOT AVAILABLE YET/.test(sheet.textContent), mode + ' popup says planned');
    ok(!/[\u20B9$]/.test(sheet.textContent), mode + ' popup shows no price');
    byText('.pro-sheet .btn', 'Close').click(); await sleep(200);
    ok(!$('.pro-sheet'), 'popup closes');
  }
});
test('usage sender: silent by default; when switched on it posts exactly the documented message, respects the off switch and deletes on turn-off', async () => {
  await boot(['stocks', 'mf']);
  const app = await w().eval('import("' + new URL('../app.js', location.href).href + '")');
  const snd = await w().eval('import("' + new URL('../sender.js', location.href).href + '")');
  const calls = [];
  let status = 204;
  w().fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { status }; };

  eq(await snd.sendUsage(), 'inactive', 'nothing is sent while the switch is off');
  eq(calls.length, 0, 'no network call while inactive');

  w().localStorage.setItem('mynoteUsageTest', '1');
  eq(await snd.sendUsage(), 'sent', 'first send');
  eq(calls.length, 1); ok(/\/api\/collect$/.test(calls[0].url), 'goes to /api/collect');
  const m = calls[0].body;
  eq(Object.keys(m).sort().join(), 'appVersion,features,installId,language,plan,platform,timeZone,v', 'exact fields, no demographics');
  eq(m.features.join(), 'mf,stocks'); eq(m.plan, 'free'); eq(m.v, 1);
  eq(m.installId, (await DB.get('meta', 'installId')).value, 'uses this install id');
  ok(!JSON.stringify(m).match(/amount|units|name|note/i), 'no money or name fields');

  eq(await snd.sendUsage(), 'skip', 'unchanged state is not re-sent'); eq(calls.length, 1);

  await app.saveUsageProfile({ share: true, ageBand: '25-34', gender: 'Female' });
  eq(await snd.sendUsage(), 'sent', 'a change (shared demographics) is sent');
  eq([calls[1].body.ageBand, calls[1].body.gender].join(), '25-34,Female');
  await app.saveUsageProfile({ share: false });
  eq(await snd.sendUsage(), 'sent', 'withdrawing demographics is sent');
  ok(!('ageBand' in calls[2].body) && !('gender' in calls[2].body), 'demographics gone from the message');

  await app.setUsageCountsOn(false);
  eq(await snd.sendUsage(), 'off', 'off switch stops sending'); eq(calls.length, 3);
  await snd.requestForget(); await sleep(100);
  const del = calls[calls.length - 1];
  ok(/\/api\/forget$/.test(del.url) && del.body.installId === m.installId && Object.keys(del.body).join() === 'installId', 'turning off asks the server to delete this install');
  eq(await DB.get('meta', 'usageForgetPending'), undefined, 'pending flag cleared after a successful delete');
  await app.setUsageCountsOn(true);

  await DB.del('meta', 'usageLastSent');
  status = 503;
  eq(await snd.sendUsage(), 'failed', 'a server error is reported as failed, silently');
  const n = calls.length;
  eq(await snd.sendUsage(), 'skip', 'no immediate retry after a failure'); eq(calls.length, n);
  w().localStorage.removeItem('mynoteUsageTest');
});
test('usage test link: ?usagetest=1 turns test sending on for this device, ?usagetest=0 turns it off', async () => {
  await boot(['stocks']);
  const snd = await w().eval('import("' + new URL('../sender.js', location.href).href + '")');
  w().localStorage.removeItem('mynoteUsageTest');
  const set = async (q) => { w().history.replaceState({}, '', w().location.pathname + '?testdb=1' + q); return snd.applyUsageTestParam(); };
  eq(await set(''), null, 'no parameter: no change'); eq(snd.usageTestMode(), false);
  eq(await set('&usagetest=1'), 'on'); eq(snd.usageTestMode(), true); eq(snd.usageActive(), true);
  eq(await set('&usagetest=0'), 'off'); eq(snd.usageTestMode(), false); eq(snd.usageActive(), false);
  eq(await set('&usagetest=2'), null, 'anything else is ignored');
  w().history.replaceState({}, '', w().location.pathname + '?testdb=1');
});
test('Pro membership: read from the server on open, shown as a pill and a starred badge, kept offline, never from a backup', async () => {
  await boot(['stocks', 'mf']);
  const app = await w().eval('import("' + new URL('../app.js', location.href).href + '")');
  const snd = await w().eval('import("' + new URL('../sender.js', location.href).href + '")');
  const calls = [];
  let answer = { status: 200, body: { plan: 'paid', known: true } };
  w().fetch = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    return { status: answer.status, json: async () => answer.body };
  };
  const pill = () => $('#homeView .pro-pill');

  w().localStorage.removeItem('mynoteUsageTest');
  eq(await snd.checkPlan(), 'free', 'no network call and no Pro while sending is switched off');
  eq(calls.length, 0, 'nothing was asked of the server');

  w().localStorage.setItem('mynoteUsageTest', '1');
  eq(await snd.checkPlan(), 'paid', 'the server says paid');
  const asked = calls.find((c) => /\/api\/plan$/.test(c.url));
  ok(asked, 'it asked /api/plan');
  eq(Object.keys(asked.body).join(), 'installId', 'only the install id is sent');
  eq((await DB.get('meta', 'plan')).value.plan, 'paid', 'remembered on this device');
  eq(await snd.getCachedPlan(), 'paid');

  w().document.body.dataset.plan = 'paid';
  await go('home');
  ok(pill() && /PRO/.test(pill().textContent), 'Home shows a PRO pill next to the title');
  await go('stocks');
  ok(!$('#proBtn').classList.contains('hidden'), 'the star badge is on feature screens');
  $('#proBtn').click(); await sleep(250);
  ok(/YOU ARE A PRO MEMBER/.test($('.pro-sheet').textContent), 'the popup thanks a member');
  ok(!/PLANNED - NOT AVAILABLE YET/.test($('.pro-sheet').textContent), 'and does not show the free wording');
  byText('.pro-sheet .btn', 'Close').click(); await sleep(200);

  answer = { status: 503, body: null };
  eq(await snd.checkPlan(), 'paid', 'a server error never removes Pro');
  answer = { status: 200, body: { plan: 'gibberish' } };
  eq(await snd.checkPlan(), 'paid', 'a reply that is not a plan never removes Pro');
  Object.defineProperty(w().navigator, 'onLine', { value: false, configurable: true });
  const before = calls.length;
  eq(await snd.checkPlan(), 'paid', 'offline keeps the remembered plan'); eq(calls.length, before, 'and makes no network call');
  delete w().navigator.onLine;

  answer = { status: 200, body: { plan: 'free', known: true } };
  eq(await snd.checkPlan(), 'free', 'the admin can take Pro away'); eq(await snd.getCachedPlan(), 'free');
  w().document.body.dataset.plan = 'free'; await go('home');
  ok(!pill(), 'no pill for a free user');

  await DB.put('meta', { key: 'plan', value: { plan: 'paid', at: 1 } });
  const exported = await DB.exportAll();
  ok(!exported.meta.some((m) => m.key === 'plan'), 'the plan is never written into a backup');
  await DB.del('meta', 'plan');   // a different phone that is not Pro
  await DB.importAll({ app: 'mynote-stocks', version: 19, meta: [{ key: 'plan', value: { plan: 'paid', at: 1 } }], stocks: [], monthly: [], snapshots: [] });
  eq(await snd.getCachedPlan(), 'free', 'restoring a backup cannot hand out Pro');
  w().localStorage.removeItem('mynoteUsageTest');
});
test('a server that has forgotten this install makes the app register it again', async () => {
  await boot(['stocks']);
  const snd = await w().eval('import("' + new URL('../sender.js', location.href).href + '")');
  const calls = [];
  w().fetch = async (url, init) => {
    calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
    if (/\/api\/plan$/.test(url)) return { status: 200, json: async () => ({ plan: 'free', known: false }) };
    return { status: 204 };
  };
  await DB.del('meta', 'usageLastSent'); await DB.del('meta', 'usageFailAt');
  w().localStorage.setItem('mynoteUsageTest', '1');
  eq(await snd.sendUsage(), 'sent'); eq(await snd.sendUsage(), 'skip', 'unchanged state is not re-sent');
  await snd.checkPlan(); await sleep(400);
  const collects = calls.filter((c) => /\/api\/collect$/.test(c.url));
  eq(collects.length, 2, 'after "known: false" the details were sent again');
  w().localStorage.removeItem('mynoteUsageTest');
});
test('usage preview: the Privacy screen shows the exact message and says it is not active', async () => {
  await boot(['stocks', 'mf']);
  const app = await w().eval('import("' + new URL('../app.js', location.href).href + '")');
  await app.saveUsageProfile({ share: true, ageBand: '35-44', gender: 'Male' });
  app.openLegal('privacy'); await sleep(500);
  const btn = byText('.legal-sheet .btn', 'Show what MyNotes would send');
  ok(btn, 'preview button is on the Privacy screen');
  btn.click(); await sleep(500);
  const sheet = $('.legal-sheet');
  ok(/Not active yet: nothing is being sent/.test(sheet.textContent), 'says it is not active');
  const json = JSON.parse($('.usage-json').textContent);
  eq(json.features.join(), 'mf,stocks'); eq([json.ageBand, json.gender].join(), '35-44,Male');
  ok(json.installId && json.v === 1 && json.platform, 'complete message');
});
test('Choose features: grouped under five category headings with the new wording; limit, dependency and saving unchanged', async () => {
  await wipe(); await load();
  const kak = $('.onboard-kakeibo');
  ok(kak && /Track consciously\. Spend intentionally\./.test(kak.textContent) && /No SMS or email scanning/.test(kak.textContent), 'the welcome screen carries the Kakeibo message');
  byText('.onboard .btn', 'Get started').click(); await sleep(300);

  eq($('.onboard-h').textContent, 'Choose up to 5 tools to get started');
  eq($('.onboard-sub').textContent, 'Try any 5 features for free. You can switch them anytime, and your existing data stays safe.');

  const cats = $$('.onboard-cat').map((s) => [s.querySelector('.onboard-cat-h').textContent.replace(/^[^A-Za-z]+/, ''), [...s.querySelectorAll('.onboard-opt-name')].map((n) => n.textContent)]);
  eq(cats.map((c) => c[0]), ['Spending', 'Investments', 'Planning', 'Family', 'Security']);
  eq(cats[0][1], ['Expenses & Credit Cards', 'Personal Spending', 'Bank Savings']);
  eq(cats[1][1], ['Stocks', 'Mutual Funds', 'Fixed Deposits', 'Gold & Silver', 'Bonds', 'Dividends']);
  eq(cats[2][1], ['Emergency Fund', 'Inflation Calculator']);
  eq(cats[3][1], ['Health Records']);
  eq(cats[4][1], ['Password Vault']);
  eq($$('.onboard-opt').length, 13, 'every feature is still there, once');

  const tile = (n) => $$('.onboard-opt').find((o) => o.querySelector('.onboard-opt-name').textContent === n);
  ok(tile('Dividends').disabled, 'Dividends still needs Stocks');
  ['Expenses & Credit Cards', 'Stocks', 'Emergency Fund', 'Health Records', 'Password Vault'].forEach((n) => tile(n).click());
  eq($('.onboard-count').textContent, '5 of 5 selected', 'any five across any categories');
  ok(!tile('Dividends').disabled, 'Dividends unlocks once Stocks is chosen');
  tile('Bank Savings').click(); await sleep(250);
  ok(/free features/i.test(dialog()), 'a sixth pick still gets the upsell');
  dialogBtn('Cancel').click(); await sleep(200);
  eq($('.onboard-count').textContent, '5 of 5 selected'); ok(!tile('Bank Savings').classList.contains('on'));

  byText('.onboard-link', 'Clear').click(); await sleep(150);
  eq($('.onboard-count').textContent, '0 of 5 selected', 'Clear still empties the selection');
  ['Personal Spending', 'Mutual Funds', 'Inflation Calculator', 'Bonds', 'Password Vault'].forEach((n) => tile(n).click());
  $('.onboard-bar .btn.primary').click(); await sleep(400);
  eq((await DB.get('meta', 'enabledModules')).value.slice().sort(), ['bond', 'inflation', 'mf', 'personal', 'vault'], 'the choice is saved exactly as picked');
});
test('Name is asked on the Help us improve page (not the welcome screen), kept on this device whether they Share or Skip, and never sent', async () => {
  const toAbout = async () => {
    await wipe(); await load();
    ok(!$('.onboard-name'), 'the welcome screen no longer asks for a name');
    byText('.onboard .btn', 'Get started').click(); await sleep(300);
    $$('.onboard-opt').find((o) => o.querySelector('.onboard-opt-name').textContent === 'Stocks').click(); await sleep(100);
    $('.onboard-bar .btn.primary').click(); await sleep(400);
    ok(/Help us improve/i.test($('.onboard').textContent), 'on the Help us improve page');
    ok($('.onboard-name'), 'the name field is on this page');
    ok(/never leaves this device/.test($('.onboard-field-note').textContent), 'and says it stays on the device');
  };
  await toAbout();
  $('.onboard-name').value = '  Asha  ';
  byText('.onboard .btn', 'Skip').click(); await sleep(300);
  eq((await DB.get('meta', 'userName')).value, 'Asha', 'Skip still keeps the name, trimmed');
  eq(await DB.get('meta', 'usageProfile'), undefined, 'and shares nothing');

  await toAbout();
  $('.onboard-name').value = 'Ravi';
  const sel = $$('.onboard select'); sel[0].value = '25-34';
  byText('.onboard .btn', 'Share').click(); await sleep(300);
  eq((await DB.get('meta', 'userName')).value, 'Ravi', 'Share keeps the name too');
  eq((await DB.get('meta', 'usageProfile')).value.ageBand, '25-34');
  const app = await w().eval('import("' + new URL('../sender.js', location.href).href + '")');
  const msg = await app.currentPayload();
  ok(!JSON.stringify(msg).includes('Ravi') && !('name' in msg), 'the name is never in what would be sent');
});
test('data present but no features chosen: a required picker blocks Home (restored backup case)', async () => {
  await wipe(); await DB.put('stocks', stock('X')); await load();
  ok($('.onboard'), 'picker up');
  eq($$('.onboard-bar .btn').map((b) => b.textContent), ['Save'], 'no way out but to choose');
});
test('gating: a screen whose feature was not chosen redirects to the picker', async () => {
  await boot(['stocks']);
  await go('health');
  eq(d().body.dataset.mode, 'home'); ok($('.onboard'), 'picker opened');
  $('.onboard')?.remove(); d().body.classList.remove('locked');
  await go('investment'); eq(d().body.dataset.mode, 'investment');
});
test('home: cards, subtitles and totals follow the chosen features', async () => {
  await boot(['stocks', 'mf'], async () => {
    await DB.put('stocks', stock('A')); // 1000 invested, 1200 value
    await DB.put('funds', { owner: 'me', name: 'F', status: 'Investing', sip: 0, latestNav: 120, navAsOf: '2026-09-01', contributions: [{ date: '2026-01-01', amount: 500, units: 5, nav: 100 }], valueHistory: [] });
  });
  eq($$('#homeView .home-card-title').map((e) => e.textContent), ['Investment']);
  ok(/Stocks · MF/.test(byText('#homeView .home-card', 'Investment').textContent), 'subtitle lists only chosen');
  ok(/₹1,500/.test($('#homeView .home-summary').innerText), 'total invested = stock 1000 + fund 500');
  await DB.put('meta', { key: 'enabledModules', value: ['stocks'] }); await load();
  ok(/₹1,000/.test($('#homeView .home-summary').innerText), 'fund drops out of the total when not chosen');
});
test('stock-only sections can never show on another screen', async () => {
  await boot(ALL, async () => { await DB.put('stocks', stock('A', '', { updatedAt: new Date(Date.now() - 6 * 864e5).toISOString() })); });
  const ids = ['summary', 'price-status', 'toolbar', 'stockList', 'addBtn', 'ocrBtn', 'bottomNav', 'portfolioTabs'];
  for (const m of ['home', 'metal', 'ef', 'mf', 'health', 'expense', 'bond']) {
    await go(m); ids.forEach((i) => d().getElementById(i)?.classList.remove('hidden'));   // force the old bug
    await sleep(150);
    const leaked = ids.filter((i) => visible(d().getElementById(i)));
    eq(leaked, [], m + ' leaks');
  }
});
test('SGB: name must START with SGB and category must be BONDS', async () => {
  await boot(['stocks', 'metal'], async () => {
    await DB.put('stocks', stock('SGB 2032 Series II', 'BONDS')); await DB.put('stocks', stock('SGB Aug 2029', 'BONDS'));
    await DB.put('stocks', stock('SGB 2030', 'Investment')); await DB.put('stocks', stock('Nippon SGB Fund', 'BONDS'));
  });
  await go('metal'); byText('#metalBottomNav button', 'SGB').click(); await sleep(900);
  eq($$('#metalView .stock-list .name').map((n) => n.textContent), ['SGB 2032 Series II', 'SGB Aug 2029']);
});

// ---------------------------------------------------------------- screens
test('bank savings: add, edit and delete', async () => {
  await boot(['banksav']); await go('banksav');
  ok(/No savings accounts/.test($('#bankSavView').innerText), 'empty state');
  $('#bankSavAddBtn').click(); await sleep(700);
  const sh = $('.modal-host:not(.hidden) .sheet');
  const t = sh.querySelector('input'); t.value = 'HDFC'; t.dispatchEvent(new Event('input'));
  const n = sh.querySelector('input[type=number]'); n.value = '45000'; n.dispatchEvent(new Event('input'));
  [...sh.querySelectorAll('.btn')].find((b) => /save/i.test(b.textContent)).click(); await sleep(900);
  eq((await DB.all('bankSavings')).map((r) => r.bank + ':' + r.balance), ['HDFC:45000']);
  $('#bankSavView .card').click(); await sleep(700);
  [...$$('.modal-host .btn')].find((b) => /delete/i.test(b.textContent)).click(); await sleep(500);
  dialogBtn('Yes').click(); await sleep(900);
  eq((await DB.all('bankSavings')).length, 0);
});
test('emergency fund: tabs, contribution and target save, last-achieved line', async () => {
  await boot(['ef']); await go('ef');
  ok(/Start your emergency fund/.test($('#efView').innerText), 'guided empty state');
  const tab = async (n) => { byText('#efBottomNav button', n).click(); await sleep(800); };
  await tab('Log'); $('#efAddBtn').click(); await sleep(700);
  let sh = $('.modal-host:not(.hidden) .sheet');
  [...sh.querySelectorAll('input[type=number]')].slice(0, 2).forEach((i) => { i.value = '5000'; i.dispatchEvent(new Event('input')); });
  [...sh.querySelectorAll('.btn')].find((b) => /save/i.test(b.textContent)).click(); await sleep(900);
  eq((await DB.byIndex('emergency', 'kind', 'contribution')).length, 1);
  await tab('Targets'); $('#efAddBtn').click(); await sleep(700);
  sh = $('.modal-host:not(.hidden) .sheet');
  const nm = sh.querySelector('input:not([type])') || sh.querySelector('input[type=text]'); nm.value = 'Starter'; nm.dispatchEvent(new Event('input'));
  const am = sh.querySelector('input[type=number]'); am.value = '8000'; am.dispatchEvent(new Event('input'));
  [...sh.querySelectorAll('.btn')].find((b) => /save/i.test(b.textContent)).click(); await sleep(900);
  ok($('.ef-ladder-last'), 'last target achieved line');
  await tab('Rules'); ok($('#efAddBtn').classList.contains('hidden'), 'no + on Rules');
});
test('metals empty state, personal empty state, dividends button', async () => {
  await boot(['metal', 'personal', 'stocks', 'div']);
  await go('metal'); ok($('#metalView .empty-cta'), 'metals first step button');
  await go('personal'); eq($$('#pfView .empty .btn').map((b) => b.textContent), ['Log a spend', 'Set limits']);
  await go('div'); byText('#divView .empty .btn', 'Go to Stocks').click(); await sleep(1100); eq(d().body.dataset.mode, 'stocks');
});
test('get started card: rows per chosen feature, vanish when done, sits under the title', async () => {
  await boot(['stocks', 'banksav']);
  eq($$('#homeView > *').map((e) => e.className.split(' ')[0]).slice(0, 3), ['home-hero', 'home-start', 'home-summary']);
  eq($$('#homeView .home-start-label').map((e) => e.textContent), ['Add your first stock', 'Add a bank account']);
  await DB.put('stocks', stock('A')); await DB.put('bankSavings', { bank: 'B', balance: 1, asOf: '2026-09-19' }); await DB.put('meta', { key: 'lastBackup', value: Date.now() });
  await load(); ok(!$('#homeView .home-start'), 'card gone when everything is done');
});
test('forms: advanced fields sit behind More options and open when used', async () => {
  await boot(['fd'], async () => { await DB.put('fds', { owner: 'me', bank: 'X', principal: 1, rate: 7, startDate: '2026-01-01', maturityDate: '2027-01-01', compounding: 'quarterly', payout: 'cumulative', parentFdIds: [], notes: 'note' }); });
  await go('fd'); $('#fdAddBtn').click(); await sleep(800);
  eq($('.modal-host:not(.hidden) details.more-opts').open, false, 'new FD: collapsed'); closeSheet();
  $('#fdView .card').click(); await sleep(800);
  eq($('.modal-host:not(.hidden) details.more-opts').open, true, 'FD with a note: open');
});
test('update check: card when behind, none when current, Later remembered per release', async () => {
  await boot(['stocks']);
  // Import inside the frame's own realm (absolute URL) so the popup is drawn in the frame.
  const app = await w().eval('import("' + new URL('../app.js', location.href).href + '")');
  for (const k of await w().caches.keys()) await w().caches.delete(k);
  await w().caches.open('mynote-app-v100'); w().sessionStorage.removeItem('mynoteUpdateLater');
  await app.checkForNewVersion(); await sleep(400);
  ok($('.update-pop'), 'card shown when behind');
  $('.update-pop .later').click(); await app.checkForNewVersion(); await sleep(300);
  ok(!$('.update-pop'), 'Later is remembered');
  for (const k of await w().caches.keys()) await w().caches.delete(k);
  await w().caches.open('mynote-app-v' + app.APP_VERSION); w().sessionStorage.removeItem('mynoteUpdateLater');
  await app.checkForNewVersion(); await sleep(300);
  ok(!$('.update-pop'), 'no card when current');
  for (const k of await w().caches.keys()) await w().caches.delete(k);
});

test('bonds: add through the form, list it, and the schedule/payout tabs open', async () => {
  await boot(['bond']); await go('bond');
  ok(/No bonds yet/.test($('#bondView').innerText), 'empty state');
  $('#bondAddBtn').click(); await sleep(800);
  let sh = $('.modal-host:not(.hidden) .sheet');
  eq([...sh.querySelectorAll('.seg button')].map((b) => b.textContent).slice(0, 3), ['Details', 'Schedule', 'Payouts']);
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
  const inputs = [...sh.querySelectorAll('input')];
  set(inputs.find((i) => i.type === 'text'), 'Test Bond');
  const nums = inputs.filter((i) => i.type === 'number'); set(nums[0], '11.5'); set(nums.find((n) => n !== nums[0]), '10000');
  const dates = inputs.filter((i) => i.type === 'date'); set(dates[0], '2026-03-01'); set(dates[1], '2027-03-01');
  [...sh.querySelectorAll('.btn')].find((b) => /save/i.test(b.textContent)).click(); await sleep(1000);
  eq((await DB.all('bonds')).map((b) => b.name), ['Test Bond']);
  ok(/Test Bond/.test($('#bondView').innerText), 'listed');
});
const setv = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
const saveSheet = async () => { [...$$('.modal-host:not(.hidden) .btn')].find((b) => /^save$/i.test(b.textContent.trim())).click(); await sleep(1000); };
test('mutual funds: add a fund and log a buy; Targets and Performance tabs open', async () => {
  await boot(['mf']); await go('mf');
  ok(/No funds yet/.test($('#mfView').innerText), 'empty state');
  $('#mfAddBtn').click(); await sleep(800);
  const sh = $('.modal-host:not(.hidden) .sheet');
  setv(sh.querySelector('input[type=text], input:not([type])'), 'Test Fund');
  await saveSheet();
  eq((await DB.all('funds')).map((f) => f.name), ['Test Fund']);
  ok(/Test Fund/.test($('#mfView').innerText), 'listed');
  for (const t of ['Targets', 'Performance']) { byText('#mfBottomNav button', t).click(); await sleep(700); ok(visible($('#mfView')), t + ' renders'); }
});
test('credit cards: add a card and see it listed', async () => {
  await boot(['expense']); await go('expense'); byText('#expBottomNav button', 'Credit Card').click(); await sleep(800);
  ok(/No credit cards yet/.test($('#expenseView').innerText), 'empty state');
  $('#ccAddBtn').click(); await sleep(800);
  const sh = $('.modal-host:not(.hidden) .sheet');
  setv(sh.querySelector('input[type=text], input:not([type])'), 'HDFC Regalia');
  await saveSheet();
  eq((await DB.all('creditCards')).map((c) => c.name), ['HDFC Regalia']);
  ok(/HDFC Regalia/.test($('#expenseView').innerText), 'listed');
});
test('metals: add a gold purchase through the form', async () => {
  await boot(['metal']); await go('metal'); byText('#metalBottomNav button', 'Gold').click(); await sleep(800);
  $('#metalAddBtn').click(); await sleep(800);
  const sh = $('.modal-host:not(.hidden) .sheet');
  const nums = [...sh.querySelectorAll('input[type=number]')]; setv(nums[0], '2'); setv(nums[1], '30000');
  await saveSheet();
  const rows = await DB.all('metals'); eq(rows.length, 1); eq([rows[0].metal, rows[0].grams], ['gold', 2]);
});
test('feed and vault screens render their first-run state', async () => {
  await boot(['stocks', 'vault']); await go('vault');
  ok(/Set a master password/.test($('#vaultView').innerText), 'vault asks for a master password');
  await go('stocks'); byText('#bottomNav button', 'Feed').click(); await sleep(900);
  ok(visible($('#feedView')), 'feed tab renders');
});
test('smoke: every screen opens with data present and throws no JavaScript error', async () => {
  await boot(ALL, async () => {
    await DB.put('stocks', stock('A')); await DB.put('bankSavings', { bank: 'B', balance: 1, asOf: '2026-09-19' });
    await DB.put('funds', { owner: 'me', name: 'F', status: 'Investing', sip: 0, latestNav: 120, navAsOf: '2026-09-01', contributions: [{ date: '2026-01-01', amount: 500, units: 5, nav: 100 }], valueHistory: [] });
    await DB.put('fds', { owner: 'me', bank: 'X', principal: 1000, rate: 7, startDate: '2026-01-01', maturityDate: '2027-01-01', compounding: 'quarterly', payout: 'cumulative', parentFdIds: [] });
    await DB.put('bonds', { owner: 'me', name: 'Bo', investAmount: 1000, rate: 10, startDate: '2026-01-01', maturityDate: '2027-01-01', payout: 'payout', payouts: [] });
    await DB.put('metals', { metal: 'gold', date: '2026-01-01', grams: 1, amount: 7000, type: 'buy' });
    await DB.put('emergency', { kind: 'contribution', date: '2026-01-01', mine: 100, spouse: 100, note: '' });
    await DB.put('healthPeople', { name: 'P', dob: '1990-01-01', gender: 'Male' });
  });
  const errors = []; w().addEventListener('error', (e) => errors.push(e.message)); w().addEventListener('unhandledrejection', (e) => errors.push('rejected: ' + (e.reason && e.reason.message)));
  const tabsOf = { stocks: 'bottomNav', mf: 'mfBottomNav', fd: 'fdBottomNav', metal: 'metalBottomNav', bond: 'bondBottomNav', ef: 'efBottomNav', expense: 'expBottomNav', personal: 'pfBottomNav', div: 'divBottomNav' };
  for (const m of ['home', 'investment', 'savings', 'stocks', 'mf', 'fd', 'div', 'metal', 'bond', 'ef', 'banksav', 'expense', 'personal', 'health', 'vault']) {
    await go(m);
    const nav = tabsOf[m] && d().getElementById(tabsOf[m]);
    if (nav) for (const b of [...nav.querySelectorAll('button')]) { b.click(); await sleep(450); }
  }
  eq(errors, [], 'errors while browsing every screen and tab');
});

// ---------------------------------------------------------------- runner
const list = document.getElementById('list');
const results = { passed: 0, failed: 0, failures: [], done: false };
window.__results = results;
for (const [name, fn] of tests) {
  const li = document.createElement('li');
  try { await fn(); results.passed++; li.innerHTML = '<span class="ok">PASS</span> ' + name; }
  catch (e) { results.failed++; results.failures.push({ name, error: String(e.message || e) }); li.innerHTML = '<span class="bad">FAIL</span> ' + name + '<pre></pre>'; li.querySelector('pre').textContent = String(e.message || e); }
  list.appendChild(li);
  localStorage.removeItem('mynoteUsageTest');   // even when the test threw before cleaning up
}
await wipe();
results.done = true;
const s = document.getElementById('summary');
s.textContent = results.failed ? results.failed + ' FAILED, ' + results.passed + ' passed' : 'All ' + results.passed + ' tests passed';
s.className = results.failed ? 'bad' : 'ok';
