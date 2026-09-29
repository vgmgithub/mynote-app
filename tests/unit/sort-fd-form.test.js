import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRO_INFO } from '../../pro-info.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('Stocks sort: MF-style chips on the right, a second tap flips the order, one handler per button', () => {
  const html = read('index.html');
  assert.match(html, /<div class="mf-sort-chips stock-sort-chips" id="sortBar">/);
  const app = read('app.js');
  // No third "off" step: same chip again toggles between its two directions.
  assert.match(app, /if \(state\.sortField === f && state\.sortStage > 0\) state\.sortStage = state\.sortStage === 1 \? 2 : 1;/);
  // buildChrome() runs more than once a session; addEventListener on these static buttons stacked, so one
  // tap sorted and a second listener un-sorted it.
  assert.match(app, /sortBar\.querySelectorAll\('\[data-field\]'\)\.forEach\(\(btn\) => \{\s*btn\.onclick = \(\) => \{/);
  assert.match(app, /money: c\.priced \? c\.value : null/, 'Value sorts by current value, as in Mutual Funds');
});

test('FD sort: Maturity / Amount / Rate chips, tapping the active one reverses it', () => {
  const src = read('personal-ui.js');
  assert.match(src, /const FD_SORTS = \[\['maturity', 'Maturity', 'asc'\], \['principal', 'Amount', 'desc'\], \['rate', 'Rate', 'desc'\]\];/);
  assert.match(src, /if \(ui\._fdSort === v\) ui\._fdSortDir = ui\._fdSortDir === 'asc' \? 'desc' : 'asc';/);
  assert.match(src, /holdContent\.appendChild\(el\('div', \{ class: 'mf-toolbar-row' \}, \[filterSeg, sortbar\]\)\);/);
});

test('FD form: no Notes box, but a note saved before is never wiped by an edit; options are their own cards', () => {
  const src = read('personal-ui.js');
  const form = src.slice(src.indexOf('export async function openFdForm'), src.indexOf('// What the Home "Total Invested"'));
  assert.doesNotMatch(form, /el\('textarea'/, 'the Notes box is gone');
  assert.match(form, /notes: f\.notes \|\| '',/, 'an existing note is carried through on save');
  assert.match(form, /class: 'fd-opt fd-opt-ef'/);
  assert.match(form, /class: 'fd-opt fd-opt-roll'/);
  assert.match(form, /formSection\('\\u\{2699\}\\u\{FE0F\}', 'Options', \[rollCard, efCard\]\)/);
});

test('the Stocks Pro popup mentions extra stock profiles', () => {
  assert.ok(PRO_INFO.stocks.now.some((c) => c.title === 'Extra stock profiles'));
});

test('House Expense Tracker: a future month appears on the timeline once it has an entry, but the tab still opens on this month', () => {
  const src = read('expense-ui.js');
  assert.match(src, /\.filter\(\(k\) => k <= thisYm \|\| \(byYm\.get\(k\) \|\| \[\]\)\.length > 0\)\.sort\(\);/);
  assert.match(src, /ui\._trkYm = timelineYms\.includes\(thisYm\) \? thisYm : timelineYms\[timelineYms\.length - 1\];/);
});

test('Allocation tab: salary hero with a split bar and balance, then one card per group, from the same saved fields', () => {
  const src = read('expense-ui.js');
  const fn = src.slice(src.indexOf('async function renderAllocation'), src.indexOf('// Allocation form modal.'));
  assert.match(fn, /class: 'al-hero'/);
  assert.match(fn, /keys: \['home', 'houseExp', 'card'\]/);
  assert.match(fn, /keys: \['mf', 'fd', 'indStock', 'usStock', 'metal'\]/);
  assert.match(fn, /keys: \['emergency', 'savings'\]/);
  assert.match(fn, /const bal = round2\(salary - allocated\);/, 'balance is still derived, never stored');
  assert.match(fn, /curAlloc\.sharedOn \? Number\(curAlloc\.sharedAmount\)/, 'shared-by-others still shown under House Exp');
});

test('FD summary tiles: count, return % and rolled-over % as corner badges (no second line); matured green, rolled over blue', () => {
  const src = read('personal-ui.js');
  assert.match(src, /class: 'fd-stat-badge is-count', text: maturedVisible\.length \+/);
  assert.match(src, /class: 'fd-stat-badge is-good', title: 'Return on the matured principal', text: fmtIntRate\(maturedReturnPct\)/);
  assert.ok(!src.includes("fmtIntRate(maturedReturnPct) + ' return'"), 'no "x% return" line on the Matured Interest tile any more');
  assert.match(src, /class: 'badge good mf-beat fd-matured-badge', text: 'matured'/);
  assert.match(src, /class: 'badge mf-beat fd-reinvested', text: 'rolled over'/);
});

test('Stocks Trend month line: up / down counts as green / red chips and the index as a badge', () => {
  const app = read('app.js');
  assert.match(app, /el\('span', \{ class: 'mm-up', text: '▲ '/);
  assert.match(app, /el\('span', \{ class: 'mm-down', text: '▼ '/);
  assert.match(app, /el\('span', \{ class: 'mm-index', title: bname \+ ' that month', text: bname \+ ' ' \+ m\.nifty \}\)/);
});
