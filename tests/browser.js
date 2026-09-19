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
async function wipe() { for (const s of STORES) await DB.clear(s).catch(() => {}); }
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

// ---------------------------------------------------------------- runner
const list = document.getElementById('list');
const results = { passed: 0, failed: 0, failures: [], done: false };
window.__results = results;
for (const [name, fn] of tests) {
  const li = document.createElement('li');
  try { await fn(); results.passed++; li.innerHTML = '<span class="ok">PASS</span> ' + name; }
  catch (e) { results.failed++; results.failures.push({ name, error: String(e.message || e) }); li.innerHTML = '<span class="bad">FAIL</span> ' + name + '<pre></pre>'; li.querySelector('pre').textContent = String(e.message || e); }
  list.appendChild(li);
}
await wipe();
results.done = true;
const s = document.getElementById('summary');
s.textContent = results.failed ? results.failed + ' FAILED, ' + results.passed + ' passed' : 'All ' + results.passed + ' tests passed';
s.className = results.failed ? 'bad' : 'ok';
