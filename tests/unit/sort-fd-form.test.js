import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRO_INFO } from '../../pro-info.js';

import { read } from './src.js';

test('Stocks sort: MF-style chips on the right, a second tap flips the order, one handler per button', () => {
  const html = read('index.html');
  assert.match(html, /<div class="mf-sort-chips stock-sort-chips" id="sortBar">/);
  const app = read('app.js');
  // No third "off" step: same chip again toggles between its two directions.
  assert.match(read('stocks-profiles.js'), /if \(state\.sortField === f && state\.sortStage > 0\) state\.sortStage = state\.sortStage === 1 \? 2 : 1;/);
  // buildChrome() runs more than once a session; addEventListener on these static buttons stacked, so one
  // tap sorted and a second listener un-sorted it.
  // (buildChrome now lives in stocks-profiles.js)
  assert.match(read('stocks-profiles.js'), /sortBar\.querySelectorAll\('\[data-field\]'\)\.forEach\(\(btn\) => \{\s*btn\.onclick = \(\) => \{/);
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
  assert.match(app, /el\('span', \{ class: 'mm-index', title: bname \+ ' that month' \}, \[/);
  assert.match(app, /src: 'icons\/nse\.png'/, 'Nifty carries the exchange mark');
  assert.match(app, /class: 'mm-index-name', text: bname \+ ' '/, 'the index name is coloured apart from its value');
});

test('Tags tab: spending only (no refund text), For Others as its own view, two short coverage lines and one for-others line', () => {
  const src = read('expense-ui.js');
  // The Tags renderer only (the heatmap helper that follows it has its own refund cell, which is not this tab).
  const fn = src.slice(src.indexOf('export async function renderTagAnalysis'), src.indexOf('const _heatCell'));
  assert.ok(fn.length > 5000, 'sliced the right function');
  assert.match(fn, /x\.amount > 0\);/, 'only spends are read');
  assert.doesNotMatch(fn, /came back|came back in this scope|pf-refund-line|backTotal/, 'no refund wording or figures');
  assert.match(src, /\['others', 'For Others'\]\];/);
  assert.match(fn, /const pool = isOthers \? allRaw\.filter\(\(x\) => isForOthers\(x\.r\) && sideOk\(x\)\) : all;/);
  assert.match(fn, /'% still need a tag'/, 'the untagged share, in bold');
  assert.match(fn, /class: 'hint tag-cover-others'/, 'spends for others in one line');
});

test('Card Check has one icon (a bill with a magnifying glass) on Credit Cards, Personal Finance and the Combined tab button', () => {
  const pf = read('personal-ui.js'), cc = read('cc-ui.js'), an = read('analysis-ui.js');
  assert.match(pf, /export function cardCheckIcon\(cls\)/);
  assert.match(pf, /v === 'cards' \? cardCheckIcon\(\)/);
  assert.match(cc, /v === 'chk' \? cardCheckIcon\(\)/);
  assert.match(an, /\[cardCheckIcon\('is-sm'\), document\.createTextNode\('Open Card Check'\)\]/);
});

test('Combined chart: a short fixed-height bar with a tiny plain % inside each household / personal segment of every month', () => {
  const an = read('analysis-ui.js'), css = read('styles.css');
  assert.match(an, /const BAR_H = 72, SEG_MIN = 9;/);
  assert.match(an, /pv > 0 \? seg\('is-personal', pPx, pP\) : null,/);
  assert.match(an, /hv > 0 \? seg\('is-house', hPx, hP\) : null,/);
  assert.match(css, /\.an-stack-bar \{[^}]*height: 72px;/, 'the CSS bar height matches BAR_H');
  assert.match(css, /\.an-seg-pct \{[^}]*color: #fff;/, 'plain white text');
  assert.doesNotMatch(css, /\.an-stack-pct/, 'the badge style is gone');
});

test('Analysis tab bar: Household wears the shopping cart and Personal the money-note image', () => {
  const an = read('analysis-ui.js');
  assert.ok(an.includes("['house', '\\u{1F6D2}', 'Household']"), 'the cart');
  assert.match(an, /\['personal', 'icons\/personal-finance\.png', 'Personal'\]/);
  assert.match(an, /ico\.indexOf\('icons\/'\) === 0 \? el\('img'/);
});

test('AI Prompt tab: the owner\'s brain image with a tiny node running along its folds and only a faint glow, still for reduced motion', () => {
  const an = read('analysis-ui.js'), css = read('styles.css'), sw = read('service-worker.js'), nodes = read('icons/brain-nodes.svg');
  assert.match(an, /\['prompt', 'icons\/brain\.png', 'AI Prompt'\]/);
  assert.ok(readFileSync(new URL('../../icons/brain.png', import.meta.url)).length > 0, 'the image is in icons/');
  // The nodes: one per traced fold, on the image's own 128 x 128 grid, each taking its turn.
  assert.match(nodes, /viewBox="0 0 128 128"/);
  assert.equal((nodes.match(/<animateMotion /g) || []).length, 4);
  assert.match(nodes, /<circle r="2\.6" fill="#fff"\/>/, 'a tiny node');
  assert.match(nodes, /prefers-reduced-motion: reduce/);
  assert.match(css, /#analysisBottomNav button\[data-view="prompt"\] \.bn-ico::after \{[^}]*background: url\('icons\/brain-nodes\.svg'\) center \/ contain no-repeat;/);
  // Only a faint rim: never more than a 2px glow, which pulses on the active tab alone.
  assert.match(css, /@keyframes aiBrainGlow \{ 0%, 100% \{ filter: drop-shadow\(0 0 1px [^)]*\)\); \} 50% \{ filter: drop-shadow\(0 0 2px [^)]*\)\); \} \}/);
  assert.match(css, /#analysisBottomNav button\[data-view="prompt"\]\.active \.mod-ico-img \{ animation: aiBrainGlow/);
  assert.doesNotMatch(css, /aiBrainRun|aiBrainGlowOn/, 'the light sweep and the strong glow are gone');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*#analysisBottomNav button\[data-view="prompt"\]\.active \.mod-ico-img \{ animation: none; \}\s*#analysisBottomNav button\[data-view="prompt"\] \.bn-ico::after \{ display: none; \}/);
  assert.match(sw, /'\.\/icons\/brain\.png',\s*'\.\/icons\/brain-nodes\.svg',/, 'both cached for offline use');
});

test('Where money could be kept: one card per place that opens onto its spends, with when in the month each fell; used on all three pages', () => {
  const ex = read('expense-ui.js'), pf = read('personal-ui.js'), an = read('analysis-ui.js');
  assert.match(ex, /export function rvwKeepList\(rows, o\)/);
  assert.match(ex, /d <= Math\.ceil\(dim \/ 3\) \? 'Start of month' : d <= Math\.ceil\(dim \* 2 \/ 3\) \? 'Mid-month' : 'End of month'/);
  assert.match(ex, /mine\.slice\(-r\.fewer\)/, 'the last few visits - the ones past the usual count');
  assert.match(ex, /rvwKeepList\(savings\.rows, \{ scope: 'house'/);
  assert.match(pf, /rvwKeepList\(savings\.rows, \{ scope: 'personal'/);
  assert.match(an, /rvwKeepList\(saves, \{ scope: 'both'/);
});

test('AI Prompt: the "does not give financial advice" line is a disclaimer under Generate prompt, not part of the intro card', () => {
  const an = read('analysis-ui.js');
  const head = an.slice(an.indexOf("class: 'card an-prompt-head'"), an.indexOf('const purposeRow'));
  assert.doesNotMatch(head, /financial advice/);
  const gen = an.indexOf("text: 'Generate prompt'"), disc = an.indexOf("class: 'hint an-disclaimer'");
  assert.ok(gen > 0 && disc > gen, 'the disclaimer comes after the Generate prompt button');
  assert.match(an, /'MyNotes does not give financial advice and sends nothing anywhere/);
});

test('Production: Monthly / Annual answer with a "Pro is coming soon" popup and its rocket, and nothing is charged', () => {
  const fp = read('feature-picker.js'), css = read('styles.css'), sw = read('service-worker.js'), art = read('icons/coming-soon.svg');
  assert.match(fp, /if \(IS_PRODUCTION\) \{ showProComingSoon\(period, price\); return; \}/, 'production stops before checkout');
  assert.ok(fp.indexOf('showProComingSoon(period, price); return;') < fp.indexOf("import('./pay.js')"), 'the popup comes before any payment code');
  assert.match(fp, /src: 'icons\/coming-soon\.svg'/);
  assert.match(fp, /'Pro is coming soon'/);
  assert.match(fp, /is not on sale yet, so nothing is charged/);
  assert.match(css, /\.pro-cs-back \{[^}]*z-index: 9800;/);
  assert.match(css, /\.pro-cs \{[^}]*background: var\(--card\);/, 'its own class, not the older .pro-soon list style (which is faded)');
  assert.match(art, /@keyframes bob/); assert.match(art, /prefers-reduced-motion: reduce/);
  assert.match(sw, /'\.\/icons\/coming-soon\.svg',/);
});
