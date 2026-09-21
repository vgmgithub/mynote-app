// UI, state and wiring. Pure calculations live in core.js; storage in db.js.
import { ui } from './state.js';
import { DB } from './db.js';
import { renderLegal, LEGAL_UPDATED } from './legal-text.js';
import { PRO_INFO, PRO_COMMON, MODE_FEATURE } from './pro-info.js';
import { sendUsage, requestForget, usageStatus, applyUsageTestParam, checkPlan, getCachedPlan } from './sender.js';
import {
  PORTFOLIOS, CATEGORIES, CONVICTIONS, convIcon, curOf,
  fmtCur, fmtPct, fmtIntRate, pctClass, todayISO, num,
  calc, latestHist, displayPct, summarize,
  ymToLabel, labelToYm, monthKey, thisYm,
} from './core.js';
import {
  PIN_LENGTH, getLockConfig, setPin, verifyPin, disableLock,
  biometricSupported, biometricAvailable, registerBiometric, verifyBiometric,
  disableBiometric, wipeAllData,
} from './lock.js';
import {
  BACKUPS_KEEP, APP_FOLDER_NAME, fileSystemAccessSupported, getSavedFolder, ensureFolderPermission,
  pickFolder, listBackups, readBackupByName, writeBackup, rotateBackups,
  writePreRestoreSnapshot, readBackupViaFilePicker,
} from './backup.js';
import { renderBankSavings, openBankSavForm } from './banksav.js';
import { renderEmergency, openEmergency, efLoad, efAddForTab } from './ef.js';
import { renderBond, openBond, openBondForm } from './bonds-ui.js';
import { renderDividend, _eligibleDividendRecords, openDividend } from './divs-ui.js';
import { renderMetal, openMetal, openMetalTxn } from './metals-ui.js';
import { openCreditCardForm } from './cards-ui.js';
import { runPlanSetupIfNeeded } from './plan-setup-ui.js';
import { buildPlanCompare, buildCompareHeader, PRO_PRICE, PRO_PRICE_NOTE, NOT_ON_SALE } from './plan-compare.js';
import { renderCc, buildCcBottomNav } from './cc-ui.js';
import { renderMF, _mfCell, _mfValueCard, openMF, openFundForm, fetchMfNavs } from './mf-ui.js';
// Other screens import these two helpers from app.js; they now live with the Mutual Funds screens.
export { _mfCell, _mfValueCard } from './mf-ui.js';
import { _vaultKey, renderVault, lockVault, _vaultCopyBtn, openVaultForm, watchVaultSession } from './vault-ui.js';
import { _sentimentFlag, renderFeed, openFeedSettings, _autoRefreshFeedOnInit } from './feed-ui.js';
import { renderHome, buildExpBottomNav, buildPfBottomNav, renderPersonal, renderFD, fmtIntCur, homeInvestedBreakdown, openInvestedBreakdown, tagsOf, isForOthers, TAG_MAX, updateExpNavActive, spendEntryFilter, spendFilterNote, tagRow, tagField, knownTags, catAddBtn, openCatManager, normaliseTag, openFdForm, openPfSpendForm } from './personal-ui.js';
import { renderHomeExpense, round2, _daysInYm, fmtSheetCur, metalPortfolio, _gramsShort, openInfoSheet, catList, openSpendQuick, loadCategoryLists } from './expense-ui.js';
// Helpers other screens import from here; they now live in split-out files.
export { explainRow, _spendDayLabel, _reimbMap, _reimbParts, _mountMonthStrip, _ordinalSuffix, _spendMonthLabel, REFUND_CAT, PF_METHODS, syncOwedRow, isOwedRow, dropOwedRow, CAT_KINDS, saveCategoryList, SPEND_METHODS, renderTagAnalysis, _pfUpiLimit, PF_START_YM, isRefund, _pfCardLimit, pfRenderStale, _attachMonthSwipe, _SPEND_MONS, fmtSigned, _catMaps, _pfGroupClass, _reviewAnalysis, _pfGroupOf, _rvwScopeLine, REVIEW_MIN_HISTORY, _reviewCycle, _reviewForecast, _reviewSavings, _reviewSmallTickets, _smallTicketUsual, rvwSection, _reviewCurve, _rvwCurveChart, _rvwMonthBars, _catMonthHistory, _rvwCreepingSection, _reviewCreeping, _rvwMethodsSection, _reviewMethods, _rvwFitSection, _reviewKittyFit, _kittyFor } from './expense-ui.js';
// Names other screens import from here, now defined in split-out files.
export { fmtIntCur } from './personal-ui.js';
export { fmtSheetCur, renderHomeExpense, round2, catList, metalPortfolio, _gramsShort, _daysInYm } from './expense-ui.js';

export const state = {
  appMode: 'home',   // 'home' | 'stocks' | 'mf' - top-level surface (Stocks app is untouched)
  portfolio: 'me-in',
  view: 'holdings', // 'holdings' | 'monthly' | 'heatmap' | 'trends' | 'feed'
  filter: 'holding', // 'all' | 'holding' | 'sold' - default to active holdings
  sortField: 'name', // 'name' | 'pct' | 'value'
  sortStage: 0,      // 0 = default (name A-Z), 1 = primary, 2 = secondary
  search: '',
  stocks: [],
  snapshots: [],
  months: [],
};

// Me·US only - a display-only $→₹ switch (Holdings summary card, per-stock
// cards, the Trend chart/Months list, and Me·US's row on the cross-portfolio
// Overview). Converts at the Home strip's own cached USD→INR rate
// (meta.homeLiveRates.usdInr) - nothing is converted in storage, and nothing
// here re-fetches that rate itself (see render()'s top, which refreshes
// _cachedUsdInr from the local DB cache before any Stocks sub-view paints).
// In-memory only, resets on reload, same as every other view toggle in this
// file (_trkHeatmap etc).
let _usShowInr = false;
let _cachedUsdInr = null;

// Wraps fmtCur: for a USD figure with the toggle on and a known rate,
// converts and formats as ₹ instead. Every other currency/portfolio passes
// straight through untouched - this only ever intercepts that one combination.
//
// Rounds to the whole dollar BEFORE converting, not after - fmtCur's own USD
// formatting already rounds to 0 decimals for display (this app shows no
// paise/cents anywhere), so the $ figure on screen is already a rounded
// number. Converting the un-rounded underlying value instead multiplies out
// to something that doesn't match what's visibly on screen - e.g. a stock
// priced at $269.19 displays as "$269" but was converting to ₹269.19×rate,
// which reads as a bug ("269 × 95.67 should be ₹25,735, not ₹25,753") even
// though neither number was wrong on its own. Rounding first means the two
// displayed figures always multiply out exactly.
function _fmtCurUS(n, cur) {
  if (cur === 'USD' && _usShowInr && _cachedUsdInr > 0) {
    return fmtCur(Math.round(Number(n) || 0) * _cachedUsdInr, 'INR');
  }
  return fmtCur(n, cur);
}

async function _usCurToggleClick() {
  _usShowInr = !_usShowInr;
  if (_usShowInr) {
    const row = await DB.get('meta', 'homeLiveRates').catch(() => null);
    _cachedUsdInr = row && row.value && row.value.usdInr ? Number(row.value.usdInr) : null;
    if (!(_cachedUsdInr > 0)) {
      _usShowInr = false;
      toast('No USD→INR rate cached yet — open Home once to fetch it.');
      return;
    }
  }
  render();
}

// A compact iOS-style switch, not a text pill - the thumb itself carries the
// current symbol ($ default/off, ₹ when on) rather than spelling out
// "USD"/"INR", since the symbol alone is unambiguous here (this only ever
// appears next to a portfolio that's already $ by default).
function _usCurToggle() {
  return el('button', {
    type: 'button',
    class: 'us-cur-switch' + (_usShowInr ? ' active' : ''),
    title: _usShowInr ? 'Showing ₹ - tap for $' : 'Showing $ - tap for ₹',
    'aria-pressed': String(_usShowInr),
    onclick: _usCurToggleClick,
  }, [el('span', { class: 'us-cur-thumb', text: _usShowInr ? '₹' : '$' })]);
}

// Mutual-fund view state (only used inside the MF surface).
export let _mfTab = 'holdings';     // 'holdings' | 'overview' | 'benchmark' | 'stats' (bottom nav)

// Fixed-deposit view state (only used inside the FD surface).
// Dividend view state (only used inside the Dividends surface).
export let _divTab = 'stocks';      // 'stocks' | 'overview' | 'calendar' (bottom nav)
// Metals view state (only used inside the Metals surface).
export let _metalTab = 'overview';  // 'overview' | 'gold' | 'silver' | 'sgb' (bottom nav)
export function setMetalTab(v) { _metalTab = v; }   // for the Metals screens, which live in another file
// Bonds view state (only used inside the Bonds surface).
export let _bondTab = 'holdings';   // 'holdings' | 'overview' (bottom nav)
// Emergency Fund view state (only used inside the Emergency Fund surface).
export let _efTab = 'fund';         // 'fund' | 'targets' | 'loans' | 'log' | 'terms' (bottom nav)
// Expense view state (only used inside the Expense section page).
// First month the monthly sheet covers. Nothing before this is reachable — the
// sheet simply wasn't being kept then, so those months would be blank forever.
export const EXPENSE_START_YM = '2026-09';
// The Tracker reaches further back than the monthly sheet: household spends
// were being kept long before the sheet was, so its timeline starts here.
export const TRACKER_START_YM = '2024-09';
// Which half of the Tracker tab is showing. Defaults to the category roll-up:
// the entry list grows all month, and "where did it go" is the usual question.
// Entries filter on the Tracker: 'all', 'm:<method>' or 'card:<id>'. Same
// component as Personal Finance uses.
// The Tracker opens on the heatmap: one month tells you what you spent, every
// month tells you whether that is normal, and the second question is the one
// worth opening a tracker for. Tapping a month leaves it, and that choice then
// sticks for the session.
// Every Expense render takes a ticket. Each tab's renderer loads its data
// asynchronously, so two renders started close together (a fast tab switch, a
// save that re-renders while a switch is in flight) both clear the host and
// then both append — the loser's markup lands underneath the winner's and the
// page shows two tabs stacked. Each renderer re-checks its ticket after its
// awaits and bails if it's been superseded.
export const expRenderStale = (token) => token !== ui._expRenderToken;
export const MF_TYPES = ['Multi Cap', 'Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'Tax Saver', 'Technology', 'Pharma', 'Energy', 'International', 'Index', 'Debt', 'Hybrid'];
export const MF_STATUS = ['Investing', 'Investing On/Off', 'Investing Variable', 'Stopped', 'Sold'];

// The release this code belongs to. Bump it together with CACHE in service-worker.js.
export const APP_VERSION = 711;
let deferredInstall = null;

// ---------- tiny DOM helpers (no innerHTML: dynamic strings are always text nodes) ----------
export const $ = (sel, root) => (root || document).querySelector(sel);
// Returns a size-class suffix for .stat-v based on text length, so a long
// formatted currency string (e.g. "+₹1,91,997.42" = 13 chars, or "+₹10,00,000.00"
// = 14 chars) shrinks instead of wrapping mid-value. Combined with
// `white-space: nowrap` on .stat-v in CSS so nothing ever breaks across lines.
function _statSizeClass(value) {
  const len = String(value).length;
  if (len >= 16) return 'stat-v-xs';
  if (len >= 13) return 'stat-v-sm';
  return '';
}

export function el(tag, props, children) {
  const n = document.createElement(tag);
  if (props) {
    for (const k in props) {
      const val = props[k];
      if (k === 'class') n.className = val;
      else if (k === 'text') n.textContent = val;
      else if (k.startsWith('on') && typeof val === 'function') n.addEventListener(k.slice(2), val);
      else n.setAttribute(k, val);
    }
  }
  if (children) for (const c of children) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}
export const b = (s) => el('b', { text: s });
// A sovereign gold bond lives in the `stocks` store but is not a stock: it is
// gold, and the Metals surface owns it. Every surface that reports on STOCKS
// leaves it out, so it is not counted twice and does not distort a picture of
// equity - a single SGB can otherwise dominate an allocation chart it has no
// business being in.
//
// TWO things make a row an SGB: its name STARTS with "SGB" and its category is
// BONDS. Name alone used to be enough, which quietly swallowed any holding with
// "sgb" anywhere in it; the category makes it something the user opts into.
export const isSgb = (s) => /^\s*sgb/i.test((s && s.name) || '') && /bond/i.test((s && s.category) || '');
// Said in one place so the SGB tab, its empty state and any future hint agree.
export const SGB_RULE_TEXT = 'A holding counts as an SGB when its name starts with "SGB" and its category is BONDS. Those are listed here, counted as gold under Metals, and left out of your stock totals.';

// The Overview tab's cross-portfolio view. Deliberately NOT a value of
// state.portfolio: that drives which stocks are loaded, which currency is
// formatted, whether the OCR button shows and what the swipe steps through, and
// none of those has a sensible answer for "all three at once". A flag beside it
// leaves every one of them alone.
let _overallView = true;
// Label + value chip used on stock cards' right column (e.g. "Overall return" /
// "Booked" / "If held"). Hoisted here since both the holding and sold branches
// of stockCard() need it.
const kv = (label, valNode) => el('div', { class: 'kv' }, [el('span', { class: 'kv-label', text: label }), valNode]);
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const benchmarkName = (p) => (p === 'me-us' ? 'Nasdaq' : 'Nifty 50');
// All months from start..end inclusive as 'YYYY-MM' (used to insert gaps in charts).
function monthRange(startYm, endYm) {
  const out = [];
  let [y, m] = startYm.split('-').map(Number);
  const [ey, em] = endYm.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

const STALE_PRICE_DAYS = 30;

export function daysSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!t) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function priceAgeDays(s) {
  if (!s || s.status === 'sold' || !(Number(s.currentPrice) > 0)) return null;
  return daysSince(s.updatedAt || s.createdAt);
}

function isPriceStale(s) {
  const d = priceAgeDays(s);
  return d != null && d >= STALE_PRICE_DAYS;
}

export function formatTimeDuration(days) {
  if (days == null) return null;
  if (days < 30) return Math.round(days) + 'd';
  const months = Math.round(days / 30.44);
  if (months < 12) return months + 'm';
  const years = Math.round(days / 365.25);
  return years + 'y';
}

function isMonthEndReminderWindow(now) {
  const d = now || new Date();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() >= lastDay - 6;
}

function missingCurrentMonthCapture(months) {
  const ym = thisYm();
  return !(months || []).some((m) => m.ym === ym);
}

let toastTimer = null;
// A toast is normally just a receipt for something already done. Pass onTap
// and it becomes the way to do the next thing instead: telling someone where a
// button is, in a message that vanishes in two seconds, is how a reminder gets
// read and then not acted on. One that acts gets a longer life, because it is
// asking for a decision rather than reporting a fact.
export function toast(msg, onTap) {
  const existing = $('.toast');
  if (existing) existing.remove();
  const t = el('div', { class: 'toast' + (onTap ? ' is-tappable' : ''), text: msg });
  if (onTap) t.addEventListener('click', () => { clearTimeout(toastTimer); t.remove(); onTap(); });
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), onTap ? 7000 : 2200);
}

// ---------- In-app confirm / alert ----------
// Replaces the browser's native confirm()/alert(), which always print the site
// address ("xyz.vercel.app says") and cannot be styled. Both are promise-based.
let _dialogEl = null;
function _showDialog(message, buttons) {
  return new Promise((resolve) => {
    if (_dialogEl) _dialogEl.remove();
    const done = (v) => { if (_dialogEl) { _dialogEl.remove(); _dialogEl = null; } document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(buttons.length > 1 ? false : undefined); };
    document.addEventListener('keydown', onKey);
    const box = el('div', { class: 'app-dialog', role: 'alertdialog', 'aria-modal': 'true' }, [
      el('div', { class: 'app-dialog-msg', text: String(message == null ? '' : message) }),
      el('div', { class: 'app-dialog-btns' }, buttons.map((b) => el('button', {
        type: 'button', class: 'btn ' + b.cls, text: b.text, onclick: () => done(b.value),
      }))),
    ]);
    _dialogEl = el('div', { class: 'app-dialog-back' }, [box]);
    document.body.appendChild(_dialogEl);
    const first = _dialogEl.querySelector('.btn.primary, .btn.danger');
    if (first) first.focus();
  });
}
const _DANGER_RE = /delete|erase|wipe|replace|remove|cannot be undone|lose/i;
export function appConfirm(message, opts) {
  const danger = opts && opts.danger != null ? opts.danger : _DANGER_RE.test(String(message));
  return _showDialog(message, [
    { text: 'Cancel', cls: 'ghost', value: false },
    { text: (opts && opts.okText) || (danger ? 'Yes, continue' : 'OK'), cls: danger ? 'danger-fill' : 'primary', value: true },
  ]);
}
export function appAlert(message) {
  return _showDialog(message, [{ text: 'OK', cls: 'primary', value: undefined }]);
}

// ---------- data ----------
async function load() {
  const [stocks, snapshots, months] = await Promise.all([
    DB.byPortfolio('stocks', state.portfolio),
    DB.byPortfolio('snapshots', state.portfolio),
    DB.byPortfolio('monthly', state.portfolio),
  ]);
  state.stocks = stocks.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  state.snapshots = snapshots.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  state.months = months.sort((a, b) => (a.ym || '').localeCompare(b.ym || ''));
}
export async function refresh() { await load(); render(); }

// Single path for "switch to this portfolio", shared by the header tabs and the
// swipe gesture so the two can't drift apart (clearing `search` is the easy bit
// to forget in a second copy). `dir` is only passed by the swipe: +1 = moved
// forward through the strip, -1 = back, and it drives the slide animation so the
// gesture's direction is confirmed visually. A tap has no direction the user
// physically expressed, so it stays instant.
async function selectPortfolio(id, dir) {
  // Swiping the strip on Overview is the same statement as tapping a chip
  // there: show me this one, not all of them.
  if (state.view === 'trends') _overallView = false;
  if (state.portfolio === id) return;
  state.portfolio = id;
  state.search = '';
  await refresh();
  if (dir) flashSwipeDirection(dir);
}

// Brief directional slide so a swipe reads as "moved to the next tab" rather
// than the content silently changing under your thumb. Cosmetic only - the class
// is stripped on animationend so a rapid series of swipes can't stack them.
export function flashSwipeDirection(dir) {
  const m = $('#main');
  const cls = dir > 0 ? 'swipe-in-right' : 'swipe-in-left';
  m.classList.remove('swipe-in-right', 'swipe-in-left');
  void m.offsetWidth;   // reflow, so re-adding the same class restarts the animation
  m.classList.add(cls);
  const done = () => { m.classList.remove(cls); m.removeEventListener('animationend', done); };
  m.addEventListener('animationend', done);
}

// True when the gesture began inside something that can itself scroll
// horizontally - the Heatmap's wide table is the real case. That element owns the
// swipe, so stepping tabs on top of it would fight the user's actual intent.
// Gated on scrollWidth too: a table narrow enough to fit doesn't block swiping.
export function insideHorizontalScroller(target, root) {
  for (let n = target; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

// Swipe left/right anywhere in the Stocks content to step through the portfolio
// tabs, so switching doesn't need a reach up to the header. Touch-only on
// purpose: a mouse drag across a page is a text selection, not a swipe.
const SWIPE_MIN_X = 55;        // px of travel before it counts as deliberate
const SWIPE_OFF_AXIS = 0.6;    // |dy| must stay under this fraction of |dx|
const SWIPE_MAX_MS = 700;      // slower than this is a scroll that drifted sideways
function installPortfolioSwipe() {
  const host = $('#main');
  let sx = 0, sy = 0, st = 0, live = false;

  host.addEventListener('touchstart', (e) => {
    // >1 touch is a pinch/zoom; outside Stocks there's no tab strip to step. This
    // re-runs when a second finger lands mid-gesture, which correctly abandons
    // the swipe rather than letting a pinch finish as one.
    live = e.touches.length === 1 && state.appMode === 'stocks'
      && !insideHorizontalScroller(e.target, host);
    if (!live) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  host.addEventListener('touchcancel', () => { live = false; }, { passive: true });

  host.addEventListener('touchend', (e) => {
    if (!live) return;
    live = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - st > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_X) return;
    if (Math.abs(dy) > Math.abs(dx) * SWIPE_OFF_AXIS) return;   // too diagonal to be a clean swipe
    // Swiping left moves forward through the strip - the content travels the
    // same way the thumb does, which is what every tabbed mobile app does.
    const dir = dx < 0 ? 1 : -1;
    const next = PORTFOLIOS[PORTFOLIOS.findIndex((p) => p.id === state.portfolio) + dir];
    // Clamp at both ends rather than wrapping: jumping from the last tab back to
    // the first reads as a glitch, and three tabs are easy enough to tap.
    if (next) selectPortfolio(next.id, dir);
  }, { passive: true });
}

// ---------- chrome (built once, only active state toggles afterward) ----------
function buildChrome() {
  const tabs = $('#portfolioTabs');
  tabs.innerHTML = '';
  PORTFOLIOS.forEach((p) => tabs.appendChild(el('button', {
    class: 'ptab', 'data-id': p.id, text: p.label,
    onclick: () => {
      // On Overview, picking a portfolio also means "leave Overall" - including
      // picking the one already underneath it, which selectPortfolio would
      // otherwise treat as a no-op and leave the tap doing nothing visible.
      if (state.view === 'trends' && _overallView) {
        _overallView = false;
        if (state.portfolio === p.id) { updateChromeActive(); renderTrends(); return; }
      }
      selectPortfolio(p.id);
    },
  })));
  // Only ever shown on the Overview tab. On Holdings or the Heatmap there is no
  // such thing as "all three portfolios at once" - the list, the prices and the
  // currency all belong to one of them.
  tabs.appendChild(el('button', {
    class: 'ptab is-overall hidden', 'data-id': 'overall', text: 'Overall',
    onclick: () => { if (_overallView) return; _overallView = true; updateChromeActive(); renderTrends(); },
  }));
  installPortfolioSwipe();

  const nav = $('#bottomNav');
  nav.innerHTML = '';
  [['holdings', '📈', 'Holdings'], ['heatmap', '🗺️', 'Heatmap'], ['monthly', '🗓️', 'Trend'], ['trends', '📊', 'Overview'], ['feed', '📰', 'Feed']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (state.view === v) return; state.view = v; render(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });

  const sortBar = $('#sortBar');
  sortBar.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.getAttribute('data-field');
      if (state.sortField === f) state.sortStage = (state.sortStage + 1) % 3;
      else { state.sortField = f; state.sortStage = 0; }
      updateSortButtons();
      renderList();
    });
  });
  updateSortButtons();

  const seg = $('#filterSeg');
  seg.innerHTML = '';
  [['holding', 'Holding'], ['sold', 'Sold']].forEach(([v, label]) => {
    seg.appendChild(el('button', {
      'data-filter': v, text: label,
      onclick: () => { if (state.filter === v) return; state.filter = v; updateFiltersActive(); renderList(); },
    }));
  });
}
function updateFiltersActive() {
  $('#filterSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-filter') === state.filter));
}
function updateChromeActive() {
  const onOverview = state.view === 'trends';
  const overall = onOverview && _overallView;
  $('#portfolioTabs').querySelectorAll('.ptab').forEach((x) => {
    const id = x.getAttribute('data-id');
    if (id === 'overall') {
      x.classList.toggle('hidden', !onOverview);
      x.classList.toggle('active', overall);
      return;
    }
    // While Overall is up none of the three is the active one, and saying so is
    // the point: the figures below are not about any single portfolio.
    x.classList.toggle('active', !overall && id === state.portfolio);
  });
  // Overall sits at the far end of a strip that scrolls, so on a narrow screen
  // the active chip can be the one past the edge. Pulled into view rather than
  // left half-cut - the same fix the month strips needed.
  const activeTab = $('#portfolioTabs').querySelector('.ptab.active');
  if (activeTab && !activeTab.classList.contains('hidden')) {
    requestAnimationFrame(() => {
      const strip = $('#portfolioTabs');
      if (!strip.isConnected || strip.scrollWidth <= strip.clientWidth) return;
      const left = activeTab.offsetLeft - (strip.clientWidth - activeTab.offsetWidth) / 2;
      strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    });
  }
  $('#bottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === state.view));
  updateFiltersActive();
}

// ---------- render ----------
function renderSummary() {
  const host = $('#summary');
  const cur = curOf(state.portfolio);
  const s = summarize(state.stocks);
  host.innerHTML = '';
  const labelRow = [
    el('span', { class: 'label', text: 'Current value' }),
  ];
  // Me·US only - a display-only $→₹ switch at the Home strip's cached rate.
  // Nothing is converted in storage; toggling just changes what fmtCur is
  // asked to show across this card, the stock list below it, the Overview
  // tab's per-portfolio card, and Trend.
  if (cur === 'USD') labelRow.push(_usCurToggle());
  labelRow.push(
    s.hasVal
      ? el('span', { class: 'badge ' + (s.pl >= 0 ? 'good' : 'bad'), text: fmtPct(s.plPct) })
      : el('span', { class: 'badge muted', text: 'no prices yet' }),
  );
  host.appendChild(el('div', { class: 'row-between' }, labelRow));
  host.appendChild(el('div', { class: 'big', text: s.hasVal ? _fmtCurUS(s.value, cur) : '-' }));
  const grid = el('div', { class: 'grid' });
  const cells = [
    ['Invested', s.hasVal ? _fmtCurUS(s.invested, cur) : '-', ''],
    ['Profit / Loss', s.hasVal ? (s.pl >= 0 ? '+' : '') + _fmtCurUS(s.pl, cur) : '-', s.hasVal ? pctClass(s.pl) : ''],
    ['Holdings', String(s.holdings) + (s.sold ? '  ·  ' + s.sold + ' sold' : ''), ''],
    ['Up / Down', s.up + ' ▲  /  ' + s.down + ' ▼', ''],
  ];
  cells.forEach(([k, v, cls]) => grid.appendChild(el('div', { class: 'cell' }, [
    el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls || ''), text: v }),
  ])));
  host.appendChild(grid);

  // Render price status below the summary card
  renderPriceStatus();
}

function renderPriceStatus() {
  const statusHost = $('#price-status');
  statusHost.innerHTML = '';
  const ages = state.stocks.filter((x) => x.status !== 'sold').map(priceAgeDays).filter((a) => a != null);
  const age = ages.length ? Math.min.apply(null, ages) : null;
  if (age != null) {
    statusHost.appendChild(el('div', {
      class: 'price-status' + (age >= STALE_PRICE_DAYS ? ' warn' : ''),
      text: age === 0 ? 'Prices updated today' : 'Prices updated ' + age + 'd ago',
    }));
  }
}

// Portfolio Risk Analysis - fully offline. Reads current-portfolio holdings +
// (optionally) cached feed sentiment. Long-term, structural view only: weights,
// diversification, sector exposure, news mood. No timing/intraday signals.
async function renderPortfolioAnalyzer(host, portfolio) {
  // Same exclusion as the Overview sections above it: this analyses equity, and
  // a gold bond is not equity.
  const holdings = state.stocks.filter((s) => s.status !== 'sold' && !isSgb(s));
  if (!holdings.length) return;

  // Cached feed sentiment is optional - analyzer still works without it.
  let feedCache = new Map();
  try {
    const mod = await import('./feed.js');
    feedCache = await mod.getCachedFeed(portfolio);
  } catch (_) { /* feed never used yet - show structural metrics only */ }

  // Allocation by value. Stocks without a price contribute 0 (and are noted).
  const valued = holdings.map((s) => ({ stock: s, value: calc(s).value || 0, entry: feedCache.get(s.id) }));
  const total = valued.reduce((sum, v) => sum + v.value, 0);
  valued.forEach((v) => { v.alloc = total > 0 ? (v.value / total) * 100 : 0; });
  valued.sort((a, b) => b.alloc - a.alloc);

  const bySector = {};
  valued.forEach((v) => {
    const k = v.stock.category || 'Uncategorized';
    if (!bySector[k]) bySector[k] = { value: 0, count: 0 };
    bySector[k].value += v.value;
    bySector[k].count += 1;
  });
  const sectors = Object.entries(bySector).sort((a, b) => b[1].value - a[1].value || b[1].count - a[1].count);
  const health = computePortfolioHealth(holdings, valued, sectors, total);

  const analyzer = el('div', { class: 'chart-card pa-card' }, [el('h3', { text: 'Portfolio Risk Analysis' })]);
  analyzer.appendChild(el('div', { class: 'health-score ' + health.tone }, [
    el('div', { class: 'health-ring' }, [
      el('div', { class: 'health-num', text: String(health.score) }),
      el('div', { class: 'health-den', text: '/100' }),
    ]),
    el('div', { class: 'health-copy' }, [
      el('div', { class: 'health-title', text: health.label }),
      el('div', { class: 'health-detail', text: health.reasons.join(' - ') }),
    ]),
  ]));
  analyzer.appendChild(el('div', { class: 'pa-sub', text: portfolioLabel(portfolio) + ' · ' + holdings.length + ' holdings · long-term view' }));

  // ---- 1. Concentration ----
  const concentrated = valued.filter((v) => v.alloc > 15);
  if (total <= 0) {
    analyzer.appendChild(_paFlag('neutral', 'Allocation unavailable', 'Add current prices to your holdings to see weight-based risk.'));
  } else if (concentrated.length) {
    analyzer.appendChild(_paFlag('bad', '⚠️ Concentration risk',
      concentrated.map((v) => v.stock.name + ' · ' + v.alloc.toFixed(2) + '%').join('   ')));
  } else {
    analyzer.appendChild(_paFlag('good', '✓ Well diversified', 'No single holding exceeds 15% of value.'));
  }

  // ---- 2. Weight distribution (top holdings as bars) ----
  if (total > 0) {
    const top = valued.slice(0, 6);
    const maxAlloc = top[0] ? top[0].alloc : 1;
    const wrap = el('div', { class: 'pa-section' }, [el('div', { class: 'pa-h', text: 'Weight by holding' })]);
    top.forEach((v) => {
      const sent7d = v.entry ? (v.entry.sentiment7d || 0) : null;
      const dot = sent7d == null ? '' : (sent7d > 0.15 ? ' 📈' : sent7d < -0.15 ? ' 📉' : '');
      wrap.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: v.stock.name + dot }),
        el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill' + (v.alloc > 15 ? ' over' : ''), style: 'width:' + (v.alloc / maxAlloc * 100).toFixed(1) + '%' })]),
        el('span', { class: 'bn', text: v.alloc.toFixed(2) + '%' }),
      ]));
    });
    analyzer.appendChild(wrap);
  }

  // ---- 3. Sector exposure ----
  if (sectors.length) {
    const useValue = total > 0;
    const maxSec = sectors[0][1][useValue ? 'value' : 'count'] || 1;
    const wrap = el('div', { class: 'pa-section' }, [el('div', { class: 'pa-h', text: 'Sector exposure' })]);
    sectors.forEach(([name, d]) => {
      const pct = useValue ? (d.value / total * 100) : (d.count / holdings.length * 100);
      const metric = useValue ? d.value / maxSec : d.count / maxSec;
      const over = useValue && pct > 40; // single-sector concentration
      wrap.appendChild(el('div', { class: 'bar-row' }, [
        el('span', { class: 'bl', text: name + ' (' + d.count + ')' }),
        el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill' + (over ? ' over' : ''), style: 'width:' + (metric * 100).toFixed(1) + '%' })]),
        el('span', { class: 'bn', text: pct.toFixed(2) + '%' }),
      ]));
    });
    if (sectors[0] && total > 0 && (sectors[0][1].value / total * 100) > 40) {
      wrap.appendChild(el('div', { class: 'pa-note bad', text: '⚠️ ' + sectors[0][0] + ' is over 40% of value - sector-concentrated.' }));
    }
    analyzer.appendChild(wrap);
  }

  // ---- 4. News sentiment summary (only if feed has data) ----
  const withNews = valued.filter((v) => v.entry && v.entry.items && v.entry.items.length);
  if (withNews.length) {
    let bull = 0, bear = 0, neutral = 0;
    const watch = [];
    withNews.forEach((v) => {
      // Use the same count-based majority vote as the Feed cards so the two
      // views always agree - raw average scores are too low-magnitude to cross
      // the ±0.15 threshold reliably, making everything show as neutral.
      const items = v.entry.items || [];
      let pos = 0, neg = 0;
      for (const it of items) {
        const k = _sentimentFlag(Number(it.sentiment) || 0).key;
        if (k === 'pos') pos++;
        else if (k === 'neg') neg++;
      }
      if (pos > neg) bull++;
      else if (neg > pos) { bear++; watch.push(v); }
      else neutral++;
    });
    const wrap = el('div', { class: 'pa-section' }, [el('div', { class: 'pa-h', text: 'News mood · 7-day (' + withNews.length + ' covered)' })]);
    wrap.appendChild(el('div', { class: 'pa-mood' }, [
      el('div', { class: 'pa-mood-cell good' }, [el('div', { class: 'pa-mood-n', text: String(bull) }), el('div', { class: 'pa-mood-k', text: '📈 Bullish' })]),
      el('div', { class: 'pa-mood-cell' }, [el('div', { class: 'pa-mood-n', text: String(neutral) }), el('div', { class: 'pa-mood-k', text: '→ Neutral' })]),
      el('div', { class: 'pa-mood-cell bad' }, [el('div', { class: 'pa-mood-n', text: String(bear) }), el('div', { class: 'pa-mood-k', text: '📉 Bearish' })]),
    ]));
    // Attention list - bearish-sentiment holdings worth a thesis review.
    if (watch.length) {
      wrap.appendChild(el('div', { class: 'pa-note', text: 'Worth reviewing: ' + watch.map((v) => v.stock.name).join(', ') + '. Open Feed for the news behind this.' }));
    }
    analyzer.appendChild(wrap);
  } else {
    analyzer.appendChild(el('div', { class: 'pa-note', text: 'No news synced yet - open the Feed tab and tap Refresh to add sentiment to this analysis.' }));
  }

  host.appendChild(analyzer);
}

// Small coloured flag row used by the analyzer. tone: 'good' | 'bad' | 'neutral'.
function _paFlag(tone, title, detail) {
  return el('div', { class: 'pa-flag ' + tone }, [
    el('div', { class: 'pa-flag-t', text: title }),
    el('div', { class: 'pa-flag-d', text: detail }),
  ]);
}

function computePortfolioHealth(holdings, valued, sectors, total) {
  const count = holdings.length || 1;
  const unpriced = holdings.filter((s) => !(Number(s.currentPrice) > 0)).length;
  const stale = holdings.filter(isPriceStale).length;
  const maxAlloc = total > 0 && valued[0] ? valued[0].alloc : 0;
  const maxSectorPct = total > 0 && sectors[0] ? (sectors[0][1].value / total) * 100 : 0;
  const avoid = holdings.filter((s) => s.conviction === 'down').length;

  let score = 100;
  if (total <= 0) score -= 30;
  score -= Math.round((unpriced / count) * 20);
  score -= Math.round((stale / count) * 20);
  if (maxAlloc > 30) score -= 22;
  else if (maxAlloc > 20) score -= 14;
  else if (maxAlloc > 15) score -= 8;
  if (maxSectorPct > 55) score -= 16;
  else if (maxSectorPct > 40) score -= 10;
  score -= Math.min(10, avoid * 3);
  score = Math.max(0, Math.min(100, score));

  const reasons = [];
  reasons.push(unpriced ? unpriced + ' without price' : 'prices covered');
  reasons.push(stale ? stale + ' stale price' + (stale > 1 ? 's' : '') : 'prices fresh');
  if (maxAlloc > 15) reasons.push('top holding ' + maxAlloc.toFixed(2) + '%');
  else reasons.push('weight balanced');
  if (maxSectorPct > 40) reasons.push('sector ' + maxSectorPct.toFixed(2) + '%');
  else reasons.push('sector spread ok');

  const tone = score >= 80 ? 'good' : score >= 60 ? 'neutral' : 'bad';
  const label = score >= 80 ? 'Strong portfolio health'
    : score >= 60 ? 'Balanced, watch a few items'
      : 'Needs review';
  return { score, tone, label, reasons };
}

function portfolioLabel(id) {
  const p = PORTFOLIOS.find((x) => x.id === id);
  return p ? p.label : id;
}

// Sortable return figures for a stock. Holdings use price-based P/L (or latest
// tracked %); sold stocks use current-vs-sold move. Missing values sort last.
function metricOf(s) {
  const c = calc(s);
  if (s.status === 'sold') return { pct: c.known ? c.movedPct : null, money: null };
  return { pct: displayPct(s, c), money: c.priced ? c.pl : null };
}
// Tri-state sort: stage 0 = default name A-Z; for the active field, stage 1 and 2
// are its two directions (name A-Z/Z-A; return & value high-first/low-first).
function sortStocks(list) {
  const f = state.sortField, st = state.sortStage;
  const soldRank = (s) => (s.status === 'sold' ? 1 : 0); // holdings (0) before sold (1)
  return list.sort((a, b) => {
    const r0 = soldRank(a) - soldRank(b);
    if (r0 !== 0) return r0;
    if (st === 0) return (a.name || '').localeCompare(b.name || '');
    if (f === 'name') { const r = (a.name || '').localeCompare(b.name || ''); return st === 1 ? r : -r; }
    const key = f === 'value' ? 'money' : 'pct';
    const av = metricOf(a)[key], bv = metricOf(b)[key];
    if (av == null && bv == null) return (a.name || '').localeCompare(b.name || '');
    if (av == null) return 1;
    if (bv == null) return -1;
    return st === 1 ? (bv - av) : (av - bv);
  });
}

const SORT_LABELS = { name: 'Name', pct: 'Return %', value: 'Value' };
function updateSortButtons() {
  $('#sortBar').querySelectorAll('.sort-btn').forEach((btn) => {
    const f = btn.getAttribute('data-field');
    const active = f === state.sortField && state.sortStage > 0;
    btn.classList.toggle('active', active);
    let arrow = '';
    if (active) {
      const asc = f === 'name' ? state.sortStage === 1 : state.sortStage === 2;
      arrow = asc ? ' ↑' : ' ↓';
    }
    btn.textContent = SORT_LABELS[f] + arrow;
  });
}

function visibleStocks() {
  const q = state.search.trim().toLowerCase();
  const filtered = state.stocks.filter((s) => {
    if (state.filter === 'holding' && s.status === 'sold') return false;
    if (state.filter === 'sold' && s.status !== 'sold') return false;
    if (q && !((s.name || '') + ' ' + (s.category || '')).toLowerCase().includes(q)) return false;
    return true;
  });
  return sortStocks(filtered);
}

function stockCard(s) {
  const cur = curOf(state.portfolio);
  const c = calc(s);

  const nameEl = el('div', { class: 'name' }, [s.name || '(unnamed)']);
  if (s.conviction) nameEl.appendChild(el('span', { class: 'conv', text: '  ' + convIcon(s.conviction) }));
  if (s.category) nameEl.appendChild(el('span', { class: 'cat-badge', text: s.category }));

  const left = el('div', { class: 'card-left' }, [nameEl]);
  const right = el('div', { class: 'card-right' });

  if (s.status === 'sold') {
    const cls = c.goodSell == null ? 'muted' : c.goodSell ? 'good' : 'bad';
    const text = c.goodSell == null ? 'Sold' : c.goodSell ? 'Good exit' : 'Sold early';
    right.appendChild(el('span', { class: 'badge ' + cls, text }));

    // Four independent cases, not nested ternaries - a partially-filled sold
    // stock used to render "Sold 0 @ ₹0", which reads like real data.
    const hasSp = Number(s.soldPrice) > 0;
    if (hasSp && c.soldQty) left.appendChild(el('div', { class: 'meta-line' }, ['Sold ', b(String(c.soldQty)), ' @ ', b(_fmtCurUS(s.soldPrice, cur))]));
    else if (hasSp) left.appendChild(el('div', { class: 'meta-line' }, ['Sold @ ', b(_fmtCurUS(s.soldPrice, cur))]));
    else if (c.soldQty) left.appendChild(el('div', { class: 'meta-line' }, ['Sold ', b(String(c.soldQty)), ' units']));

    if (c.known) left.appendChild(el('div', { class: 'meta-line ' + (c.goodSell ? 'pos' : 'neg') }, ['Now ', b(_fmtCurUS(s.currentPrice, cur)), ' (' + fmtPct(c.movedPct) + ')']));
    else left.appendChild(el('div', { class: 'meta-line flat', text: hasSp ? 'Set current price to judge' : 'Add sold price to compare' }));

    // Booked and If held are both P/L against the avg buy price - without one
    // (every CSV-imported sell, or a stock with no units recorded), neither is
    // knowable, so none of the three render.
    if (c.realised != null) {
      const r = Math.round(c.realised);
      right.appendChild(kv('Booked', el('span', { class: 'kv-val ' + (r > 0 ? 'pos' : r < 0 ? 'neg' : ''), text: (r > 0 ? '+' : '') + _fmtCurUS(r, cur) })));
    }
    if (c.ifHeldPl != null) {
      const p = Math.round(c.ifHeldPl);
      right.appendChild(kv('If held', el('span', { class: 'kv-val ' + (p > 0 ? 'pos' : p < 0 ? 'neg' : ''), text: (p > 0 ? '+' : '') + _fmtCurUS(p, cur) })));
    }
    // Booked minus If held, matching the card's top-to-bottom order. Positive
    // shown green, negative shown red.
    if (c.gap != null && Math.round(c.gap) !== 0) {
      const g = Math.round(c.gap);
      right.appendChild(kv('vs. exit', el('span', { class: 'kv-val ' + (g > 0 ? 'pos' : 'neg'), text: (g >= 0 ? '+' : '') + _fmtCurUS(g, cur) })));
    }
  } else {
    const dpct = displayPct(s, c);
    right.appendChild(el('div', { class: 'pct ' + (dpct != null ? pctClass(dpct) : 'flat'), text: dpct != null ? fmtPct(dpct) : '-' }));
    if (c.priced) {
      left.appendChild(el('div', { class: 'meta-line' }, [b(String(Number(s.units) || 0)), ' @ ' + _fmtCurUS(s.buyPrice, cur)]));
      // Per-stock "price updated" indicator was removed - the last-updated time is
      // now shown once per portfolio on the Overview tab's Portfolios card.
      left.appendChild(el('div', { class: 'meta-line' }, ['Current price ', b(_fmtCurUS(s.currentPrice, cur))]));
      right.appendChild(kv('Overall return', el('span', { class: 'kv-val ' + (c.pl >= 0 ? 'pos' : 'neg'), text: (c.pl >= 0 ? '+' : '') + _fmtCurUS(c.pl, cur) })));
      right.appendChild(kv('Current value', el('span', { class: 'kv-val', text: _fmtCurUS(c.value, cur) })));
    } else {
      const lh = latestHist(s);
      if (lh) left.appendChild(el('div', { class: 'meta-line' }, [b(String(s.history.length)), ' months · latest ', b(lh.month)]));
      else if (Number(s.units)) left.appendChild(el('div', { class: 'meta-line' }, [b(String(Number(s.units))), ' @ ' + _fmtCurUS(s.buyPrice, cur), ' · set price']));
      else left.appendChild(el('div', { class: 'meta-line flat', text: 'Tap to add prices' }));
    }
    // "Started (year)" from the form — also what the Dividends form uses to
    // reach years further back than one with existing dividend data.
    if (s.startYear) {
      const yrs = Math.max(1, new Date().getFullYear() - Number(s.startYear) + 1);
      left.appendChild(el('div', { class: 'meta-line since-year' }, [
        'Since ', b(String(s.startYear)), ' · ' + yrs + (yrs === 1 ? ' yr' : ' yrs'),
      ]));
    }
  }

  return el('div', { class: 'card', onclick: () => openStockForm(s) }, [el('div', { class: 'top' }, [left, right])]);
}

function renderList() {
  const host = $('#stockList');
  const frag = document.createDocumentFragment();
  if (!state.stocks.length) {
    frag.appendChild(el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: '📝' }),
      el('p', { text: 'No stocks yet in this portfolio.' }),
      el('p', { class: 'hint', text: 'Tap + to add your first one.' }),
    ]));
  } else {
    const list = visibleStocks();
    if (!list.length) frag.appendChild(el('div', { class: 'empty' }, [el('p', { text: 'Nothing matches this filter.' })]));
    else list.forEach((s) => frag.appendChild(stockCard(s)));
  }
  host.innerHTML = '';
  host.appendChild(frag);
}

function sparkline(values, w, h, emptyMsg) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', h);
  if (values.length < 2) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', w / 2); t.setAttribute('y', h / 2);
    t.setAttribute('fill', '#9fb0d4'); t.setAttribute('font-size', '12'); t.setAttribute('text-anchor', 'middle');
    t.textContent = emptyMsg || 'Not enough data to chart';
    svg.appendChild(t);
    return svg;
  }
  const min = Math.min.apply(null, values);
  const max = Math.max.apply(null, values);
  const pad = 8;
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => (pad + i * stepX).toFixed(1) + ',' + (h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1));
  const poly = document.createElementNS(ns, 'polyline');
  poly.setAttribute('points', pts.join(' '));
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', '#38bdf8');
  poly.setAttribute('stroke-width', '2.5');
  poly.setAttribute('stroke-linecap', 'round');
  poly.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(poly);
  return svg;
}

// Multiple lines sharing one scale (used to overlay Nifty on a stock). Each series
// is { values: (number|null)[], color, dash? }; nulls break the line into segments.
function multiSparkline(series, w, h, emptyMsg) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', h);
  const all = [];
  let maxLen = 0;
  series.forEach((s) => { maxLen = Math.max(maxLen, s.values.length); s.values.forEach((v) => { if (v != null && !isNaN(v)) all.push(v); }); });
  if (all.length < 2) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', w / 2); t.setAttribute('y', h / 2);
    t.setAttribute('fill', '#9fb0d4'); t.setAttribute('font-size', '12'); t.setAttribute('text-anchor', 'middle');
    t.textContent = emptyMsg || 'Not enough data to chart';
    svg.appendChild(t);
    return svg;
  }
  const min = Math.min.apply(null, all), max = Math.max.apply(null, all);
  const pad = 8, span = (max - min) || 1;
  const xAt = (i) => pad + (maxLen > 1 ? (i * (w - 2 * pad)) / (maxLen - 1) : (w - 2 * pad) / 2);
  const yAt = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
  series.forEach((s) => {
    let seg = [];
    const flush = () => {
      if (seg.length >= 2) {
        const poly = document.createElementNS(ns, 'polyline');
        poly.setAttribute('points', seg.join(' '));
        poly.setAttribute('fill', 'none');
        poly.setAttribute('stroke', s.color);
        poly.setAttribute('stroke-width', '2.5');
        poly.setAttribute('stroke-linecap', 'round');
        poly.setAttribute('stroke-linejoin', 'round');
        if (s.dash) poly.setAttribute('stroke-dasharray', s.dash);
        svg.appendChild(poly);
      }
      seg = [];
    };
    s.values.forEach((v, i) => { if (v == null || isNaN(v)) flush(); else seg.push(xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1)); });
    flush();
  });
  return svg;
}

// Value-by-month line with a dot per month; each dot has a native tooltip
// (hover on desktop / tap on mobile) showing that month's value and return.
function monthlyValueChart(months, cur, bname) {
  const ns = 'http://www.w3.org/2000/svg';
  const w = 320, h = 150, pad = 12;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('width', '100%'); svg.setAttribute('height', h);
  const info = el('div', { class: 'chart-info', text: months.length < 2 ? '' : 'Tap a dot for that month\'s details' });
  const setInfo = (text, color) => { info.textContent = text; info.style.color = color || ''; };
  if (months.length < 2) {
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', w / 2); t.setAttribute('y', h / 2); t.setAttribute('fill', '#9fb0d4');
    t.setAttribute('font-size', '12'); t.setAttribute('text-anchor', 'middle');
    t.textContent = 'Add at least 2 months to see a trend';
    svg.appendChild(t);
    return el('div', {}, [svg, info]);
  }
  const xAt = (i) => pad + (i * (w - pad * 2)) / (months.length - 1);
  // Each series is normalised to its own min/max (different units), so shapes are
  // comparable; the real numbers live in each dot's hover/tap tooltip.
  const drawSeries = (series, lineColor, dash, dotColor, tip) => {
    const nums = series.filter((v) => v != null && !isNaN(v));
    if (!nums.length) return;
    const min = Math.min.apply(null, nums), max = Math.max.apply(null, nums), span = (max - min) || 1;
    const yAt = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
    let seg = [];
    const flush = () => {
      if (seg.length >= 2) {
        const poly = document.createElementNS(ns, 'polyline');
        poly.setAttribute('points', seg.join(' '));
        poly.setAttribute('fill', 'none'); poly.setAttribute('stroke', lineColor); poly.setAttribute('stroke-width', '2');
        poly.setAttribute('stroke-linejoin', 'round'); poly.setAttribute('stroke-linecap', 'round');
        if (dash) poly.setAttribute('stroke-dasharray', dash);
        svg.appendChild(poly);
      }
      seg = [];
    };
    series.forEach((v, i) => { if (v == null || isNaN(v)) flush(); else seg.push(xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1)); });
    flush();
    series.forEach((v, i) => {
      if (v == null || isNaN(v)) return;
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', xAt(i).toFixed(1)); dot.setAttribute('cy', yAt(v).toFixed(1)); dot.setAttribute('r', '4.5');
      dot.setAttribute('fill', dotColor(i));
      dot.style.cursor = 'pointer';
      const tipText = tip(i), tipColor = dotColor(i);
      const title = document.createElementNS(ns, 'title'); title.textContent = tipText; dot.appendChild(title); // desktop hover
      dot.addEventListener('click', () => setInfo(tipText, tipColor)); // works on mobile tap too
      svg.appendChild(dot);
    });
  };
  // benchmark first (behind), portfolio value on top
  const bvals = months.map((m) => (m.nifty != null ? Number(m.nifty) : null));
  if (bvals.some((v) => v != null)) {
    drawSeries(bvals, '#fbbf24', '4 3', () => '#fbbf24', (i) => ymToLabel(months[i].ym) + ': ' + bname + ' ' + months[i].nifty);
  }
  const vals = months.map((m) => (m.value != null ? Number(m.value) : null));
  drawSeries(vals, '#38bdf8', null,
    (i) => (months[i].returnPct != null && months[i].returnPct < 0 ? '#f87171' : '#34d399'),
    (i) => ymToLabel(months[i].ym) + ': ' + _fmtCurUS(months[i].value, cur) + (months[i].returnPct != null ? '  (' + fmtPct(months[i].returnPct) + ')' : ''));
  return el('div', {}, [svg, info]);
}

// Overview tab: all-portfolios summary + allocation by category (cross-portfolio).
async function renderTrends() {
  const host = $('#trendView');
  host.innerHTML = '';
  updateChromeActive();

  // Overall answers "how do all three look together"; a portfolio chip answers
  // "how does this one look". The three cards below were always computed across
  // every portfolio, so sitting under a chip row that named ONE of them made
  // them read as that portfolio's figures. They belong under Overall, and the
  // per-portfolio analysis belongs under its own chip.
  if (!_overallView) {
    await renderPortfolioAnalyzer(host, state.portfolio);
    if (!host.childElementCount) {
      host.appendChild(el('div', { class: 'empty' }, [
        el('p', { text: 'Nothing to analyse in this portfolio yet.' }),
        el('p', { class: 'hint', text: 'Add holdings, or tap Overall for the picture across all three.' }),
      ]));
    }
    return;
  }

  let allStocks = [], allMonthly = [];
  try { [allStocks, allMonthly] = await Promise.all([DB.all('stocks'), DB.all('monthly')]); } catch (e) { return; }

  // latest monthly record per portfolio = its real ₹/$ totals
  const latest = {};
  allMonthly.forEach((m) => { if (!latest[m.portfolio] || (m.ym || '') > (latest[m.portfolio].ym || '')) latest[m.portfolio] = m; });

  const pcard = el('div', { class: 'chart-card' }, [el('h3', { text: 'Portfolios' })]);
  const grid = el('div', { class: 'stats' });
  PORTFOLIOS.forEach((p) => {
    const lm = latest[p.id];
    const valTxt = lm && lm.value != null ? _fmtCurUS(lm.value, p.cur) : '-';
    grid.appendChild(el('div', { class: 'stat' }, [
      el('div', { class: ('stat-v ' + _statSizeClass(valTxt)).trim(), text: valTxt }),
      el('div', { class: 'stat-k', text: p.label }),
      el('div', { class: 'stat-k ' + (lm && lm.returnPct != null ? pctClass(lm.returnPct) : ''), text: lm ? (lm.returnPct != null ? fmtPct(lm.returnPct) : ' ') : 'No data' }),
    ]));
  });
  pcard.appendChild(grid);
  const inInv = ['me-in', 'wife-in'].reduce((s, id) => s + ((latest[id] && latest[id].invested) || 0), 0);
  const inVal = ['me-in', 'wife-in'].reduce((s, id) => s + ((latest[id] && latest[id].value) || 0), 0);
  if (inInv || inVal) {
    const pl = inVal - inInv;
    pcard.appendChild(el('div', { class: 'insight-card', style: 'margin-top:10px' }, [
      el('div', { class: 'ic-k', text: 'India combined (you + wife)' }),
      el('div', { class: 'ic-v' }, ['Invested ', b(fmtCur(inInv, 'INR')), '  ·  Value ', b(fmtCur(inVal, 'INR')), '  ·  ', el('span', { class: pctClass(pl) }, [b((pl >= 0 ? '+' : '') + fmtCur(pl, 'INR'))])]),
    ]));
  }
  host.appendChild(pcard);

  // SGBs are excluded here: they sit in this store but they are gold, counted
  // under Metals, and one of them in an equity allocation chart makes that
  // chart wrong about the thing it is drawing.
  const sgbCount = allStocks.filter((s) => s.status !== 'sold' && isSgb(s)).length;
  const holdings = allStocks.filter((s) => s.status !== 'sold' && !isSgb(s));
  if (!holdings.length) {
    host.appendChild(el('div', { class: 'empty' }, [el('p', { text: 'Add holdings to see allocation.' })]));
    return;
  }
  const byCat = {};
  holdings.forEach((s) => { const k = s.category || 'Uncategorized'; byCat[k] = (byCat[k] || 0) + 1; });
  const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const maxC = byCat[cats[0]] || 1;
  const acard = el('div', { class: 'chart-card' }, [el('h3', { text: 'Allocation by category · ' + holdings.length + ' holdings' })]);
  // Said out loud rather than left as a silent difference between this count
  // and the one on the Holdings tab.
  if (sgbCount) {
    acard.appendChild(el('p', { class: 'hint', style: 'margin:-4px 0 8px',
      text: sgbCount + ' SGB' + (sgbCount === 1 ? '' : 's') + ' left out — counted under Metals, as gold.' }));
  }
  cats.forEach((cat) => {
    const cnt = byCat[cat];
    acard.appendChild(el('div', { class: 'bar-row' }, [
      el('span', { class: 'bl', text: cat }),
      el('div', { class: 'bar-track' }, [el('div', { class: 'bar-fill', style: 'width:' + (cnt / maxC * 100).toFixed(1) + '%' })]),
      el('span', { class: 'bn', text: String(cnt) }),
    ]));
  });
  host.appendChild(acard);

  const conv = { up: 0, watch: 0, down: 0 };
  holdings.forEach((s) => { if (conv[s.conviction] != null) conv[s.conviction]++; });
  host.appendChild(el('div', { class: 'chart-card' }, [
    el('h3', { text: 'Conviction' }),
    el('div', { class: 'insight-cards' }, [
      el('div', { class: 'insight-card' }, [el('div', { class: 'ic-k', text: 'Conviction 👍' }), el('div', { class: 'ic-v', text: String(conv.up) })]),
      el('div', { class: 'insight-card' }, [el('div', { class: 'ic-k', text: 'Watch ✋' }), el('div', { class: 'ic-v', text: String(conv.watch) })]),
      el('div', { class: 'insight-card' }, [el('div', { class: 'ic-k', text: 'Avoid 👎' }), el('div', { class: 'ic-v', text: String(conv.down) })]),
    ]),
  ]));

  // No analyzer here: it reads one portfolio's holdings, and this branch is
  // explicitly the view that is not about one. It sits under its own chip.
  host.appendChild(el('p', { class: 'hint mf-foot', text: 'Across every portfolio. '
    + 'Tap a portfolio above for its own risk analysis.' }));
}


// ---------- monthly tab ----------
const mCell = (k, v) => el('div', { class: 'cell' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v })]);

function renderMonthly() {
  const host = $('#monthlyView');
  const cur = curOf(state.portfolio);
  const bname = benchmarkName(state.portfolio);
  const months = state.months; // ascending by ym
  host.innerHTML = '';

  const head = el('div', { class: 'chart-card' }, [
    el('div', { class: 'row-between' }, [
      el('h3', { text: 'Monthly tracking' }),
      el('button', { class: 'btn primary small', text: 'Capture this month', onclick: captureMonth }),
    ]),
    el('p', { class: 'note', text: 'Note: Capture stores this month\'s totals from your current holdings. Re-saving the same month overwrites it (no duplicate history).' }),
  ]);
  if (isMonthEndReminderWindow() && missingCurrentMonthCapture(months)) {
    head.appendChild(el('div', { class: 'snapshot-reminder' }, [
      el('div', {}, [
        el('div', { class: 'snapshot-reminder-t', text: ymToLabel(thisYm()) + ' snapshot is not captured yet' }),
        el('div', { class: 'snapshot-reminder-d', text: 'Month end is near. Capture after your prices are updated.' }),
      ]),
      el('button', { class: 'btn primary small', text: 'Capture now', onclick: captureMonth }),
    ]));
  }
  if (!months.length) {
    host.appendChild(head);
  } else {
    let adds = 0, n = 0;
    const moms = []; // month-over-month change in cumulative gain (or value)
    for (let i = 1; i < months.length; i++) {
      const a = num(months[i].invested), p = num(months[i - 1].invested);
      if (a != null && p != null) { adds += a - p; n++; }
      // Simple definition: MoM = this month's value minus last month's value.
      const cv = months[i].value, pv = months[i - 1].value;
      const mom = (cv != null && pv != null) ? cv - pv : null;
      if (mom != null) moms.push({ ym: months[i].ym, mom });
    }
    const last = months[months.length - 1];
    let best = null, worst = null, wins = 0;
    moms.forEach((x) => { if (!best || x.mom > best.mom) best = x; if (!worst || x.mom < worst.mom) worst = x; if (x.mom > 0) wins++; });
    const winRate = moms.length ? Math.round((wins / moms.length) * 100) : null;

    const stat = (label, value, cls) => {
      const sizeCls = _statSizeClass(value);
      return el('div', { class: 'stat' }, [
        el('div', { class: ('stat-v ' + sizeCls + ' ' + (cls || '')).trim().replace(/\s+/g, ' '), text: value }),
        el('div', { class: 'stat-k', text: label }),
      ]);
    };
    head.appendChild(el('div', { class: 'stats' }, [
      stat('Months', String(months.length)),
      stat('Avg invested / mo', n ? _fmtCurUS(adds / n, cur) : '-'),
      stat('Invested', last.invested != null ? _fmtCurUS(last.invested, cur) : '-'),
      stat('Value', last.value != null ? _fmtCurUS(last.value, cur) : '-'),
      stat('Total return', last.profitLoss != null ? (last.profitLoss >= 0 ? '+' : '') + _fmtCurUS(last.profitLoss, cur) : '-', last.profitLoss != null ? pctClass(last.profitLoss) : ''),
      stat('Overall %', last.returnPct != null ? fmtPct(last.returnPct) : '-', last.returnPct != null ? pctClass(last.returnPct) : ''),
    ]));
    host.appendChild(head);

    host.appendChild(el('div', { class: 'chart-card' }, [
      el('h3', { text: 'Value by month' }),
      monthlyValueChart(months, cur, bname),
      el('div', { class: 'hint' }, [
        el('span', { style: 'color:#38bdf8', text: '- Value' }),
        months.some((m) => m.nifty != null) ? el('span', { style: 'color:#fbbf24', text: '   - ' + bname }) : document.createTextNode(''),
      ]),
      el('p', { class: 'note', text: 'Hover or tap a dot to see that month\'s value and return.' }),
    ]));

    // ---- insights ----
    const insights = [];
    if (best) insights.push(['Best month', ymToLabel(best.ym) + '  ' + (best.mom >= 0 ? '+' : '') + _fmtCurUS(best.mom, cur)]);
    if (worst) insights.push(['Toughest month', ymToLabel(worst.ym) + '  ' + (worst.mom >= 0 ? '+' : '') + _fmtCurUS(worst.mom, cur)]);
    if (winRate != null) insights.push(['Win rate', winRate + '% of months gained (' + wins + ' of ' + moms.length + ')']);
    if (moms.length) {
      const lm = moms[moms.length - 1];
      insights.push(['Latest month', ymToLabel(lm.ym) + '  ' + (lm.mom >= 0 ? '+' : '') + _fmtCurUS(lm.mom, cur) + ' vs prior']);
    }
    const peak = Math.max.apply(null, months.map((m) => Number(m.value) || 0));
    if (peak > 0 && last.value != null) {
      const dd = ((last.value - peak) / peak) * 100;
      insights.push(['Drawdown', dd >= -0.05 ? 'At / near peak value' : Math.abs(dd).toFixed(1) + '% below peak (' + _fmtCurUS(peak, cur) + ')']);
    }
    if (last.invested && last.value != null) {
      insights.push(['Money multiple', (last.value / last.invested).toFixed(2) + 'x of invested']);
    }
    const nm = months.filter((m) => m.nifty != null);
    if (nm.length >= 2 && last.returnPct != null) {
      const bpct = (nm[nm.length - 1].nifty / nm[0].nifty - 1) * 100;
      insights.push(['Vs ' + bname, 'You ' + fmtPct(last.returnPct) + ' vs ' + bname + ' ' + fmtPct(bpct) + ' over this span']);
    }
    if (insights.length) {
      const ins = el('div', { class: 'insight-cards' });
      insights.forEach(([k, v]) => ins.appendChild(el('div', { class: 'insight-card' }, [el('div', { class: 'ic-k', text: k }), el('div', { class: 'ic-v', text: v })])));
      host.appendChild(el('div', { class: 'chart-card' }, [el('h3', { text: 'Insights' }), ins]));
    }
  }

  const list = el('div', { class: 'snap-list' }, [
    el('div', { class: 'row-between' }, [
      el('h3', { text: 'Months' }),
      el('button', { class: 'btn ghost small', text: '+ Add month', onclick: () => openMonthForm(null) }),
    ]),
  ]);
  if (!months.length) {
    list.appendChild(el('p', { class: 'hint', text: 'No monthly data yet. Tap "Capture this month", add one manually, or import your sheet (menu) to back-fill history.' }));
  } else {
    months.map((m, i) => ({ m, prev: i > 0 ? months[i - 1] : null })).reverse().forEach(({ m, prev }) => {
      const mom = (m.value != null && prev && prev.value != null) ? m.value - prev.value : null;
      const top = el('div', { class: 'top' }, [
        el('div', { class: 'name', text: ymToLabel(m.ym) }),
        el('div', { class: 'pct ' + (m.returnPct != null ? pctClass(m.returnPct) : 'flat'), text: m.returnPct != null ? fmtPct(m.returnPct) : '-' }),
      ]);
      const momTip = 'MoM = this month\'s value minus last month\'s value.';
      // Value − invested for THIS month's snapshot (stored on capture/edit, not
      // recomputed here) — a small badge right next to Value so the return for
      // that single month reads at a glance, without eyeballing the diff between
      // two separate numbers.
      const gainBadge = m.profitLoss != null
        ? el('span', {
            class: 'badge ' + (m.profitLoss >= 0 ? 'good' : 'bad'),
            style: 'margin-left:6px; vertical-align:middle',
            title: 'This month\'s value minus invested',
            text: (m.profitLoss >= 0 ? '+' : '') + _fmtCurUS(m.profitLoss, cur),
          })
        : document.createTextNode('');
      const sub = el('div', { class: 'sub' }, [
        el('span', {}, ['Value ', b(m.value != null ? _fmtCurUS(m.value, cur) : '-'), gainBadge]),
        mom != null
          ? el('span', { class: pctClass(mom), title: momTip }, ['MoM ', b((mom >= 0 ? '+' : '') + _fmtCurUS(mom, cur))])
          : el('span', { class: 'flat', title: momTip, text: 'MoM -' }),
      ]);
      const line3 = el('div', { class: 'meta-line' }, [
        'Invested ' + (m.invested != null ? _fmtCurUS(m.invested, cur) : '-')
        + '  ·  ▲' + (m.countProfit != null ? m.countProfit : '-') + ' ▼' + (m.countLoss != null ? m.countLoss : '-')
        + (m.nifty != null ? '  ·  ' + bname + ' ' + m.nifty : ''),
      ]);
      list.appendChild(el('div', { class: 'card', onclick: () => openMonthForm(m) }, [top, sub, line3]));
    });
  }
  host.appendChild(list);
}

async function captureMonth() {
  const s = summarize(state.stocks);
  const ym = thisYm();
  const existing = state.months.find((x) => x.ym === ym);
  const rec = {
    key: monthKey(state.portfolio, ym),
    portfolio: state.portfolio,
    ym,
    invested: s.hasVal ? s.invested : null,
    value: s.hasVal ? s.value : null,
    profitLoss: s.hasVal ? s.pl : null,
    returnPct: s.hasVal ? Math.round(s.plPct * 100) / 100 : null,
    countProfit: s.up,
    countLoss: s.down,
    nifty: existing ? existing.nifty : null,
    source: 'capture',
    updatedAt: new Date().toISOString(),
  };
  await syncNifty(rec);
  await DB.put('monthly', rec);
  toast('Saved ' + ymToLabel(ym));
  refresh();
}

// Nifty 50 is one market value - propagate it across the portfolios that share
// that benchmark. me-in <-> wife-in share Nifty; me-us (Nasdaq) is alone.
async function syncNifty(rec) {
  if (rec.portfolio !== 'me-in' && rec.portfolio !== 'wife-in') return;
  const peer = rec.portfolio === 'me-in' ? 'wife-in' : 'me-in';
  const peerRec = await DB.get('monthly', monthKey(peer, rec.ym));
  if (rec.nifty == null && peerRec && peerRec.nifty != null) {
    rec.nifty = peerRec.nifty; // fill missing from peer
  } else if (rec.nifty != null && peerRec && peerRec.nifty !== rec.nifty) {
    peerRec.nifty = rec.nifty; // push to existing peer (no new empty months created)
    peerRec.updatedAt = new Date().toISOString();
    await DB.put('monthly', peerRec);
  }
}

async function syncNiftyAll() {
  const [me, wife] = await Promise.all([DB.byPortfolio('monthly', 'me-in'), DB.byPortfolio('monthly', 'wife-in')]);
  const meBy = {}, wifeBy = {};
  me.forEach((m) => { meBy[m.ym] = m; });
  wife.forEach((m) => { wifeBy[m.ym] = m; });
  const writes = [];
  me.forEach((m) => { if (m.nifty == null && wifeBy[m.ym] && wifeBy[m.ym].nifty != null) { m.nifty = wifeBy[m.ym].nifty; writes.push(DB.put('monthly', m)); } });
  wife.forEach((m) => { if (m.nifty == null && meBy[m.ym] && meBy[m.ym].nifty != null) { m.nifty = meBy[m.ym].nifty; writes.push(DB.put('monthly', m)); } });
  await Promise.all(writes);
}

function openMonthForm(existing) {
  const isEdit = !!existing;
  const m = existing || {};
  const monthInput = el('input', { type: 'month', value: m.ym || thisYm() });
  const invested = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.invested != null ? m.invested : '', placeholder: '0' });
  const value = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.value != null ? m.value : '', placeholder: '0' });
  const nifty = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.nifty != null ? m.nifty : '', placeholder: benchmarkName(state.portfolio) + ' level' });
  const cp = el('input', { type: 'number', inputmode: 'numeric', step: '1', value: m.countProfit != null ? m.countProfit : '', placeholder: '0' });
  const cl = el('input', { type: 'number', inputmode: 'numeric', step: '1', value: m.countLoss != null ? m.countLoss : '', placeholder: '0' });

  const save = async () => {
    const ym = monthInput.value;
    if (!ym) { toast('Pick a month'); return; }
    const inv = num(invested.value), val = num(value.value);
    const rec = {
      key: monthKey(state.portfolio, ym),
      portfolio: state.portfolio,
      ym,
      invested: inv,
      value: val,
      profitLoss: (inv != null && val != null) ? val - inv : null,
      returnPct: (inv && val != null) ? Math.round(((val - inv) / inv) * 10000) / 100 : null,
      countProfit: num(cp.value),
      countLoss: num(cl.value),
      nifty: num(nifty.value),
      source: m.source || 'manual',
      updatedAt: new Date().toISOString(),
    };
    if (isEdit && existing.ym !== ym) await DB.del('monthly', existing.key); // month changed -> drop old key
    await syncNifty(rec);
    await DB.put('monthly', rec);
    closeModal();
    toast('Saved ' + ymToLabel(ym));
    refresh();
  };
  const del = async () => {
    if (!(await appConfirm('Delete ' + ymToLabel(existing.ym) + '?'))) return;
    await DB.del('monthly', existing.key);
    closeModal();
    toast('Deleted');
    refresh();
  };

  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: isEdit ? 'Edit month' : 'Add month' }),
    field('Month', monthInput),
    el('div', { class: 'field-row' }, [field('Invested', invested), field('Current value', value)]),
    field(benchmarkName(state.portfolio), nifty),
    el('div', { class: 'field-row' }, [field('# in profit', cp), field('# in loss', cl)]),
    el('p', { class: 'hint', text: 'Profit/Loss and return % are derived from Invested and Current value.' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
    ]),
    isEdit ? el('div', { class: 'btn-row' }, [el('button', { class: 'btn danger', text: 'Delete this month', onclick: del })]) : document.createTextNode(''),
  ]));
}

async function render() {
  // Stocks app only. Home/MF surfaces are drawn by setAppMode/renderMF, and this
  // function is only ever reached via the stock nav/portfolio tabs anyway - the
  // guard keeps a stray call from un-hiding stock sections over the home screen.
  if (state.appMode !== 'stocks') return;
  updateChromeActive();
  // Refreshed on every render rather than cached across renders - it's a
  // local IndexedDB read (no network), and Overview shows Me·US regardless
  // of which portfolio tab is currently selected, so this can't be gated on
  // state.portfolio being 'me-us'.
  if (_usShowInr) {
    const row = await DB.get('meta', 'homeLiveRates').catch(() => null);
    _cachedUsdInr = row && row.value && row.value.usdInr ? Number(row.value.usdInr) : null;
    // The user may have left Stocks while that read was in flight - drawing now
    // would un-hide stock sections on top of whatever screen they moved to.
    if (state.appMode !== 'stocks') return;
  }
  const v = state.view;
  const holdings = v === 'holdings';
  $('#summary').classList.toggle('hidden', !holdings);
  $('#price-status').classList.toggle('hidden', !holdings);
  $('#toolbar').classList.toggle('hidden', !holdings);
  $('#stockList').classList.toggle('hidden', !holdings);
  $('#monthlyView').classList.toggle('hidden', v !== 'monthly');
  $('#heatmapView').classList.toggle('hidden', v !== 'heatmap');
  $('#trendView').classList.toggle('hidden', v !== 'trends');
  $('#feedView').classList.toggle('hidden', v !== 'feed');
  $('#addBtn').classList.toggle('hidden', !holdings);
  // Camera FAB: Holdings tab only, and only on portfolios with an OCR parser.
  // wife-in is included (Groww, price-only) - see openOcrReview's priceOnly branch.
  $('#ocrBtn').classList.toggle('hidden', !holdings || !(state.portfolio === 'me-in' || state.portfolio === 'me-us' || state.portfolio === 'wife-in'));
  // Screenshot update is a Pro Plan feature: on the Free Plan the camera button stays but is greyed out.
  const ocrPaid = isPaidPlan(), ocrFab = $('#ocrBtn');
  ocrFab.classList.toggle('is-locked', !ocrPaid);
  ocrFab.setAttribute('aria-disabled', ocrPaid ? 'false' : 'true');
  ocrFab.title = ocrPaid ? 'Update prices from a broker screenshot' : 'Screenshot update is a Pro Plan feature';
  if (v === 'monthly') { renderMonthly(); return; }
  if (v === 'heatmap') { renderHeatmap(); return; }
  if (v === 'trends') { await renderTrends(); return; }
  if (v === 'feed') { await renderFeed(); return; }
  renderSummary();
  renderPriceStatus();
  renderList();
  $('#search').value = state.search;
}

// ---------- top-level surface switch (Home launcher / Stocks / Mutual Funds) ----------
// Sits ABOVE the stock view system. The Stocks app renders exactly as before;
// this just decides which of the three surfaces is on screen and keeps the
// header (with the shared 3-dots menu) consistent.
// '#price-status' is the stock "Prices updated Nd ago" line: without it here it stayed visible
// after leaving Stocks and showed up on unrelated pages (e.g. the SGB tab).
const STOCK_SURFACE = ['#summary', '#price-status', '#toolbar', '#stockList', '#monthlyView', '#heatmapView', '#trendView', '#feedView', '#addBtn', '#ocrBtn'];
// Real back navigation (Android hardware/gesture back, iOS edge-swipe, browser
// back button) all operate on the browser's OWN history stack via popstate -
// they do NOT dispatch touch/pointer events our own code can intercept, so a
// custom touchstart-based edge-swipe detector is unreliable (the OS/browser
// usually consumes the gesture first). The correct fix is to push a real
// history entry per navigation and let the browser drive "back": setAppMode()
// is the normal entry point (click handlers etc.) - it pushes state (tagged
// with a `depth` used to unwind multiple levels at once) and applies the UI.
// applyAppMode() is the UI-only half, reused by the popstate handler so a
// browser-driven back/forward doesn't push yet another entry (which would
// trap the user in a loop). The very first "home" entry (pushed once at boot
// via replaceState) has depth 0 - once the user is back there, one more
// back/swipe has nothing of ours left to pop, so it falls through to the
// browser/OS default (closing the app), exactly as required.
// Which feature(s) a screen belongs to. A screen whose feature the user did not
// choose is never shown: they are sent to the feature picker instead.
const MODE_MODULES = {
  stocks: ['stocks'], mf: ['mf'], fd: ['fd'], metal: ['metal'], bond: ['bond'], div: ['div'],
  ef: ['ef'], banksav: ['banksav'], expense: ['expense'], cc: ['cc'], personal: ['personal'],
  health: ['health'], vault: ['vault'],
  investment: ['stocks', 'mf', 'fd', 'metal', 'bond'],
  savings: ['ef', 'div', 'banksav', 'inflation'],
};
function _modeBlocked(mode) {
  const need = MODE_MODULES[mode];
  return !!need && !need.some((id) => modOn(_modsCache, id));
}
function _sendToFeaturePicker() {
  toast('That feature is not in your selection. Choose it here to open it.');
  openFeaturePicker();
}
export function setAppMode(mode) {
  if (state.appMode === mode) return; // already here - no new history entry
  if (_modeBlocked(mode)) { _sendToFeaturePicker(); return; }
  const depth = ((history.state && history.state.depth) || 0) + 1;
  try { history.pushState({ appMode: mode, depth }, '', location.pathname + location.search); } catch (_) {}
  applyAppMode(mode);
}
// The header's "back to home" icon jumps straight to Home from any depth. Uses
// history.go() to unwind the real history stack back to the root entry (rather
// than pushing a fresh "home" entry on top), so a subsequent back gesture
// correctly falls through and closes the app instead of re-entering the page
// the user just left.
function goHome() {
  const depth = (history.state && history.state.depth) || 0;
  if (depth > 0) { try { history.go(-depth); return; } catch (_) {} }
  applyAppMode('home');
}
function applyAppMode(mode) {
  // Back/forward or a stale link into a screen that is not chosen: land on Home.
  if (_modeBlocked(mode)) { mode = 'home'; _sendToFeaturePicker(); }
  state.appMode = mode;
  // Which screen is up, exposed for CSS. Home is the one screen with no bottom
  // nav, so the offset the FABs use to clear one is dead space there.
  document.body.setAttribute('data-mode', mode);
  const isHome = mode === 'home', isStocks = mode === 'stocks', isMF = mode === 'mf', isFD = mode === 'fd', isDiv = mode === 'div', isMetal = mode === 'metal', isBond = mode === 'bond', isEF = mode === 'ef', isBankSav = mode === 'banksav', isInvestment = mode === 'investment', isSavings = mode === 'savings', isExpense = mode === 'expense', isCC = mode === 'cc', isPersonal = mode === 'personal', isHealth = mode === 'health', isVault = mode === 'vault';
  $('#homeView').classList.toggle('hidden', !isHome);
  $('#investmentView').classList.toggle('hidden', !isInvestment);
  $('#savingsView').classList.toggle('hidden', !isSavings);
  $('#expenseView').classList.toggle('hidden', !isExpense);
  $('#pfView').classList.toggle('hidden', !isPersonal);
  $('#ccView').classList.toggle('hidden', !isCC);
  $('#healthView').classList.toggle('hidden', !isHealth);
  $('#vaultView').classList.toggle('hidden', !isVault);
  $('#mfView').classList.toggle('hidden', !isMF);
  $('#fdView').classList.toggle('hidden', !isFD);
  $('#divView').classList.toggle('hidden', !isDiv);
  $('#metalView').classList.toggle('hidden', !isMetal);
  $('#bondView').classList.toggle('hidden', !isBond);
  $('#efView').classList.toggle('hidden', !isEF);
  $('#bankSavView').classList.toggle('hidden', !isBankSav);
  $('#portfolioTabs').classList.toggle('hidden', !isStocks);
  $('#bottomNav').classList.toggle('hidden', !isStocks);
  $('#mfBottomNav').classList.toggle('hidden', !isMF);
  $('#fdBottomNav').classList.toggle('hidden', !isFD);
  $('#divBottomNav').classList.toggle('hidden', !isDiv);
  $('#metalBottomNav').classList.toggle('hidden', !isMetal);
  $('#bondBottomNav').classList.toggle('hidden', !isBond);
  $('#efBottomNav').classList.toggle('hidden', !isEF);
  $('#expBottomNav').classList.toggle('hidden', !isExpense);
  $('#pfBottomNav').classList.toggle('hidden', !isPersonal);
  $('#ccBottomNav').classList.toggle('hidden', !isCC);
  $('#healthBottomNav').classList.toggle('hidden', !isHealth);
  $('#mfAddBtn').classList.toggle('hidden', !isMF);
  $('#mfFetchBtn').classList.toggle('hidden', !isMF);
  $('#fdAddBtn').classList.toggle('hidden', !isFD);
  $('#bondAddBtn').classList.toggle('hidden', !isBond);
  $('#efAddBtn').classList.toggle('hidden', !isEF || _efTab === 'fund' || _efTab === 'terms');
  $('#bankSavAddBtn').classList.toggle('hidden', !isBankSav);
  $('#ccAddBtn').classList.toggle('hidden', !isCC || ui._ccTab !== 'cc');
  // Reachable from Home as well as its own Spends tab, for the same reason the
  // household one is: logging a spend is the most frequent thing done in the
  // app, and burying it three taps deep is how a tracker stops being kept up.
  // The other three Personal tabs are settings and reports, where a + would
  // add nothing.
  $('#pfAddBtn').classList.toggle('hidden', !((isHome && modOn(_modsCache, 'personal')) || (isPersonal && ui._pfTab === 'spends')));
  // On Home both buttons live in the bottom-right corner, stacked: the
  // household one keeps the lower slot and this sits above it. In its own
  // section it is alone and takes the corner itself.
  $('#pfAddBtn').classList.toggle('is-second', isHome && modOn(_modsCache, 'expense'));
  // Reachable from Home as well as the Tracker tab: logging a spend is the
  // most frequent thing done in the app, and burying it three taps deep is how
  // a tracker stops being kept up to date.
  $('#spendAddBtn').classList.toggle('hidden', !((isHome && modOn(_modsCache, 'expense')) || (isExpense && ui._expTab === 'tracker')));
  // Only once the vault is open. A + on a locked screen offers to add
  // something to a list you cannot see.
  $('#vaultAddBtn').classList.toggle('hidden', !(isVault && _vaultKey));
  // Hidden whenever we leave Health Check; health.js's renderHealthCheck()
  // shows it again (and wires its click to the current person) only once a
  // family member exists to log a check against.
  if (!isHealth) $('#healthAddBtn').classList.add('hidden');
  if (!isMetal) $('#metalAddBtn').classList.add('hidden'); // renderMetal shows it on Gold/Silver only
  $('#backBtn').classList.toggle('hidden', isHome);
  $('#proBtn').classList.toggle('hidden', !MODE_FEATURE[mode]);
  $('#appTitle').innerHTML = isHome ? '' : (isInvestment ? 'Investment' : isSavings ? 'Savings' : isExpense ? 'Expense' : isCC ? 'Credit&nbsp;Cards' : isPersonal ? 'Personal&nbsp;Finance' : isHealth ? 'Health&nbsp;Check' : isMF ? 'Mutual&nbsp;Funds' : isFD ? 'Fixed&nbsp;Deposits' : isDiv ? 'Dividends' : isMetal ? 'Metals' : isBond ? 'Bonds' : isEF ? 'Emergency&nbsp;Fund' : isBankSav ? 'Bank&nbsp;Savings' : isVault ? 'My&nbsp;Passwords' : 'MyNotes');
  if (isStocks) {
    render();
  } else {
    // Nothing from the stock surface should show on Home/MF/FD/Dividends/Metals/Bonds/Section pages.
    STOCK_SURFACE.forEach((sel) => $(sel).classList.add('hidden'));
    if (isHome) renderHome();
    if (isInvestment) renderHomeInvestment();
    if (isSavings) renderHomeSavings();
    if (isExpense) { buildExpBottomNav(); renderHomeExpense(); }
    if (isPersonal) { buildPfBottomNav(); renderPersonal(); }
    if (isCC) { buildCcBottomNav(); renderCc(); }
    // resetHealthCheckView() lands every fresh entry on Family - clicking a
    // person tab inside Health Check calls renderHealthCheck() directly
    // (never through here), so it can't undo that choice on its own re-render.
    if (isHealth) { import('./health.js').then(m => { m.resetHealthCheckView(); m.renderHealthCheck(); }); }
    if (isMF) { buildMfBottomNav(); renderMF(); }
    if (isFD) { buildFdBottomNav(); renderFD(); }
    if (isDiv) { buildDivBottomNav(); renderDividend(); }
    if (isMetal) { buildMetalBottomNav(); renderMetal(); }
    if (isBond) { buildBondBottomNav(); renderBond(); }
    if (isEF) { buildEfBottomNav(); renderEmergency(); }
    if (isBankSav) renderBankSavings();
    if (isVault) renderVault();
  }
  // Leaving the section locks it. Holding a derived key alive behind an
  // unrelated screen buys nothing but a longer window for someone who picks
  // the phone up while it is unlocked.
  if (!isVault && _vaultKey) lockVault(true);
}

// Bottom nav for the MF surface (Holdings | Overview) - built once, mirrors
// the Stocks app's #bottomNav look (fixed, icon + label, active in accent).
function buildMfBottomNav() {
  const nav = $('#mfBottomNav');
  if (nav.childElementCount) { updateMfNavActive(); return; }
  nav.innerHTML = '';
  [['holdings', '📈', 'Holdings'], ['overview', '📊', 'Overview'], ['benchmark', '🎯', 'Targets'], ['stats', '⚖️', 'Performance']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (_mfTab === v) return; _mfTab = v; renderMF(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateMfNavActive();
}
export function updateMfNavActive() {
  $('#mfBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === _mfTab));
}

// ---------- Fixed Deposits surface (FDs | Overview | Ladder) ----------
// Mirrors the MF surface: a second fixed bottom nav (built once), lazy-loaded
// pure logic in fd.js, app.js does the `fds`-store CRUD + rendering.
function buildFdBottomNav() {
  const nav = $('#fdBottomNav');
  if (nav.childElementCount) { updateFdNavActive(); return; }
  nav.innerHTML = '';
  [['holdings', '🏦', 'FDs'], ['overview', '📊', 'Overview'], ['ladder', '🪜', 'Ladder']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (ui._fdTab === v) return; ui._fdTab = v; renderFD(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateFdNavActive();
}
export function updateFdNavActive() {
  $('#fdBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === ui._fdTab));
}

// ---------- Dividends surface (Stocks | Overview | Calendar) ----------
// Mirrors the MF/FD surfaces: a fixed bottom nav (built once), lazy-loaded pure
// logic in dividend.js, app.js does the `dividends`-store CRUD + rendering.
function buildDivBottomNav() {
  const nav = $('#divBottomNav');
  if (nav.childElementCount) { updateDivNavActive(); return; }
  nav.innerHTML = '';
  [['stocks', '💰', 'Stocks'], ['overview', '📊', 'Overview'], ['calendar', '🗓️', 'Calendar']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (_divTab === v) return; _divTab = v; renderDividend(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateDivNavActive();
}
export function updateDivNavActive() {
  $('#divBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === _divTab));
}

// ---------- Metals surface (Gold | Silver | SGB) ----------
// Mirrors the MF/FD/Dividend surfaces: a fixed bottom nav (built once),
// lazy-loaded pure logic in metal.js, app.js does the `metals`-store CRUD.
function buildMetalBottomNav() {
  const nav = $('#metalBottomNav');
  if (nav.childElementCount) { updateMetalNavActive(); return; }
  nav.innerHTML = '';
  [['overview', '📊', 'Overview'], ['gold', '🥇', 'Gold'], ['silver', '🥈', 'Silver'], ['sgb', '📜', 'SGB']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (_metalTab === v) return; _metalTab = v; renderMetal(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateMetalNavActive();
}
export function updateMetalNavActive() {
  $('#metalBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === _metalTab));
}

// ---------- Bonds surface (Bonds | Overview) ----------
// Mirrors the FD surface: a fixed bottom nav (built once), lazy-loaded pure
// logic in bonds.js, app.js does the `bonds`-store CRUD. No Ladder/Chain tab —
// bonds here don't ladder/merge the way the user's FDs do.
function buildBondBottomNav() {
  const nav = $('#bondBottomNav');
  if (nav.childElementCount) { updateBondNavActive(); return; }
  nav.innerHTML = '';
  [['holdings', '🧾', 'Bonds'], ['overview', '📊', 'Overview']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (_bondTab === v) return; _bondTab = v; renderBond(); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateBondNavActive();
}
export function updateBondNavActive() {
  $('#bondBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === _bondTab));
}

// Bottom nav for the Emergency Fund surface. "Fund" is first and deliberately
// carries everything (corpus, parked, lent, available, targets) — the other two
// tabs are just the editable ledgers behind it.
function buildEfBottomNav() {
  const nav = $('#efBottomNav');
  if (nav.childElementCount) { updateEfNavActive(); return; }
  nav.innerHTML = '';
  [['fund', '🚨', 'Funds'], ['targets', '🎯', 'Targets'], ['loans', '🤝', 'Loans'], ['log', '🗓️', 'Log'], ['terms', '📜', 'Rules']].forEach(([v, ico, label]) => {
    nav.appendChild(el('button', { 'data-view': v, onclick: () => { if (_efTab === v) return; _efTab = v; renderEmergency(); $('#efAddBtn').classList.toggle('hidden', _efTab === 'fund' || _efTab === 'terms'); } },
      [el('span', { class: 'bn-ico', text: ico }), label]));
  });
  updateEfNavActive();
}
export function updateEfNavActive() {
  $('#efBottomNav').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.getAttribute('data-view') === _efTab));
}


// ---------- Home: live Gold/Silver/USD→INR strip ----------
//
// Three read-only boxes below the section cards - 24K gold and 999 silver per
// gram, and the USD→INR rate. Two free, no-key APIs: gold-api.com for XAU/XAG
// spot (USD per troy ounce), open.er-api.com for the forex rate.
//
// gold-api.com/gold-api.com's XAU/XAG figure is the INTERNATIONAL (LBMA-style)
// spot price, not a domestic Indian retail quote - a jeweller's or a
// digital-gold app's own rate runs noticeably higher once import duty, GST
// and a dealer/platform margin are added on top. A real India-domestic feed
// (IBJA) was tried and dropped: the one free mirror of it has no CORS
// headers, so a browser fetch to it is blocked outright (confirmed via a live
// console error, not a guess), and IBJA's own official API is paid-only.
//
// So the domestic figure shown as the MAIN number is spot marked up by a
// fixed percentage instead - GOLD_DOMESTIC_PREMIUM_PCT / SILVER_..., set by
// the user on 2026-09-15 against that day's actual India price vs this same
// spot feed. Unlike the USD→INR gap below, this premium is structural (duty +
// GST + dealer margin), not pure bid/ask noise, so a fixed percentage is a
// reasonable stand-in between real domestic-feed reads - but it IS a
// snapshot, not something the API recomputes, so if the user ever reports it
// drifting, ask what today's real domestic figure is and rederive the
// percentage rather than nudging it blind. The untouched spot figure is kept
// alongside it (goldSpot/silverSpot) and shown as the smaller secondary line
// in each box specifically so the raw number stays checkable.
//
// USD→INR is left as pure open.er-api.com mid-market, no markup. What
// Google/a bank/a card network shows at the same moment can differ by a few
// paise to half a rupee even when both sides are working correctly -
// different providers snapshot at different instants and from different
// panels of banks, and the gap moves day to day and can flip sign, unlike the
// gold/silver premium above. Confirmed with the user 2026-09-15: leave it be.
//
// The Metals tab's own ₹/gram price (metalPortfolio(), renderMetalLedger())
// reads this SAME cached value (2026-09-15 onward) rather than a separate
// manually-typed figure - the two used to be independent stores that could
// silently disagree; now there's one live number, shown two places.
//
// Cached in meta.homeLiveRates and refreshed at most once a day, silently in
// the background - open.er-api.com's own feed only updates daily, and
// hammering either API on every Home open buys nothing. The cached value
// paints instantly; a slow or failed fetch never blocks Home.
const TROY_OZ_GRAMS = 31.1034768;
const LIVE_RATES_STALE_MS = 24 * 60 * 60 * 1000;
// Defaults only - the user's own figures (meta.metalDomesticPremium) always
// win once set. See openMetalPremiumSettings.
const GOLD_DOMESTIC_PREMIUM_PCT = 13.8;
const SILVER_DOMESTIC_PREMIUM_PCT = 14.6;

async function _metalPremiumPct() {
  const row = await DB.get('meta', 'metalDomesticPremium').catch(() => null);
  const v = row && row.value;
  return {
    gold: v && v.gold != null ? Number(v.gold) : GOLD_DOMESTIC_PREMIUM_PCT,
    silver: v && v.silver != null ? Number(v.silver) : SILVER_DOMESTIC_PREMIUM_PCT,
  };
}

export async function _fetchLiveRates() {
  // Fetching live rates is a Pro Plan feature. On the Free Plan nothing is requested from anywhere and the
  // figures are whatever the person typed in themselves (source: 'manual'), so every caller stays offline.
  if (!isPaidPlan()) return null;
  const [xauR, xagR, fxR] = await Promise.all([
    fetch('https://api.gold-api.com/price/XAU').catch(() => null),
    fetch('https://api.gold-api.com/price/XAG').catch(() => null),
    fetch('https://open.er-api.com/v6/latest/USD').catch(() => null),
  ]);
  const [xau, xag, fx] = await Promise.all([
    xauR && xauR.ok ? xauR.json().catch(() => null) : null,
    xagR && xagR.ok ? xagR.json().catch(() => null) : null,
    fxR && fxR.ok ? fxR.json().catch(() => null) : null,
  ]);
  const usdInr = fx && fx.rates ? Number(fx.rates.INR) : null;
  const goldOz = xau ? Number(xau.price) : null;
  const silverOz = xag ? Number(xag.price) : null;
  if (!(usdInr > 0) || !(goldOz > 0) || !(silverOz > 0)) return null;
  const goldSpot = round2((goldOz / TROY_OZ_GRAMS) * usdInr);
  const silverSpot = round2((silverOz / TROY_OZ_GRAMS) * usdInr);
  const pct = await _metalPremiumPct();
  const value = {
    gold: round2(goldSpot * (1 + pct.gold / 100)),
    goldSpot,
    silver: round2(silverSpot * (1 + pct.silver / 100)),
    silverSpot,
    premiumPct: pct,
    usdInr: round2(usdInr),
    source: 'spot+premium',
    asOf: new Date().toISOString(),
  };
  await DB.put('meta', { key: 'homeLiveRates', value }).catch(() => {});
  return value;
}

// Re-applies the (possibly just-edited) premium % to the LAST FETCHED spot
// price, with no network call - editing the % should feel instant, not
// trigger a round trip to two APIs for a number that hasn't itself changed.
// Falls back to a real fetch only if nothing has ever been cached yet.
async function _recomputeLiveRatesPremium() {
  const cached = await DB.get('meta', 'homeLiveRates').catch(() => null);
  const v = cached && cached.value;
  if (!v || v.goldSpot == null || v.silverSpot == null) return _fetchLiveRates();
  const pct = await _metalPremiumPct();
  const value = Object.assign({}, v, {
    gold: round2(v.goldSpot * (1 + pct.gold / 100)),
    silver: round2(v.silverSpot * (1 + pct.silver / 100)),
    premiumPct: pct,
  });
  await DB.put('meta', { key: 'homeLiveRates', value }).catch(() => {});
  return value;
}

// Free Plan: the same three figures, typed in by the person instead of fetched. Stored in the very same
// meta.homeLiveRates row the fetch would have written, so Metals, Home and the Expense sheet read one
// source either way. No spot price and no premium %, because nothing was fetched to apply one to.
export async function openManualRatesEditor(onSaved) {
  const cached = await DB.get('meta', 'homeLiveRates').catch(() => null);
  const v = (cached && cached.value) || {};
  const goldIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v.gold != null ? v.gold : '' });
  const silverIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v.silver != null ? v.silver : '' });
  const usdIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v.usdInr != null ? v.usdInr : '' });
  const save = async () => {
    const g = num(goldIn.value), s = num(silverIn.value), u = num(usdIn.value);
    const value = {
      gold: g > 0 ? round2(g) : null,
      silver: s > 0 ? round2(s) : null,
      usdInr: u > 0 ? round2(u) : null,
      source: 'manual',
      asOf: new Date().toISOString(),
    };
    await DB.put('meta', { key: 'homeLiveRates', value });
    closeModal();
    toast('Rates saved');
    if (typeof onSaved === 'function') onSaved(value);
  };
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Your rates' }),
    el('p', { class: 'hint', text: 'Type the rates you want your holdings valued at - from your jeweller, your gold app or the news. They stay on this device and change nothing else. The Pro Plan fetches these for you every day.' }),
    field('Gold 24K (\u20B9 per gram)', goldIn),
    field('Silver 999 (\u20B9 per gram)', silverIn),
    field('1 USD (\u20B9)', usdIn),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ]),
  ]));
}

// Shared by the Home strip's % button and the Metals tab's "Edit %" button -
// one settings surface, since both read the same meta.metalDomesticPremium.
// `onSaved(freshValue)` lets each caller repaint just its own UI rather than
// this function knowing about either screen.
export async function openMetalPremiumSettings(onSaved) {
  const pct = await _metalPremiumPct();
  const goldIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: pct.gold });
  const silverIn = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: pct.silver });

  const save = async () => {
    const g = num(goldIn.value), s = num(silverIn.value);
    await DB.put('meta', {
      key: 'metalDomesticPremium',
      value: {
        gold: g != null ? g : GOLD_DOMESTIC_PREMIUM_PCT,
        silver: s != null ? s : SILVER_DOMESTIC_PREMIUM_PCT,
        updatedAt: new Date().toISOString(),
      },
    });
    closeModal();
    const fresh = await _recomputeLiveRatesPremium().catch(() => null);
    toast('Saved');
    if (typeof onSaved === 'function') onSaved(fresh);
  };

  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'India price estimate' }),
    el('p', { class: 'hint', text: 'Gold/silver on Home and the Metals tab are international spot plus this fixed percentage, approximating a jeweller/digital-gold rate (import duty + GST + dealer margin). Adjust either % if what you actually see quoted has drifted from this estimate.' }),
    field('Gold premium (%)', goldIn),
    field('Silver premium (%)', silverIn),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ]),
  ]));
}

const _homeRateFmt = (v) => v != null ? '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

// "3h ago" / "2d ago" - short, since this sits under three number boxes.
function _liveRatesAsOfLabel(iso) {
  const then = iso ? new Date(iso).getTime() : NaN;
  if (!then) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

// `sub`, when given, is the raw spot figure - shown smaller, under the main
// (marked-up) value, so the untouched number stays checkable at a glance
// instead of only living in a tooltip or a separate screen.
function _liveRateBox(label, val, sub) {
  return el('div', { class: 'home-rate-box' }, [
    el('div', { class: 'home-rate-lbl', text: label }),
    el('div', { class: 'home-rate-val', text: _homeRateFmt(val) }),
    el('div', { class: 'home-rate-sub', text: sub != null ? 'Spot ' + _homeRateFmt(sub) : '' }),
  ]);
}

// Names the basis gold/silver are on - see the block comment above
// _fetchLiveRates for why the main figure is spot + a fixed India premium
// rather than a live domestic feed. Reads the ACTUAL % that produced this
// particular cached value (falls back to the defaults for a value cached
// before premiumPct existed), not the current setting - so an old cached
// figure never claims a % it wasn't computed with.
const _liveRatesSourceLabel = (rates) => {
  if (!rates || rates.source !== 'spot+premium') return '';
  const pct = rates.premiumPct || { gold: GOLD_DOMESTIC_PREMIUM_PCT, silver: SILVER_DOMESTIC_PREMIUM_PCT };
  return '+' + pct.gold + '%/+' + pct.silver + '% India est.';
};

export async function _homeLiveRatesStrip() {
  const cached = await DB.get('meta', 'homeLiveRates').catch(() => null);
  const rates = cached && cached.value ? cached.value : null;

  const goldBox = _liveRateBox('Gold 24K/g', rates ? rates.gold : null, rates ? rates.goldSpot : null);
  const silverBox = _liveRateBox('Silver 999/g', rates ? rates.silver : null, rates ? rates.silverSpot : null);
  const usdBox = _liveRateBox('1 USD', rates ? rates.usdInr : null);
  const asOfEl = el('div', {
    class: 'home-rate-asof',
    text: rates ? _liveRatesSourceLabel(rates) + ' · ' + _liveRatesAsOfLabel(rates.asOf) : 'Fetching…',
  });
  const paid = isPaidPlan();
  const refreshBtn = el('button', { type: 'button', class: 'home-rate-refresh', title: 'Refresh', text: '↻' });
  const settingsBtn = el('button', { type: 'button', class: 'home-rate-settings', title: 'Edit India %', text: '%' });
  // Free Plan: one pencil, no refresh and no % - there is no spot price to apply a percentage to.
  const editBtn = el('button', { type: 'button', class: 'home-rate-edit', title: 'Edit your rates', text: '✎' });

  const paint = (v) => {
    // Falls back to the ORIGINAL cache read, not the attempted-and-failed
    // fetch, so a refresh tap that fails offline keeps showing the last known
    // good figures instead of blanking them to em-dashes.
    const shown = v || rates;
    goldBox.querySelector('.home-rate-val').textContent = _homeRateFmt(shown && shown.gold);
    goldBox.querySelector('.home-rate-sub').textContent = shown && shown.goldSpot != null ? 'Spot ' + _homeRateFmt(shown.goldSpot) : '';
    silverBox.querySelector('.home-rate-val').textContent = _homeRateFmt(shown && shown.silver);
    silverBox.querySelector('.home-rate-sub').textContent = shown && shown.silverSpot != null ? 'Spot ' + _homeRateFmt(shown.silverSpot) : '';
    usdBox.querySelector('.home-rate-val').textContent = _homeRateFmt(shown && shown.usdInr);
    asOfEl.textContent = shown
      ? (paid ? _liveRatesSourceLabel(shown) + ' · ' + _liveRatesAsOfLabel(shown.asOf) : 'Your rates · ' + _liveRatesAsOfLabel(shown.asOf))
      : (paid ? 'Unavailable offline' : 'Tap to set your rates');
  };

  settingsBtn.onclick = () => openMetalPremiumSettings((fresh) => paint(fresh));

  const refresh = async () => {
    refreshBtn.classList.add('spinning');
    const v = await _fetchLiveRates().catch(() => null);
    refreshBtn.classList.remove('spinning');
    paint(v);
  };
  refreshBtn.onclick = refresh;

  const edit = () => openManualRatesEditor((fresh) => paint(fresh));
  editBtn.onclick = edit;
  // A manual figure left over from the Free Plan is replaced the moment Pro is on, not a day later.
  if (paid && (!rates || rates.source === 'manual' || (Date.now() - new Date(rates.asOf).getTime()) > LIVE_RATES_STALE_MS)) refresh();
  if (!paid) paint(rates);

  const row = el('div', { class: 'home-rates-row' }, [goldBox, silverBox, usdBox]);
  // The whole row is the way in on the Free Plan: an empty strip that cannot be tapped says nothing.
  if (!paid) { row.classList.add('is-editable'); row.addEventListener('click', edit); }
  return el('div', { class: 'home-rates' + (paid ? '' : ' is-manual') }, [
    row,
    el('div', { class: 'home-rates-foot' }, paid ? [asOfEl, settingsBtn, refreshBtn] : [asOfEl, editBtn]),
  ]);
}

// ---------- Feature picker + first-run onboarding ----------
// Every feature is on by default. A new user picks what they want; the rest
// are hidden from Home (their data is untouched, just not shown).
export const APP_MODULES = [
  { id: 'stocks', icon: '📈', label: 'Stocks', desc: 'Holdings, monthly returns, heatmap' },
  { id: 'mf', icon: '📊', label: 'Mutual Funds', desc: 'SIPs, returns (XIRR), NAV updates' },
  { id: 'fd', icon: '🏦', label: 'Fixed Deposits', desc: 'Maturity dates and interest' },
  { id: 'metal', icon: '🪙', label: 'Gold & Silver', desc: 'Grams held and value' },
  { id: 'bond', icon: '🧾', label: 'Bonds', desc: 'Coupons and maturity' },
  { id: 'div', icon: '💰', label: 'Dividends', desc: 'Dividends per stock, year by year', requires: 'stocks' },
  { id: 'ef', icon: '🚨', label: 'Emergency Fund', desc: 'A savings pot with targets and loans' },
  { id: 'banksav', icon: '🐷', label: 'Bank Savings', desc: 'Balances across your bank accounts' },
  { id: 'inflation', icon: '📉', label: 'Inflation Calculator', desc: 'Value of money in the future' },
  { id: 'expense', icon: '🛒', label: 'Expenses', desc: 'Household spending, cash flow and yearly plan' },
  { id: 'cc', icon: '💳', label: 'Credit Cards', desc: 'Card bills, limits and month by month view' },
  { id: 'personal', icon: '👛', iconSrc: 'icons/personal-finance.png', label: 'Personal Spending', desc: 'Your own card/UPI spend and limits' },
  { id: 'health', icon: '🩺', label: 'Health Check', desc: 'Family lab results and trends' },
  { id: 'vault', icon: '🔐', label: 'Password Vault', desc: 'Encrypted passwords, only on this device' },
];
// Presentation only: how the Choose features screen groups its cards. Nothing reads this for gating, limits
// or dependencies; a feature missing from every group is still shown, under "More".
const PICKER_GROUPS = [
  ['\u{1F4B3}', 'Spending', ['expense', 'cc', 'personal', 'banksav']],
  ['\u{1F4C8}', 'Investments', ['stocks', 'mf', 'fd', 'metal', 'bond', 'div']],
  ['\u{1F3AF}', 'Planning', ['ef', 'inflation']],
  ['\u2764\uFE0F', 'Family', ['health']],
  ['\u{1F510}', 'Security', ['vault']],
];
export let _modsCache = null;
export async function getEnabledModules() {
  const r = await DB.get('meta', 'enabledModules').catch(() => null);
  _modsCache = r && Array.isArray(r.value) ? new Set(r.value) : null;
  // Credit Cards used to be part of Expenses. Once, for anyone who had Expenses,
  // it is switched on too so no card screen disappears; later choices are respected.
  try {
    if (_modsCache && _modsCache.has('expense') && !_modsCache.has('cc') && !(await DB.get('meta', 'ccSplit'))) {
      _modsCache.add('cc');
      await DB.put('meta', { key: 'enabledModules', value: [..._modsCache] });
      await DB.put('meta', { key: 'ccSplit', value: true });
    } else if (_modsCache && !(await DB.get('meta', 'ccSplit'))) {
      await DB.put('meta', { key: 'ccSplit', value: true });
    }
  } catch (_) {}
  // A Pro member has every feature: nothing is chosen, nothing is limited. The saved choice is left
  // untouched (in meta) in case the plan ever goes back to free.
  if (isPaidPlan()) _modsCache = new Set(APP_MODULES.map((m) => m.id));
  return _modsCache;
}
export const isPaidPlan = () => document.body.dataset.plan === 'paid';
// A feature that depends on another (Dividends need Stocks) is off whenever its
// dependency is off, so every screen, total and reminder stays consistent.
const MODULE_REQUIRES = { div: 'stocks' };
// A module's icon: its own image when it has one (Personal Spending uses the
// same money note as its Home card), otherwise the emoji.
export function moduleIcon(m) {
  return m.iconSrc ? el('img', { src: m.iconSrc, alt: '', class: 'mod-ico-img' }) : document.createTextNode(m.icon);
}
export const modOn = (set, id) => !set || (set.has(id) && (!MODULE_REQUIRES[id] || set.has(MODULE_REQUIRES[id])));
// Free plan: any 5 features. (Paid tiers will lift this later.)
const FREE_FEATURE_LIMIT = 5;

// Membership isn't on sale yet: say so plainly instead of pretending to sell. The sheet is the same
// Free Plan vs Pro Plan comparison as the website (tap a row to read what it means).
function showProInfo() {
  // The title and Close stay put; only the table itself scrolls, so the sheet never runs off the screen.
  openModal(el('div', { class: 'sheet pro-sheet plan-compare-sheet has-fixed-footer' }, [
    el('div', { class: 'plan-compare-head' }, [
      el('h2', {}, [el('img', { class: 'pro-title-star', src: 'icons/emoji/pro-star.png', alt: '' }), document.createTextNode('Free Plan or Pro Plan')]),
      el('p', { class: 'hint', text: 'Your ' + FREE_FEATURE_LIMIT + ' Free Plan features stay free. Pro is planned at ' + PRO_PRICE + ' (' + PRO_PRICE_NOTE + '), unlocking everything for life on this device. ' + NOT_ON_SALE }),
    ]),
    el('div', { class: 'plan-compare-thead' }, [buildCompareHeader()]),
    el('div', { class: 'sheet-scroll plan-compare-body' }, [buildPlanCompare(FREE_FEATURE_LIMIT, APP_MODULES.length, { noHeader: true })]),
    el('div', { class: 'sheet-footer' }, [el('button', { class: 'btn primary plan-compare-close', type: 'button', text: 'Close', onclick: closeModal })]),
  ]));
}

// Home's app icon crossfades to the Pro icon and the PRO badge pops in. The Home re-render that follows draws the
// same Pro icon, so nothing visibly jumps.
// Both directions: Free to Pro pops the badge in, Pro to Free fades it out and returns the original icon.
async function playPlanChange(toPaid) {
  const img = document.querySelector('#homeView .home-title-ico');
  if (toPaid) {
    document.body.classList.add('plan-flipped');
    setTimeout(() => document.body.classList.remove('plan-flipped'), 2800);
  }
  if (!img || state.appMode !== 'home') return;
  const pill = document.querySelector('#homeView .pro-pill');
  if (!toPaid && pill) pill.classList.add('is-leaving');
  img.classList.add('is-swapping');
  await new Promise((r) => setTimeout(r, 260));
  img.src = toPaid ? 'icons/icon-pro.png' : 'icons/icon-192.png';
  img.classList.toggle('is-pro', toPaid);
  img.classList.remove('is-swapping');
  await new Promise((r) => setTimeout(r, 320));
}

function openFeaturePicker(opts) {
  const first = !!(opts && opts.first);
  // Pro members have everything, so there is nothing to pick (the welcome screen still runs on a fresh install).
  if (isPaidPlan() && !first) { toast('All features are unlocked with the Pro Plan.'); return Promise.resolve(); }
  // required: features were never chosen (e.g. a restored backup) - no way out but to choose.
  const required = !!(opts && opts.required);
  document.querySelectorAll('.onboard').forEach((n) => n.remove());
  return Promise.all([
    getEnabledModules(),
    // What the visitor picked on the website before installing, so the app opens
    // with those already ticked instead of an empty list.
    DB.get('meta', 'landingPicks').catch(() => null),
  ]).then(([cur, picked]) => {
    const pre = cur || (picked && Array.isArray(picked.value) ? new Set(picked.value) : null);
    const chosen = new Set(pre ? APP_MODULES.filter((m) => pre.has(m.id)).map((m) => m.id) : []);
    const root = el('div', { class: 'onboard' });
    document.body.appendChild(root);
    document.body.classList.add('locked');
    const close = () => { root.remove(); document.body.classList.remove('locked'); };
    const finish = () => {
      close();
      applyAppMode('home');
      if (first && !isPaidPlan()) toast('You can change features anytime: Menu → Settings → Choose features');
      // Pro's guided yearly plan comes after the shared steps (name, optional age/gender, first backup).
      if (isPaidPlan()) runPlanSetupIfNeeded();
    };

    // One-time, first-run only. Teaches why a backup matters (nothing is online),
    // then creates the app's own backup folder (or, where folders aren't
    // supported, downloads a first backup file). Picking a location needs a tap:
    // browsers don't allow doing it silently.
    // First run only, after features are chosen: a separate, skippable page about the two
    // OPTIONAL details (age group, gender). The anonymous feature counts are already
    // disclosed and can be turned off in Menu > Privacy & Terms; skipping here changes
    // nothing about them.
    const stepAbout = () => {
      root.innerHTML = '';
      const ageSel = el('select', { 'aria-label': 'Age group' }, AGE_BANDS.map((v) => el('option', { value: v, text: v || 'Prefer not to say' })));
      const genSel = el('select', { 'aria-label': 'Gender' }, GENDERS.map((v) => el('option', { value: v, text: v || 'Prefer not to say' })));
      // The name never leaves this device (it only greets you on Home), so it is kept whether they Share or Skip.
      const nameIn = el('input', { class: 'onboard-name', type: 'text', maxlength: '30', placeholder: 'Your first name (optional)', autocomplete: 'given-name', 'aria-label': 'Your name' });
      const share = async () => { await saveUserName(nameIn.value); await saveUsageProfile({ share: true, ageBand: ageSel.value, gender: genSel.value }); sendUsage().catch(() => {}); stepBackup(); };
      const skip = async () => { await saveUserName(nameIn.value); await saveUsageProfile({ share: false }); sendUsage().catch(() => {}); stepBackup(); };
      root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
        el('div', { class: 'onboard-about-ico', text: '📊' }),
        el('h1', { class: 'onboard-h', text: 'Help us improve MyNotes' }),
        el('p', { class: 'onboard-sub', text: 'All optional. Here is exactly what we use.' }),
        el('div', { class: 'onboard-demo onboard-demo-page' }, [
          el('label', { class: 'onboard-name-wrap' }, [
            el('span', { text: 'What should we call you?' }),
            nameIn,
            el('small', { class: 'onboard-field-note', text: 'Only greets you on Home. Never leaves this device.' }),
          ]),
          el('div', { class: 'onboard-demo-row' }, [
            el('label', {}, [el('span', { text: 'Age group' }), ageSel]),
            el('label', {}, [el('span', { text: 'Gender' }), genSel]),
          ]),
          el('small', { class: 'onboard-field-note', text: 'Counted with the features you chose, so we know who to build for.' }),
        ]),
        el('p', { class: 'onboard-demo-sub onboard-about-skip', text: 'Nothing else is taken: never your money data, notes or contacts. Skip and MyNotes works exactly the same.' }),
      ]));
      root.appendChild(el('div', { class: 'onboard-bar' }, [
        el('button', { class: 'btn ghost', type: 'button', text: 'Skip', onclick: skip }),
        el('button', { class: 'btn primary', type: 'button', text: 'Share', onclick: share }),
      ]));
    };
    const stepBackup = () => {
      root.innerHTML = '';
      const canFolder = fileSystemAccessSupported();
      const risks = [
        ['📱', 'Phone lost or stolen', 'Everything you entered is gone. There is no online copy to recover it from.'],
        ['🧹', 'App data cleared', 'Clearing app or browser storage erases all your records instantly.'],
        ['💥', 'Crash or factory reset', 'A device failure or reset wipes local data. A backup brings it back in one tap.'],
      ];
      const riskCards = risks.map(([ico, t, d]) => {
        const card = el('button', { class: 'onboard-risk', type: 'button' }, [
          el('span', { class: 'onboard-risk-ico', text: ico }),
          el('span', { class: 'onboard-risk-t', text: t }),
          el('span', { class: 'onboard-risk-more', text: '+' }),
          el('span', { class: 'onboard-risk-d', text: d }),
        ]);
        card.addEventListener('click', () => card.classList.toggle('open'));
        return card;
      });
      const stepsBox = el('div', { class: 'onboard-steps' }, (canFolder
        ? ['You pick where to keep it', 'We create a "' + APP_FOLDER_NAME + '" folder just for this app', 'Back up anytime in Menu → Backup & Restore']
        : ['We save a backup file to your Downloads', 'Keep a copy somewhere safe (cloud drive, email, another device)', 'Back up again anytime in Menu → Backup & Restore']
      ).map((t, i) => el('div', { class: 'onboard-step' }, [el('span', { class: 'onboard-step-n', text: String(i + 1) }), el('span', { text: t })])));

      const done = (title, msg) => {
        root.innerHTML = '';
        root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
          el('div', { class: 'onboard-done-tick', text: '✓' }),
          el('h1', { class: 'onboard-h', text: title }),
          el('p', { class: 'onboard-sub', text: msg }),
          el('p', { class: 'onboard-sub', text: 'Tip: back up regularly, and keep a second copy of the backup file on Google Drive or another device. We will remind you when it has been a while.' }),
        ]));
        root.appendChild(el('div', { class: 'onboard-bar' }, [el('button', { class: 'btn primary', type: 'button', text: 'Continue', onclick: finish })]));
      };

      const warn = el('div', { class: 'onboard-warn hidden' }, [
        el('b', { text: 'Skip the backup?' }),
        el('div', { text: 'If this device crashes or is lost, your data cannot be recovered. You can set it up later in Menu → Backup & Restore.' }),
        el('div', { class: 'onboard-warn-btns' }, [
          el('button', { class: 'btn primary small', type: 'button', text: 'Set it up now', onclick: () => warn.classList.add('hidden') }),
          el('button', { class: 'btn ghost small', type: 'button', text: 'Skip anyway', onclick: finish }),
        ]),
      ]);
      const primary = el('button', { class: 'btn primary', type: 'button', text: canFolder ? 'Create backup folder' : 'Download my first backup' });
      primary.addEventListener('click', async () => {
        primary.disabled = true;
        try {
          if (canFolder) {
            const h = await pickFolder();
            const data = await DB.exportAll();
            if (_backupRecordCount(data) > 0) {
              await writeBackup(h, data);
              await markBackedUp();
              done('Backup is ready', 'Your backups will be saved in the "' + (h.name || APP_FOLDER_NAME) + '" folder. A first backup is already there.');
            } else {
              // Nothing entered yet: an empty backup could overwrite a good one in this folder.
              done('Backup folder is ready', 'Your backups will be saved in the "' + (h.name || APP_FOLDER_NAME) + '" folder. Add some data, then tap Back up now on the Home screen.');
            }
          } else {
            if (_backupRecordCount(await DB.exportAll()) === 0) {
              done('You are all set', 'Add some data first, then tap Back up now on the Home screen to save your first backup file.');
              return;
            }
            await exportData();
            done('First backup saved', 'The backup file is in your Downloads folder. Keep a copy somewhere safe, such as a cloud drive, email or another device.');
          }
        } catch (e) {
          primary.disabled = false;
          if (e && e.name !== 'AbortError') toast('Could not create the backup. You can do it later in Menu → Backup & Restore.');
        }
      });

      root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
        el('div', { class: 'onboard-shield', text: '🛡️' }),
        el('h1', { class: 'onboard-h', text: 'Your data lives only on this device' }),
        el('p', { class: 'onboard-sub', text: 'Nothing is stored online, so a backup is your only safety net.' }),
        el('div', { class: 'onboard-risk-label', text: 'Tap to see what can go wrong' }),
        el('div', { class: 'onboard-risks' }, riskCards),
        el('div', { class: 'onboard-risk-label', text: canFolder ? 'Set it up in one tap' : 'How it works' }),
        stepsBox,
        warn,
      ]));
      root.appendChild(el('div', { class: 'onboard-bar' }, [
        el('button', { class: 'btn ghost', type: 'button', text: 'Skip for now', onclick: () => { warn.classList.remove('hidden'); warn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }),
        primary,
      ]));
    };

    const stepChoose = () => {
      root.innerHTML = '';
      const count = el('span', { class: 'onboard-count' });
      const cont = el('button', { class: 'btn primary', type: 'button' });
      const refresh = () => {
        count.textContent = chosen.size + ' of ' + FREE_FEATURE_LIMIT + ' selected';
        cont.textContent = first ? 'Continue' : 'Save';
        cont.disabled = chosen.size === 0 || chosen.size > FREE_FEATURE_LIMIT;
      };
      // `grid` is still the one container holding every card (Clear uses it); the cards now sit in category sections inside it.
      const grid = el('div', { class: 'onboard-groups' });
      const cards = new Map();
      // A dependent feature (Dividends) is locked, and dropped, while what it
      // needs (Stocks) is not chosen.
      const syncDeps = () => {
        APP_MODULES.forEach((m) => {
          if (!m.requires) return;
          const card = cards.get(m.id);
          const locked = !chosen.has(m.requires);
          if (locked) chosen.delete(m.id);
          card.disabled = locked;
          card.classList.toggle('locked', locked);
          card.classList.toggle('on', chosen.has(m.id));
        });
      };
      APP_MODULES.forEach((m) => {
        const need = m.requires && APP_MODULES.find((x) => x.id === m.requires);
        const card = el('button', { class: 'onboard-opt' + (chosen.has(m.id) ? ' on' : ''), type: 'button' }, [
          el('span', { class: 'onboard-opt-ico' }, [moduleIcon(m)]),
          el('span', { class: 'onboard-opt-name', text: m.label }),
          el('span', { class: 'onboard-opt-desc', text: m.desc }),
          need ? el('span', { class: 'onboard-opt-need', text: '* Available with ' + need.label }) : null,
          el('span', { class: 'onboard-opt-tick', text: '✓' }),
        ].filter(Boolean));
        cards.set(m.id, card);
        card.addEventListener('click', () => {
          if (!chosen.has(m.id) && chosen.size >= FREE_FEATURE_LIMIT) {
            appConfirm('You have picked your ' + FREE_FEATURE_LIMIT + ' Free Plan features.\n\nWant ' + m.label + ' too? Unlock all ' + APP_MODULES.length + ' features with the Pro Plan, or deselect one to swap.',
              { okText: 'See the Pro Plan', danger: false }).then((go) => { if (go) showProInfo(); });
            return;
          }
          if (chosen.has(m.id)) chosen.delete(m.id); else chosen.add(m.id);
          card.classList.toggle('on', chosen.has(m.id));
          syncDeps();
          refresh();
        });
      });
      const placed = new Set();
      const addGroup = (icon, title, ids) => {
        const inner = el('div', { class: 'onboard-grid' });
        ids.forEach((id) => { const c = cards.get(id); if (c) { inner.appendChild(c); placed.add(id); } });
        if (!inner.children.length) return;
        grid.appendChild(el('section', { class: 'onboard-cat' }, [
          el('h2', { class: 'onboard-cat-h' }, [el('span', { class: 'onboard-cat-ico', 'aria-hidden': 'true', text: icon }), document.createTextNode(title)]),
          inner,
        ]));
      };
      PICKER_GROUPS.forEach(([icon, title, ids]) => addGroup(icon, title, ids));
      addGroup('\u2728', 'More', APP_MODULES.map((m) => m.id).filter((id) => !placed.has(id)));
      syncDeps();
      cont.addEventListener('click', async () => {
        await DB.put('meta', { key: 'enabledModules', value: [...chosen] });
        _modsCache = new Set(chosen);
        await DB.put('meta', { key: 'onboarded', value: true });
        if (first) { stepAbout(); return; }
        sendUsage().catch(() => {});
        finish();
      });
      root.appendChild(el('div', { class: 'onboard-scroll' }, [
        el('h1', { class: 'onboard-h', text: 'Choose up to ' + FREE_FEATURE_LIMIT + ' tools to get started' }),
        el('div', { class: 'onboard-pro' }, [
          el('div', { class: 'onboard-pro-badge', text: '⭐ FREE PLAN' }),
          el('div', { class: 'onboard-pro-title', text: 'Try any ' + FREE_FEATURE_LIMIT + ' features, free' }),
          el('div', { class: 'onboard-pro-text', text: 'Love them? Unlock all ' + APP_MODULES.length + ' features with the Pro Plan - every tool, one simple plan, your data still only on your device.' }),
          el('button', { class: 'onboard-pro-btn', type: 'button', text: 'Unlock all features', onclick: showProInfo }),
        ]),
        grid,
      ]));
      root.appendChild(el('div', { class: 'onboard-bar onboard-bar-note' }, [
        el('p', { class: 'onboard-bar-hint', text: 'You can switch your picks anytime, and your existing data stays safe.' }),
        count,
        ...(first || required ? [] : [el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: close })]),
        cont,
      ]));
      refresh();
    };

    if (!first) { stepChoose(); return; }
    const goChoose = async () => {
      await recordLegalAcceptance();
      // Pro has nothing to pick, but still gets the name and the optional age/gender page; the picker is the only
      // step it skips. stepAbout leads on to the backup step, which ends the flow for both plans.
      if (isPaidPlan()) stepAbout(); else stepChoose();
    };
    // Every card is an icon tile, a title and exactly two lines. `icon` is an emoji or a ready-made node (the Pro star).
    const point = (icon, title, text, cls) => el('div', { class: 'onboard-point' + (cls ? ' ' + cls : '') }, [
      el('span', { class: 'onboard-point-ico', 'aria-hidden': 'true' }, [typeof icon === 'string' ? document.createTextNode(icon) : icon]),
      el('div', { class: 'onboard-point-body' }, [el('b', { text: title }), el('p', { text })]),
    ]);
    const proStar = () => el('img', { class: 'onboard-pro-star', src: 'icons/emoji/pro-star.png', alt: '' });
    root.appendChild(el('div', { class: 'onboard-scroll onboard-welcome' }, [
      el('img', { class: 'onboard-logo', src: isPaidPlan() ? 'icons/icon-pro.png' : 'icons/icon-192.png', alt: '' }),
      el('h1', { class: 'onboard-h', text: 'Welcome to MyNotes' }),
      el('p', { class: 'onboard-sub', text: 'One simple place for your everyday money.' }),
      el('div', { class: 'onboard-points' }, [
        point('\u{1F9E0}', 'Track consciously. Spend intentionally.', 'No SMS or email scanning. Noting each spend yourself builds better habits.', 'onboard-kakeibo'),
        point('\u{1F512}', 'Your records never leave this phone', 'No account, no cloud. Just anonymous usage data, which you can switch off.'),
        ...(isPaidPlan()
          ? [point(proStar(), 'You are on the Pro Plan', 'Every feature is unlocked, and a guided yearly plan comes next.', 'onboard-pro-card')]
          : [
            point('\u{1F381}', 'Free Plan: any 5 features', 'Switch between them anytime without losing data. All basics and analysis included.'),
            point(proStar(), 'Pro Plan', 'Every feature unlocked, plus a guided yearly plan. Coming soon.', 'onboard-pro-card'),
          ]),
      ]),
    ]));
    root.appendChild(el('div', { class: 'onboard-bar onboard-bar-legal' }, [
      el('button', { class: 'btn primary', type: 'button', text: 'Get started', onclick: goChoose }),
      el('p', { class: 'legal-consent' }, [
        el('span', { text: 'By continuing you confirm you are 18 or older and agree to our ' }),
        el('a', { href: '#', text: 'Terms', onclick: (e) => { e.preventDefault(); openLegal('terms'); } }),
        el('span', { text: ' and ' }),
        el('a', { href: '#', text: 'Privacy Policy', onclick: (e) => { e.preventDefault(); openLegal('privacy'); } }),
        el('span', { text: '.' }),
      ]),
      // Which build this is, said plainly and quietly, so nobody has to dig for it.
      el('p', { class: 'legal-consent onboard-ver', text: 'MyNotes v' + APP_VERSION }),
    ]));
  });
}

// Shown when no features have been chosen yet: welcome flow on a fresh install,
// a required picker when data already exists (e.g. a restored backup).
async function maybeShowOnboarding() {
  try {
    if (isPaidPlan()) {
      // Pro: no feature picker, ever. Only the welcome and consent, and only when they have not been accepted yet.
      const acc = await DB.get('meta', 'legalAccepted').catch(() => null);
      // No confirmation yet: the welcome screen comes first and starts the setup once Get started is tapped.
      if (!(acc && acc.value)) { await openFeaturePicker({ first: true }); return; }
      await runPlanSetupIfNeeded();
      return;
    }
    if (await getEnabledModules()) return;
    // Data already here but no choice made (a restored backup): choose first,
    // Home is not shown until they do. A truly empty install gets the welcome.
    if ((await dataCount()) > 0) { await openFeaturePicker({ required: true }); return; }
    await openFeaturePicker({ first: true });
  } catch (_) {}
}

export function _homeCard(icon, title, sub, onclick) {
  // `icon` is usually an emoji string, but may be a DOM node (e.g. the metals
  // gold/silver-bar SVG) — append nodes, render strings as text.
  const ico = el('span', { class: 'home-card-ico' });
  if (icon && typeof icon === 'object' && icon.nodeType) ico.appendChild(icon);
  else ico.textContent = icon;
  // The badge slot is empty and hidden unless something fills it (see
  // _perDayBadge). It sits between the text and the chevron and is shorter than
  // the 52px icon, so a card that has one is exactly as tall as one that
  // does not.
  return el('button', { class: 'home-card', type: 'button', onclick }, [
    ico,
    el('span', { class: 'home-card-body' }, [
      el('span', { class: 'home-card-title', text: title }),
      el('span', { class: 'home-card-sub', text: sub }),
    ]),
    el('span', { class: 'home-card-badge hidden' }),
    el('span', { class: 'home-card-arrow', text: '›' }),
  ]);
}

// ---------- What a day can still take ----------
//
// Two things this got wrong in three places, which is how the same money came
// out as 228 a day on Home and 229 on the Tracker.
//
// THE DIVISOR. Days you can still spend on, TODAY INCLUDED: the 9th of a
// 30-day month leaves 22 of them, not 21, because the money in your pocket can
// be spent in the next hour. Deliberately NOT the same count as the forecast's
// "days left", which is the 21 days AFTER today - the figure it spreads covers
// only those, since today's spending is already counted in what has been spent.
// Both are right for their own question; showing them without saying which is
// what makes a per-day figure look wrong.
//
// THE ROUNDING. Floored, never rounded to nearest. This is an ALLOWANCE, and a
// figure rounded up says you can spend more than you have: 5,032 over 22 days
// is 228 a day, and at 229 you finish 6 short.
export function _spendableDaysLeft(ym, nowDate) {
  const now = nowDate || new Date();
  const thisYm = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  if (ym !== thisYm) return 0;
  return Math.max(1, _daysInYm(ym) - now.getDate() + 1);
}
export const perDayAllowance = (left, days) => (days > 0 ? Math.floor(round2(left) / days) : null);
// Said the same way everywhere it appears, so the divisor is never a mystery.
export const perDayLabel = (days) => days + (days === 1 ? ' day' : ' days') + ' left, today included';

// ---------- What a day still has in it ----------
//
// The one figure on Home meant to change a decision BEFORE it is made rather
// than explain one afterwards: not what is left this month, which is easy to
// spend against, but what is left per remaining day.
//
// The bands are a rule of thumb, not a calculation. Under 200 a day will not
// cover an ordinary day out, 200-300 is tight, and from 300 the month has room.
// Only the bottom band blinks - a badge that always moves stops being read.
const PER_DAY_LOW = 200;
const PER_DAY_MID = 300;
export function _perDayBadge(node, left, daysLeft) {
  if (!node) return;
  // Nothing honest to say: no budget set, or the month is already over.
  if (!(daysLeft > 0)) return;
  const over = left < 0;
  const perDay = over ? 0 : perDayAllowance(left, daysLeft);
  const band = over || perDay < PER_DAY_LOW ? 'is-low' : (perDay < PER_DAY_MID ? 'is-mid' : 'is-ok');
  node.innerHTML = '';
  node.className = 'home-card-badge ' + band;
  node.appendChild(el('span', { class: 'home-card-badge-val', text: over ? fmtIntCur(-left) : fmtIntCur(perDay) }));
  node.appendChild(el('span', { class: 'home-card-badge-cap', text: over ? 'over' : 'a day' }));
  node.title = over
    ? fmtSheetCur(-left) + ' over budget with ' + perDayLabel(daysLeft)
    : fmtSheetCur(left) + ' across ' + perDayLabel(daysLeft);
}

// Two stacked bullion bars (gold + silver) — the Metals launcher icon. Static
// markup, no user data, so innerHTML is safe here.
function _metalBarIcon() {
  return el('img', { src: 'icons/gold-bars.png', class: 'metal-bar-ico', alt: 'Gold bars' });
}

// The Personal Finance card's own icon - deliberately a DIFFERENT image from
// the section's add-spend FAB (#pfAddBtn in index.html) now: the two used to
// share one drawn wallet SVG "so Home and the section it opens are
// recognisably the one thing", but the user supplied two distinct icons
// (2026-09-16) and asked for them kept apart - a cash note for the card, a
// hand-with-₹ for the FAB.
export function _walletIcon() {
  return el('img', { src: 'icons/personal-finance.png', class: 'wallet-ico', alt: 'Personal Finance' });
}

// The copy button on a vault card. The clipboard emoji was the biggest, most
// colourful thing on the row after the entry's own icon, which put the loudest
// mark on the card next to the least interesting control - and at whatever
// size the platform font felt like. An outline instead: it takes the row's
// colour, sizes to the pixel, and reads as the standard copy mark everywhere.
export function _copyIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'copy-ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = '<rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2.4" fill="none" '
    + 'stroke="currentColor" stroke-width="1.8"/>'
    + '<path d="M15.4 4.6H6c-.8 0-1.4.6-1.4 1.4v9.4" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
}

export function _historyIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'edit-ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // A clock face with a back-turning arrow around it - "how this looked
  // before", the same read a wall clock's hands give for "what time was it".
  svg.innerHTML = '<path d="M12 4.5a7.5 7.5 0 1 1 -6.7 4.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    + '<path d="M4.6 4.8v3.8h3.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<path d="M12 8.2v4.1l2.8 1.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

export function _editIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'edit-ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = '<path d="M4.6 19.4h3.2L18.4 8.8a1.7 1.7 0 0 0 0-2.4l-.8-.8a1.7 1.7 0 0 0-2.4 0'
    + 'L4.6 16.2v3.2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
    + '<path d="M13.7 7.3l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
}

// ---------- Investment section page ----------
async function renderHomeInvestment() {
  const host = $('#investmentView');
  host.innerHTML = '';

  // Summary card with Total Invested and Total Earned
  const breakdown = await homeInvestedBreakdown();
  const totalInvested = breakdown.totalInvested;
  const totalValue = breakdown.totalValue;
  const totalEarned = totalValue - totalInvested;
  const totalEarnedPct = totalInvested > 0 ? (totalEarned / totalInvested) * 100 : 0;

  const summaryCard = el('div', { class: 'home-summary' }, [
    el('div', { class: 'summary-stat' }, [
      el('div', { class: 'stat-label' }, [
        'Total Invested',
        el('button', {
          class: 'info-btn', type: 'button', 'aria-label': 'What makes up Total Invested',
          title: 'What makes up this figure', text: 'i',
          onclick: (e) => { e.stopPropagation(); openInvestedBreakdown(breakdown); },
        }),
      ]),
      el('div', { class: 'stat-value', text: fmtIntCur(totalInvested) }),
    ]),
    el('div', { class: 'summary-stat' }, [
      el('div', { class: 'stat-label', text: 'Total Earned' }),
      el('div', { class: 'stat-value' }, [fmtIntCur(totalEarned) + ' ', el('span', { class: 'summary-badge ' + pctClass(totalEarnedPct), text: fmtPct(totalEarnedPct) })]),
    ]),
  ]);
  host.appendChild(summaryCard);

  // Investment cards
  const stockCard = _homeCard('📈', 'Stocks', 'Holdings · trends · news', () => setAppMode('stocks'));
  const mfCard = _homeCard('📊', 'Mutual Funds', 'SIPs · XIRR · 2030 goal', () => openMF());
  const fdCard = _homeCard('🏦', 'Fixed Deposits', 'FD ladder · maturity · interest', () => setAppMode('fd'));
  const metalCard = _homeCard(_metalBarIcon(), 'Metals', 'gold · silver', () => openMetal());
  const bondCard = _homeCard('🧾', 'Bonds', 'coupon · maturity · vs bank', () => openBond());

  const _im = await getEnabledModules();
  host.appendChild(el('div', { class: 'home-cards' }, [
    modOn(_im, 'stocks') ? stockCard : null, modOn(_im, 'mf') ? mfCard : null, modOn(_im, 'fd') ? fdCard : null,
    modOn(_im, 'metal') ? metalCard : null, modOn(_im, 'bond') ? bondCard : null,
  ].filter(Boolean)));

  // Live stats
  try {
    const meInStocks = (await DB.byPortfolio('stocks', 'me-in')) || [];
    const holdings = meInStocks.filter(s => s.status === 'holding' && !isSgb(s));
    const stockSub = stockCard.querySelector('.home-card-sub');
    if (holdings.length && stockSub) {
      const invested = holdings.reduce((s, stock) => s + (Number(stock.units || 0) * Number(stock.buyPrice || 0)), 0);
      stockSub.textContent = `${holdings.length} stocks · ${fmtIntCur(invested)} invested`;
    }

    const funds = (await DB.byIndex('funds', 'owner', 'me')) || [];
    const investing = funds.filter(f => f.status !== 'Sold' && !f.soldDate);
    const sub = mfCard.querySelector('.home-card-sub');
    if (investing.length && sub) {
      const mfMod = await import('./mf.js');
      const invested = investing.reduce((s, f) => s + (mfMod.investedOf(f) || 0), 0);
      sub.textContent = `${investing.length} funds · ${fmtIntCur(invested)} invested`;
    }

    const fdList = (await DB.byIndex('fds', 'owner', 'me')) || [];
    if (fdList.length) {
      const fdMod = await import('./fd.js');
      const nowT = Date.now();
      const fdByIdC = new Map(fdList.map((x) => [x.id, x]));
      const fdCacheC = new Map();
      const activeFds = fdList.map((x) => fdMod.resolveChain(x, fdByIdC, nowT, fdCacheC)).filter((c) => c.effectiveStatus === 'active');
      const activeCount = activeFds.length;
      const invested = activeFds.reduce((s, c) => s + (Number(c.principal) || 0), 0);
      const fdSub = fdCard.querySelector('.home-card-sub');
      if (fdSub) fdSub.textContent = `${activeCount} active · ${fmtIntCur(invested)} invested`;
    }

    const mp = await metalPortfolio();
    const metalSub = metalCard.querySelector('.home-card-sub');
    if (mp.hasTxns || mp.gold.sgbCount) {
      const inv = mp.gold.invested + mp.silver.invested;
      if (metalSub) metalSub.textContent = `Gold ${_gramsShort(mp.gold.grams)}g · Silver ${_gramsShort(mp.silver.grams)}g · ${fmtIntCur(inv)} invested`;
    } else if (metalSub && mp.gold.sgbCount) {
      metalSub.textContent = 'gold · silver · SGB';
    }

    const bondList = (await DB.byIndex('bonds', 'owner', 'me')) || [];
    if (bondList.length) {
      const bondMod = await import('./bonds.js');
      const nowBnd = Date.now();
      const activeBonds = bondList.map((x) => bondMod.computeBond(x, nowBnd)).filter((c) => c.effectiveStatus === 'active');
      const invested = activeBonds.reduce((s, c) => s + (Number(c.outstandingPrincipal) || 0), 0);
      const bondSub = bondCard.querySelector('.home-card-sub');
      if (bondSub) bondSub.textContent = `${activeBonds.length} active · ${fmtIntCur(invested)} invested`;
    }

  } catch (_) {}
}

// ---------- Savings section page ----------
async function renderHomeSavings() {
  const host = $('#savingsView');
  host.innerHTML = '';

  const efCard = _homeCard('🚨', 'Emergency Fund', 'targets · loans · corpus', () => openEmergency());
  const divCard = _homeCard('💰', 'Dividends', 'per-stock · yearly · YoY', () => openDividend());
  const bankSavCard = _homeCard('🐷', 'Bank Savings', 'per-bank balances', () => setAppMode('banksav'));
  const inflationCard = _homeCard('📉', 'Inflation Calculator', 'today’s value of a future amount', () => openInflationCalculator());
  const _sm = await getEnabledModules();
  host.appendChild(el('div', { class: 'home-cards' }, [
    modOn(_sm, 'ef') ? efCard : null, modOn(_sm, 'div') ? divCard : null,
    modOn(_sm, 'banksav') ? bankSavCard : null, modOn(_sm, 'inflation') ? inflationCard : null,
  ].filter(Boolean)));

  try {
    const rows = (await DB.all('bankSavings')) || [];
    const sub = bankSavCard.querySelector('.home-card-sub');
    if (rows.length && sub) {
      const total = rows.reduce((s, r) => s + (Number(r.balance) || 0), 0);
      sub.textContent = `${rows.length} account${rows.length === 1 ? '' : 's'} · ${fmtIntCur(total)}`;
    }

    const divMod = await import('./dividend.js');
    const divList = await _eligibleDividendRecords(divMod, { write: false });
    if (divList.length) {
      const inRows = divList.filter((d) => d.market === 'in');
      const curYear = new Date().getFullYear();
      const inThisYr = inRows.reduce((s, d) => s + divMod.yearTotal(d, curYear), 0);
      const divSub = divCard.querySelector('.home-card-sub');
      if (divSub) divSub.textContent = `${divList.length} stocks · ${fmtIntCur(inThisYr)} in ${curYear}`;
    }
  } catch (_) {}
}

// Default only - the user's own figure (meta.inflationRatePct) always wins
// once they edit and save it, same pattern as meta.metalDomesticPremium.
const DEFAULT_INFLATION_PCT = 4.82;

async function _inflationRatePct() {
  const row = await DB.get('meta', 'inflationRatePct').catch(() => null);
  return row && row.value != null ? Number(row.value) : DEFAULT_INFLATION_PCT;
}

// Present-day equivalent of a future rupee amount: what a sum you'll have
// (or need) in some future year is actually worth in today's money, given
// average inflation between now and then. PV = FV / (1 + rate)^years - the
// same discounting math a "real return" or retirement-corpus estimate uses,
// just standing alone here as a quick what-if.
async function openInflationCalculator() {
  const savedRate = await _inflationRatePct();
  const thisYear = new Date().getFullYear();

  const rateInput = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: savedRate });
  const amtInput = el('input', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: '₹ amount' });
  const yearInput = el('input', { type: 'number', inputmode: 'numeric', step: '1', value: thisYear + 10 });

  const readout = el('div', { class: 'ef-proj-big' });

  const refresh = () => {
    readout.innerHTML = '';
    const amt = num(amtInput.value);
    const rate = num(rateInput.value);
    const year = num(yearInput.value);
    if (!(amt > 0) || rate == null) {
      readout.appendChild(el('div', { class: 'hint', text: 'Enter an amount to see its value in today’s money.' }));
      return;
    }
    const years = year != null ? year - thisYear : 0;
    if (!(years > 0)) {
      readout.appendChild(el('div', { class: 'hint', text: 'Pick a year after ' + thisYear + '.' }));
      return;
    }
    const presentValue = amt / Math.pow(1 + rate / 100, years);
    readout.appendChild(el('div', { class: 'label', text: fmtIntCur(amt) + ' in ' + year + ' is worth, today' }));
    readout.appendChild(el('div', { class: 'big', text: fmtIntCur(presentValue) }));
    readout.appendChild(el('div', { class: 'hint', text:
      years + ' year' + (years === 1 ? '' : 's') + ' away, at ' + rate.toFixed(2) + '% average inflation' }));
  };

  amtInput.addEventListener('input', refresh);
  yearInput.addEventListener('input', refresh);
  rateInput.addEventListener('input', refresh);
  // Saved only once the user moves on from the field, not on every
  // keystroke - editing "4.82" one digit at a time shouldn't write to the
  // DB four times before they've finished typing.
  rateInput.addEventListener('change', () => {
    const rate = num(rateInput.value);
    if (rate != null) DB.put('meta', { key: 'inflationRatePct', value: rate }).catch(() => {});
  });

  refresh();

  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Inflation Calculator' }),
    el('p', { class: 'hint', text: 'What a future rupee amount is actually worth in today’s money, given average inflation between now and then.' }),
    field('Inflation rate (% per year)', rateInput),
    field('Amount', amtInput),
    field('Year', yearInput),
    readout,
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}


// ---------- heatmap (sheet-style grid) ----------
// Color buckets matching the spreadsheet: reds (negative), greens (0-100%), blues (>100%).
function heatColor(p) {
  if (p == null || isNaN(p)) return null;
  if (p <= -50) return ['#7f0000', '#fff'];
  if (p <= -30) return ['#c62828', '#fff'];
  if (p <= -10) return ['#ef5350', '#fff'];
  if (p < 0)    return ['#ff8a80', '#3b0000'];
  if (p < 10)   return ['#dcedc8', '#1b3a0e'];
  if (p < 30)   return ['#aed581', '#1b3a0e'];
  if (p < 50)   return ['#81c784', '#0c2a12'];
  if (p < 80)   return ['#4caf50', '#fff'];
  if (p < 100)  return ['#2e7d32', '#fff'];
  if (p < 110)  return ['#bbdefb', '#0a2a4a'];
  if (p < 130)  return ['#90caf9', '#0a2a4a'];
  if (p < 150)  return ['#64b5f6', '#06243a'];
  if (p < 180)  return ['#42a5f5', '#fff'];
  if (p < 200)  return ['#1e88e5', '#fff'];
  return ['#0d47a1', '#fff'];
}
const HEAT_LEGEND = [
  ['> -50%', '#7f0000', '#fff'], ['-30 to -50%', '#c62828', '#fff'], ['-10 to -30%', '#ef5350', '#fff'], ['-1 to -10%', '#ff8a80', '#3b0000'],
  ['0-10%', '#dcedc8', '#1b3a0e'], ['10-30%', '#aed581', '#1b3a0e'], ['30-50%', '#81c784', '#0c2a12'], ['50-80%', '#4caf50', '#fff'], ['80-100%', '#2e7d32', '#fff'],
  ['101-110%', '#bbdefb', '#0a2a4a'], ['110-130%', '#90caf9', '#0a2a4a'], ['130-150%', '#64b5f6', '#06243a'], ['150-180%', '#42a5f5', '#fff'], ['180-200%', '#1e88e5', '#fff'], ['200%+', '#0d47a1', '#fff'],
];
function shortMonth(label) {
  const p = (label || '').split(' ');
  return p.length === 2 ? p[0].slice(0, 3) + " '" + p[1].slice(2) : label;
}

const HM_STAR_SVG = '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 17.3l-5.5 3 1-6.1-4.5-4.3 6.2-.9L12 3l2.8 5.6 6.2.9-4.5 4.3 1 6.1z"/></svg>';

// Heatmap-only bookmark toggle: comparing month-by-month returns here is the
// whole point of the tab, so this is where "flag this one for investing"
// naturally happens. Persists on the stock record itself (`bookmarked`),
// writes immediately on tap - no Save step, same as starring an email.
function _heatmapBookmarkBtn(s, onChange) {
  const setState = (btn) => {
    btn.classList.toggle('active', !!s.bookmarked);
    const label = s.bookmarked ? 'Bookmarked for investing - tap to remove' : 'Bookmark for investing';
    btn.title = label;
    btn.setAttribute('aria-label', label);
  };
  const btn = el('button', { type: 'button', class: 'hm-bookmark' });
  btn.innerHTML = HM_STAR_SVG;
  setState(btn);
  btn.addEventListener('click', async () => {
    s.bookmarked = !s.bookmarked;
    setState(btn);
    // The basket below reads these, so it is redrawn rather than left stale -
    // just that panel, not the whole grid, which would throw away the
    // horizontal scroll position the user is in the middle of using.
    if (onChange) onChange();
    try { await DB.put('stocks', s); } catch (_) {}
  });
  return btn;
}

function renderHeatmap() {
  const host = $('#heatmapView');
  host.innerHTML = '';
  const stocks = state.stocks.filter((s) => s.status !== 'sold').sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const monthMap = new Map();
  stocks.forEach((s) => (s.history || []).forEach((h) => { const ym = labelToYm(h.month); if (ym) monthMap.set(ym, h.month); }));
  const months = [...monthMap.keys()].sort().map((ym) => ({ ym, label: monthMap.get(ym) }));

  if (!stocks.length || !months.length) {
    host.appendChild(el('div', { class: 'empty' }, [el('p', { text: 'No monthly returns yet to map. Add month-end % to your stocks, or import your sheet.' })]));
    return;
  }

  const table = el('table', { class: 'heatmap' });
  const htr = el('tr', {}, [el('th', { class: 'corner', text: 'Stock' })]);
  months.forEach((m) => htr.appendChild(el('th', { text: shortMonth(m.label) })));
  table.appendChild(el('thead', {}, [htr]));

  // Best/worst STOCK for each month, column-wise across every stock - which
  // one had the highest and lowest return that specific month. Distinct from
  // the 👍/👎 below (a stock's own best/worst month, row-wise): that one asks
  // "was this a good month for THIS stock", this asks "was THIS stock the
  // best pick that month" - so it gets its own corner (top-left vs bottom-
  // right) rather than fighting the same spot.
  const monthStockPct = new Map();
  stocks.forEach((s) => {
    (s.history || []).forEach((h) => {
      const ym = labelToYm(h.month);
      if (ym && typeof h.pct === 'number') {
        if (!monthStockPct.has(ym)) monthStockPct.set(ym, []);
        monthStockPct.get(ym).push({ name: s.name, pct: h.pct });
      }
    });
  });
  const monthBestName = {}, monthWorstName = {};
  monthStockPct.forEach((arr, ym) => {
    if (arr.length < 2) return; // nothing to compare against with only one stock reporting
    let best = arr[0], worst = arr[0];
    arr.forEach((x) => { if (x.pct > best.pct) best = x; if (x.pct < worst.pct) worst = x; });
    if (best.name !== worst.name) { monthBestName[ym] = best.name; monthWorstName[ym] = worst.name; }
  });

  const tbody = el('tbody');
  stocks.forEach((s) => {
    const byYm = {};
    (s.history || []).forEach((h) => { const ym = labelToYm(h.month); if (ym) byYm[ym] = h.pct; });
    // Best (👍) and worst (👎) month for this stock.
    let maxYm = null, minYm = null, maxV = -Infinity, minV = Infinity;
    Object.keys(byYm).forEach((ym) => { const v = byYm[ym]; if (typeof v === 'number') { if (v > maxV) { maxV = v; maxYm = ym; } if (v < minV) { minV = v; minYm = ym; } } });
    const tr = el('tr', {}, [el('th', { class: 'rowhead' }, [
      el('div', { class: 'hm-name-row' }, [
        _heatmapBookmarkBtn(s, () => drawBasket()),
        el('div', { class: 'hm-name', text: s.name || '(unnamed)' }),
      ]),
      s.category ? el('div', { class: 'hm-cat', text: s.category }) : document.createTextNode(''),
    ])]);
    months.forEach((m) => {
      const p = byYm[m.ym];
      const td = el('td');
      const c = heatColor(p);
      if (c) {
        td.style.background = c[0]; td.style.color = c[1];
        td.appendChild(document.createTextNode(p.toFixed(2) + '%'));
        if (m.ym === maxYm) td.appendChild(el('span', { class: 'hm-sticker', text: '👍' }));
        else if (m.ym === minYm) td.appendChild(el('span', { class: 'hm-sticker', text: '👎' }));
        // Trophy/falling-chart rather than thumbs - those are already taken by
        // .hm-sticker for a different question (a stock's own best/worst
        // month), so this pair needed its own distinct icons.
        if (monthBestName[m.ym] === s.name) {
          td.appendChild(el('span', { class: 'hm-col-sticker hm-col-best', text: '🏆', title: (s.name || '') + ' — highest return in ' + shortMonth(m.label) }));
        } else if (monthWorstName[m.ym] === s.name) {
          td.appendChild(el('span', { class: 'hm-col-sticker hm-col-worst', text: '🏋️', title: (s.name || '') + ' — lowest return in ' + shortMonth(m.label) }));
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(el('div', { class: 'heatmap-scroll' }, [table]));

  // ---- What the bookmarks would cost ----
  //
  // The heatmap is where a stock gets flagged for buying, so the question that
  // flag raises belongs here too: if I act on all of them, what does the
  // smallest real version of that cost? One share of each, at today's price.
  //
  // A bookmarked stock with no current price is COUNTED but not priced, and
  // said so out loud. Treating a missing price as zero would quietly understate
  // the basket, which is the one thing this figure exists to get right.
  const cur = curOf(state.portfolio);
  const bmPanel = el('div', { class: 'hm-basket' });
  function drawBasket() {
    const marked = stocks.filter((x) => x.bookmarked);
    const priced = marked.filter((x) => Number(x.currentPrice) > 0);
    const basket = round2(priced.reduce((a, x) => a + Number(x.currentPrice), 0));
    const unpriced = marked.length - priced.length;
    bmPanel.innerHTML = '';
    bmPanel.classList.toggle('is-empty', !marked.length);
    if (!marked.length) {
      bmPanel.appendChild(el('div', { class: 'hm-basket-empty',
        text: 'Nothing bookmarked. Tap the star beside a name and the cost of one share of each lands here.' }));
      return;
    }
    const list = el('div', { class: 'hm-basket-list hidden' }, marked
      .slice().sort((a, b) => (Number(b.currentPrice) || 0) - (Number(a.currentPrice) || 0))
      .map((x) => el('div', { class: 'hm-basket-row' }, [
        el('span', { class: 'hm-basket-name', text: x.name || '(unnamed)' }),
        el('span', { class: 'hm-basket-price' + (Number(x.currentPrice) > 0 ? '' : ' is-none'),
          text: Number(x.currentPrice) > 0 ? fmtCur(Number(x.currentPrice), cur) : 'no price' }),
      ])));
    const head = el('button', { type: 'button', class: 'hm-basket-head' }, [
      el('span', { class: 'hm-basket-star', text: '★' }),
      el('span', { class: 'hm-basket-body' }, [
        el('span', { class: 'hm-basket-count',
          text: marked.length + (marked.length === 1 ? ' stock bookmarked' : ' stocks bookmarked') }),
        el('span', { class: 'hm-basket-sub', text: 'one share of each'
          + (unpriced ? ' · ' + unpriced + ' without a price' : '') }),
      ]),
      el('span', { class: 'hm-basket-total', text: fmtCur(basket, cur) }),
      el('span', { class: 'hm-basket-chev' }),
    ]);
    head.addEventListener('click', () => {
      const closed = list.classList.toggle('hidden');
      head.classList.toggle('is-open', !closed);
    });
    bmPanel.appendChild(head);
    bmPanel.appendChild(list);
  }
  drawBasket();
  host.appendChild(bmPanel);

  const legend = el('div', { class: 'heat-legend' });
  HEAT_LEGEND.forEach(([t, bg, fg]) => { const c = el('span', { class: 'hl', text: t }); c.style.background = bg; c.style.color = fg; legend.appendChild(c); });
  host.appendChild(el('div', { class: 'legend-wrap' }, [el('h3', { text: 'Scale' }), legend]));
}

// ---------- theme (auto by time of day) ----------
function applyTheme() {
  const h = new Date().getHours();
  const light = h >= 7 && h < 19; // daytime = light
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', light ? '#eef2f9' : '#0e1726');
}

// ---------- modals ----------
let escHandler = null;
export function openModal(node) {
  const host = $('#modalHost');
  host.innerHTML = '';
  host.appendChild(node);
  host.classList.remove('hidden');
  host.setAttribute('aria-hidden', 'false');
  host.onclick = (e) => { if (e.target === host) closeModal(); };
  escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', escHandler);
}
export function closeModal() {
  const host = $('#modalHost');
  host.classList.add('hidden');
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = '';
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null; }
}
// Plain-language meanings for terms a newcomer will not know. helpDot() puts a
// small (i) beside a label; tapping it opens the meaning.
const GLOSSARY = {
  xirr: ['XIRR', 'Your real yearly return. Unlike a simple percentage it counts WHEN each rupee went in, so a fund you added to every month is judged fairly.'],
  nav: ['NAV', 'Net Asset Value: the price of one unit of a mutual fund today. Your value is units held x NAV.'],
  sip: ['SIP', 'Systematic Investment Plan: a fixed amount you invest in a fund every month.'],
  compounding: ['Compounding', 'How often the bank adds interest to your deposit. More often means slightly more money, because interest then earns interest.'],
  payoutType: ['Cumulative or Payout', 'Cumulative: interest stays in and grows, and you get everything at the end. Payout: interest is paid to you along the way and the deposit stays the same.'],
  coupon: ['Coupon rate', 'The yearly interest a bond pays, as a percentage of the amount you invested.'],
  interestPayout: ['Interest payout', 'How often the bond pays you its interest: monthly, quarterly, yearly, or once at the end.'],
  principalRepaid: ['Principal repaid', 'When your invested money comes back. Usually all at maturity; some bonds return it in instalments.'],
  ladder: ['How a target counts', 'Adds on top: this target is extra, on top of the ones below. Replaces the previous: this target already includes the one below it (a joint fund that covers the single-person one), so it is not added twice.'],
};
export function helpDot(term) {
  const g = GLOSSARY[term];
  if (!g) return null;
  return el('button', { class: 'help-dot', type: 'button', 'aria-label': 'What is ' + g[0] + '?', text: 'i',
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); openInfoSheet(g[0], g[1]); } });
}
// Advanced fields tuck behind "More options". Opens by itself when the record
// already uses one of them, so nothing that has data is ever hidden.
export const moreOptions = (children, open) => {
  const d = el('details', { class: 'more-opts' }, [el('summary', { text: 'More options' })].concat(children));
  if (open) d.open = true;
  return d;
};
export const field = (labelText, inputNode, help) => el('div', { class: 'field' }, [el('label', { text: labelText }, help ? [helpDot(help)] : null), inputNode]);

// A segmented control over a short list of options, exposing the same `.value`
// a <select> does so a caller reading it does not care which one it got. For a
// choice with two or three options that CHANGES WHAT THE REST OF THE FORM
// SHOWS — there, hiding the options behind a closed dropdown hides the
// consequence too.
export function segChoice(options, initial, onChange) {
  const btns = [];
  let cur = initial;
  const node = el('div', { class: 'seg' }, options.map(([v, label]) => {
    const btn = el('button', { type: 'button', class: v === cur ? 'active' : '', text: label });
    btn.addEventListener('click', () => {
      if (cur === v) return;
      cur = v;
      btns.forEach((x) => x.classList.toggle('active', x === btn));
      if (onChange) onChange(v);
    });
    btns.push(btn);
    return btn;
  }));
  return { node, get value() { return cur; } };
}

// A note field that reads as a designed component rather than a bare textarea:
// a labelled panel, an input with no frame of its own so the panel IS the
// field, and a line saying where the note turns up later. It grows with the
// text instead of putting a scrollbar inside three fixed lines.
//
// The character counter stays hidden until the limit is close enough to matter,
// so it is feedback when needed rather than a permanent gauge.
const NOTE_MAX = 500;
const NOTE_WARN_AT = 100;   // characters remaining
export function noteField(value, placeholder, footHint, label) {
  const ta = el('textarea', {
    class: 'note-input', rows: '2', maxlength: String(NOTE_MAX),
    placeholder: placeholder || '',
  });
  ta.value = value || '';
  const count = el('span', { class: 'note-count hidden' });
  const grow = () => {
    // Reset first: without it the box can only ever get taller, never shrink
    // back when text is deleted.
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 190) + 'px';
    const left = NOTE_MAX - ta.value.length;
    count.textContent = left + ' left';
    count.classList.toggle('hidden', left > NOTE_WARN_AT);
  };
  ta.addEventListener('input', grow);
  const node = el('div', { class: 'note-field' }, [
    el('div', { class: 'note-field-head' }, [
      el('span', { class: 'note-field-ico', text: '📝' }),
      el('span', { class: 'note-field-label', text: label || 'Note' }),
      count,
    ]),
    ta,
    footHint ? el('div', { class: 'note-field-foot', text: footHint }) : document.createTextNode(''),
  ]);
  // Sizing needs layout, which does not exist until the sheet is on screen.
  requestAnimationFrame(grow);
  return { node, input: ta };
}

// A form section: an uppercase heading over a group of fields. Same shape as the
// Allocation form's sections, which is where the pattern comes from.
export function formSection(icon, title, children) {
  return el('div', { class: 'form-sec' }, [
    el('div', { class: 'form-sec-head' }, [
      el('span', { class: 'form-sec-icon', text: icon }),
      el('h3', { class: 'form-sec-title', text: title }),
    ]),
  ].concat(children));
}

// Editable list of month-end returns. Dedupes by month (last wins) so re-entering
// a month never creates duplicate history.
function buildHistoryEditor(history) {
  const rowsWrap = el('div', { class: 'hist-rows' });
  const refs = [];
  const addRow = (month, pct) => {
    const ymVal = month ? (labelToYm(month) || '') : thisYm();
    const ym = el('input', { type: 'month', value: ymVal });
    const pc = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: pct != null ? pct : '', placeholder: '% return' });
    const ref = { ym, pc, removed: false };
    // Only the current month is deletable, so past months can't be removed by mistake.
    const isCurrent = ymVal === thisYm();
    const tail = isCurrent ? el('button', { class: 'icon-btn', type: 'button', text: '×' }) : el('span', { class: 'hist-lock' });
    const row = el('div', { class: 'hist-row' }, [ym, pc, tail]);
    if (isCurrent) tail.addEventListener('click', () => { row.remove(); ref.removed = true; });
    refs.push(ref);
    rowsWrap.appendChild(row);
  };
  (history || []).slice()
    .sort((a, b) => (labelToYm(b.month) || '').localeCompare(labelToYm(a.month) || '')) // newest first
    .forEach((h) => addRow(h.month, h.pct));
  const node = el('div', {}, [rowsWrap, el('button', { class: 'btn ghost small', type: 'button', text: '+ Add month', onclick: () => addRow(null, null) })]);
  const collect = () => {
    const map = new Map();
    for (const r of refs) {
      if (r.removed) continue;
      const ymv = r.ym.value, pv = num(r.pc.value);
      if (!ymv || pv == null) continue;
      map.set(ymv, { month: ymToLabel(ymv), pct: Math.round(pv * 100) / 100 });
    }
    return Array.from(map.keys()).sort().map((k) => map.get(k));
  };
  return { node, collect };
}

function openStockForm(existing) {
  const isEdit = !!(existing && existing.id != null);
  const s = Object.assign({ status: 'holding', conviction: '' }, existing || {});

  const name = el('input', { type: 'text', value: s.name || '', placeholder: 'e.g. Tata Power' });
  const catList = el('datalist', { id: 'catlist' }, CATEGORIES.map((c) => el('option', { value: c })));
  const category = el('input', { type: 'text', value: s.category || '', list: 'catlist', placeholder: 'Category' });
  const conviction = el('select', {}, CONVICTIONS.map((c) => {
    const o = el('option', { value: c.v, text: c.label });
    if (c.v === (s.conviction || '')) o.selected = true;
    return o;
  }));
  const status = el('select', {}, [['holding', 'Holding'], ['sold', 'Sold']].map(([v, t]) => {
    const o = el('option', { value: v, text: t });
    if (v === s.status) o.selected = true;
    return o;
  }));
  const numInput = (val, ph) => el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: val != null ? val : '', placeholder: ph });
  const units = numInput(s.units, '0');
  const buyPrice = numInput(s.buyPrice, '0');
  const currentPrice = numInput(s.currentPrice, '0');
  // Which year this holding started — drives how many years the card shows
  // ("Since 2020 · 7 yrs") and, for a dividend-tracked stock, how far back
  // the Dividends form's year slider reaches (there's no "+ Add year" button
  // there any more — see openDivForm — so this is the only way to reach a
  // year further back than one with existing dividend data).
  const startYear = el('input', { type: 'number', inputmode: 'numeric', step: '1', value: s.startYear != null ? s.startYear : '', placeholder: 'e.g. 2020' });
  const soldPrice = numInput(s.soldPrice, '0');
  const soldUnits = numInput(s.soldUnits, 'units sold');
  const soldDate = el('input', { type: 'date', value: s.soldDate || todayISO() });
  const divAvailable = el('input', { type: 'checkbox' });
  divAvailable.checked = !!s.divAvailable;
  const divSwitch = el('label', { class: 'switch' }, [
    divAvailable,
    el('span', { class: 'switch-track' }, [el('span', { class: 'switch-thumb' })]),
  ]);

  const soldBlock = el('div', { class: 'sold-only' + (s.status === 'sold' ? '' : ' hidden') }, [
    el('div', { class: 'field-row' }, [field('Sold price', soldPrice), field('Units sold', soldUnits)]),
    field('Sold date', soldDate),
    el('p', { class: 'hint', text: 'After selling, keep updating "Current price". If it falls below your sold price it was a good exit; if it rises above, you sold early.' }),
  ]);
  status.addEventListener('change', () => soldBlock.classList.toggle('hidden', status.value !== 'sold'));

  const lh = latestHist(s);
  const bname = benchmarkName(state.portfolio);
  const histEditor = buildHistoryEditor(s.history);
  const histCount = (s.history && s.history.length) || 0;
  // With a chart present, the list hides until the chart is tapped; with no
  // history yet there's no chart, so show the editor straight away.
  const editorWrap = el('div', { class: histCount ? 'hidden' : '' }, [histEditor.node]);

  let chartNode = document.createTextNode('');
  if (histCount) {
    const benchByYm = {};
    state.months.forEach((mo) => { if (mo.nifty != null) benchByYm[mo.ym] = mo.nifty; });
    const histByYm = {};
    s.history.forEach((h) => { const y = labelToYm(h.month); if (y && typeof h.pct === 'number') histByYm[y] = h.pct; });
    const yms = Object.keys(histByYm).sort();
    // Plot over every month in the span (nulls for untracked months) so a sold-then-
    // rebought stock shows a real gap instead of one continuous line.
    const axis = yms.length ? monthRange(yms[0], yms[yms.length - 1]) : [];
    const stockVals = axis.map((ym) => (histByYm[ym] != null ? histByYm[ym] : null));
    const levels = axis.map((ym) => (benchByYm[ym] != null ? benchByYm[ym] : null));
    let base = null;
    for (const v of levels) { if (v != null) { base = v; break; } }
    const stockFirst = stockVals.find((v) => v != null && !isNaN(v)) || 0;
    const hasBench = base != null && levels.filter((v) => v != null).length >= 2;
    // Align Nifty to the stock's first point so the lines start together and you see divergence.
    const benchVals = hasBench ? levels.map((v) => (v != null ? stockFirst + (v / base - 1) * 100 : null)) : null;
    const series = [{ values: stockVals, color: '#38bdf8' }];
    if (benchVals) series.push({ values: benchVals, color: '#fbbf24', dash: '4 3' });

    const card = el('div', { class: 'chart-card tappable' }, [multiSparkline(series, 320, 90, '')]);
    card.appendChild(el('div', { class: 'hint' }, [
      el('span', { style: 'color:#38bdf8', text: '- Stock' }),
      benchVals ? el('span', { style: 'color:#fbbf24', text: ' - ' + bname }) : document.createTextNode(''),
      lh ? ' · Latest ' + lh.month + ' ' + fmtPct(lh.pct) : '',
    ]));
    card.appendChild(el('div', { style: 'text-align:center' }, [el('span', { class: 'tap-hint', text: 'tap to edit' })]));
    card.addEventListener('click', () => editorWrap.classList.toggle('hidden'));
    chartNode = card;
  }

  const histBlock = el('div', { class: 'field' }, [
    el('label', { text: 'Monthly returns (month-end %)' }),
    chartNode,
    editorWrap,
  ]);

  const save = async () => {
    if (!name.value.trim()) { toast('Name is required'); return; }
    const sold = status.value === 'sold';
    const buyP = num(buyPrice.value), curP = num(currentPrice.value);
    const hist = histEditor.collect();
    // Holding with both prices known -> auto-set THIS month's return from the price
    // (overwrites the current month, so updating the price never makes duplicates).
    if (!sold && buyP && curP) {
      const pct = Math.round(((curP - buyP) / buyP) * 10000) / 100;
      const lbl = ymToLabel(thisYm());
      const i = hist.findIndex((h) => h.month === lbl);
      if (i >= 0) hist[i] = { month: lbl, pct };
      else hist.push({ month: lbl, pct });
      hist.sort((a, b) => (labelToYm(a.month) || '').localeCompare(labelToYm(b.month) || ''));
    }
    const rec = {
      portfolio: state.portfolio,
      name: name.value.trim(),
      category: category.value.trim(),
      conviction: conviction.value,
      status: status.value,
      units: num(units.value),
      buyPrice: buyP,
      currentPrice: curP,
      startYear: startYear.value !== '' ? (num(startYear.value) || null) : null,
      soldPrice: sold ? num(soldPrice.value) : null,
      soldUnits: sold ? num(soldUnits.value) : null,
      soldDate: sold ? (soldDate.value || todayISO()) : null,
      divAvailable: divAvailable.checked,
      history: hist,
      updatedAt: new Date().toISOString(),
    };
    if (isEdit) { rec.id = s.id; rec.createdAt = s.createdAt || rec.updatedAt; }
    else rec.createdAt = rec.updatedAt;
    await DB.put('stocks', rec);
    closeModal();
    toast(isEdit ? 'Saved' : 'Added');
    refresh();
  };

  const del = async () => {
    if (!(await appConfirm('Delete ' + (s.name || 'this stock') + '?'))) return;
    await DB.del('stocks', s.id);
    closeModal();
    toast('Deleted');
    refresh();
  };

  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: isEdit ? 'Edit stock' : 'Add stock' }),
    catList,
    field('Name', name),
    el('div', { class: 'field-row' }, [field('Category', category), field('Conviction', conviction)]),
    field('Status', status),
    el('div', { class: 'field-row' }, [field('Units held', units), field('Avg buy price', buyPrice)]),
    el('div', { class: 'field-row' }, [field('Current price', currentPrice), field('Started (year)', startYear)]),
    soldBlock,
    histBlock,
    field('Dividend available — shows this stock on the Dividends page', divSwitch),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: isEdit ? 'Save' : 'Add', onclick: save }),
    ]),
    isEdit ? el('div', { class: 'btn-row' }, [el('button', { class: 'btn danger', text: 'Delete this stock', onclick: del })]) : document.createTextNode(''),
  ]));
}

function saveSnapshot() {
  const cur = curOf(state.portfolio);
  const s = summarize(state.stocks);
  const benchmark = el('input', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'e.g. Nifty 50 level (optional)' });
  const dateInput = el('input', { type: 'date', value: todayISO() });
  const save = async () => {
    await DB.put('snapshots', {
      portfolio: state.portfolio,
      date: dateInput.value || todayISO(),
      totalInvested: s.invested,
      totalValue: s.value,
      totalPL: s.pl,
      plPct: s.plPct,
      positives: s.up,
      negatives: s.down,
      count: s.holdings,
      benchmark: num(benchmark.value),
      createdAt: new Date().toISOString(),
    });
    closeModal();
    toast('Snapshot saved');
    refresh();
  };
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Save snapshot' }),
    el('p', { class: 'hint', text: 'Stores this portfolio\'s totals for ' + dateInput.value + ': value ' + fmtCur(s.value, cur) + ', P/L ' + fmtPct(s.plPct) + '.' }),
    field('Date', dateInput),
    field('Benchmark (optional)', benchmark),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', text: 'Save', onclick: save }),
    ]),
  ]));
}

export function menuItem(icon, title, desc, onclick) {
  return el('button', { onclick }, [el('span', { text: icon }), el('div', {}, [el('div', { text: title }), el('div', { class: 'desc', text: desc })])]);
}
async function clearAllDataFlow() {
  if (!(await appConfirm('Erase ALL data on this device? This deletes every record, setting and password, and cannot be undone. Make a backup first if you need one.'))) return;
  if (!(await appConfirm('Last check: really wipe everything and start from the beginning?'))) return;
  try {
    await Promise.race([requestForget().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await wipeAllData();
    try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
    location.reload();
  } catch (e) { appAlert('Could not clear data: ' + e.message); }
}
// A random per-install id, created on first run. It identifies the install, never
// the person: it is not derived from the device, the name or anything the user types,
// and it is the only thing that will ever tag the planned usage counts.
// Proof of what was accepted and when: which version of the Terms/Privacy text (its
// date), that the user confirmed being 18+, and the time. Written once, on the welcome
// screen's Get started. Lives in meta, so it needs no schema change.
export async function recordLegalAcceptance() {
  await DB.put('meta', { key: 'legalAccepted', value: { version: LEGAL_UPDATED, adult: true, at: new Date().toISOString() } }).catch(() => {});
}
export async function getInstallId() {
  const r = await DB.get('meta', 'installId').catch(() => null);
  if (r && r.value) return r.value;
  // randomUUID needs a secure context; getRandomValues does not, so the fallback is
  // still 128 random bits from the OS rather than a clock plus Math.random.
  const id = crypto.randomUUID ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  await DB.put('meta', { key: 'installId', value: id }).catch(() => {});
  return id;
}
// Both lead with '' so "Prefer not to say" is the default: nothing is recorded
// unless the user actively picks something.
export const AGE_BANDS = ['', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
export const GENDERS = ['', 'Female', 'Male', 'Other'];
export async function getUsageProfile() {
  const r = await DB.get('meta', 'usageProfile').catch(() => null);
  const v = (r && r.value) || {};
  return {
    share: v.share === true,
    ageBand: AGE_BANDS.includes(v.ageBand) ? v.ageBand : '',
    gender: GENDERS.includes(v.gender) ? v.gender : '',
  };
}
// Rough region without asking for a location permission and without GPS: the
// device's own time zone and language already say "India, English" and nothing
// more precise. Read when the counts are sent; never stored, never a coordinate.
export function getUsageRegion() {
  let timeZone = '';
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
  return { timeZone, locale: (navigator.languages && navigator.languages[0]) || navigator.language || '' };
}
export async function saveUsageProfile(p) {
  // Age group and gender are opt-in: stored (and later sent) only when the user picked
  // at least one. Skipping, or leaving both on "Prefer not to say", stores nothing.
  const ageBand = AGE_BANDS.includes(p && p.ageBand) ? p.ageBand : '';
  const gender = GENDERS.includes(p && p.gender) ? p.gender : '';
  if (!(p && p.share) || (!ageBand && !gender)) { await DB.del('meta', 'usageProfile').catch(() => {}); return; }
  await DB.put('meta', { key: 'usageProfile', value: { share: true, ageBand, gender } });
}
// Anonymous usage counts (features switched on, plan, app/device basics, country-level
// region, random install id) are ON unless the user turns them off. Age group and gender
// above are separate and opt-in. Nothing is sent by the app yet - this is the switch the
// future sender must honour.
export async function getUsageCountsOn() {
  const r = await DB.get('meta', 'usageCountsOff').catch(() => null);
  return !(r && r.value === true);
}
export async function setUsageCountsOn(on) {
  if (on) await DB.del('meta', 'usageCountsOff').catch(() => {});
  else await DB.put('meta', { key: 'usageCountsOff', value: true });
}
export async function getUserName() {
  const r = await DB.get('meta', 'userName').catch(() => null);
  return (r && r.value) || '';
}
export async function saveUserName(v) {
  const name = String(v || '').replace(/[ 	]+/g, ' ').trim().slice(0, 30);
  if (name) await DB.put('meta', { key: 'userName', value: name });
  else await DB.del('meta', 'userName').catch(() => {});
}
export function greetingFor(name, d = new Date()) {
  const h = d.getHours();
  return (h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Hello') + ', ' + name;
}
export async function openNameEditor() {
  const input = el('input', { type: 'text', maxlength: '30', value: await getUserName(), placeholder: 'Your first name', autocomplete: 'given-name' });
  const save = async () => { await saveUserName(input.value); closeModal(); renderHome(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Your name' }),
    el('p', { class: 'hint', text: 'Optional. Only used to greet you on Home, and it stays on this device.' }),
    field('First name', input),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', type: 'button', text: 'Skip', onclick: closeModal }),
      el('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: save }),
    ]),
  ]));
  setTimeout(() => input.focus(), 50);
}
async function openUsageProfileEditor() {
  const sel = (opts) => el('select', {}, opts.map((v) => el('option', { value: v, text: v || 'Prefer not to say' })));
  const ageSel = sel(AGE_BANDS);
  const genSel = sel(GENDERS);
  const save = async () => {
    await saveUsageProfile({ share: true, ageBand: ageSel.value, gender: genSel.value });
    sendUsage().catch(() => {});
    closeModal(); if (ageSel.value || genSel.value) toast('Thanks for helping');
  };
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Help improve MyNotes' }),
    el('p', { class: 'hint', text: 'Optional. Share your age group and gender so we build for people like you. Never your money data, your name or your contact details.' }),
    field('Age group', ageSel),
    field('Gender', genSel),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: closeModal }),
      el('button', { class: 'btn primary', type: 'button', text: 'Share', onclick: save }),
    ]),
  ]));
}
// Full transparency: the exact object the sender would post, and whether anything is being sent at all.
export async function openUsagePreview() {
  const st = await usageStatus();
  const state = !st.active ? 'Not active yet: nothing is being sent.'
    : !st.countsOn ? 'Anonymous usage counts are OFF: nothing is being sent.'
    : st.test ? 'Test mode on this device only (everyone else sends nothing). ' + (st.lastSentAt ? 'Last sent ' + new Date(st.lastSentAt).toLocaleString() + '.' : 'Nothing sent yet.')
    : st.lastSentAt ? 'Active. Last sent ' + new Date(st.lastSentAt).toLocaleString() + '.' : 'Active. Nothing sent yet.';
  openModal(el('div', { class: 'sheet legal-sheet' }, [
    el('h2', { text: 'What MyNotes would send' }),
    el('p', { class: 'hint', text: state }),
    el('p', { class: 'hint', text: 'This is the complete message, exactly as it would be sent. It never contains your amounts, notes, name or contact details.' }),
    el('pre', { class: 'usage-json', text: JSON.stringify(st.payload, null, 2) }),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn primary', type: 'button', text: 'Close', onclick: closeModal })]),
  ]));
}
export async function stopSharingUsage() {
  await saveUsageProfile({ share: false });
  sendUsage().catch(() => {});
  toast('Age group and gender removed');
}
// The tag button on a feature screen: what Pro is PLANNED to add there. Nothing listed is
// available yet and the sheet says so; no prices are shown.
export function openProInfo(mode) {
  const id = MODE_FEATURE[mode];
  const info = id && PRO_INFO[id];
  if (!info) return;
  const list = (items) => el('ul', { class: 'pro-list' }, items.map((t) => el('li', { text: t })));
  const member = document.body.dataset.plan === 'paid';
  openModal(el('div', { class: 'sheet pro-sheet' }, [
    el('h2', {}, [el('img', { class: 'pro-title-star', src: 'icons/emoji/pro-star.png', alt: '' }), document.createTextNode(info.name + ' \u00b7 Pro Plan')]),
    el('div', { class: 'pro-badge' + (member ? ' is-member' : ''), text: member ? 'YOU ARE A PRO MEMBER - THANK YOU' : 'NOT ON SALE YET' }),
    el('p', { class: 'hint', text: member
      ? 'Thank you for supporting MyNotes. This is what Pro gives you on this screen.'
      : 'What the Pro Plan adds on this screen.' }),
    ...(info.now && info.now.length ? [
      el('ul', { class: 'pro-list pro-now' }, info.now.map((t) => el('li', { text: t }))),
      ...(info.worksWith ? [el('p', { class: 'pro-works', text: info.worksWith })] : []),
    ] : []),
    ...(info.free ? [el('p', { class: 'pro-free-line' }, [
      el('b', { text: 'On the Free Plan: ' }),
      document.createTextNode(info.free.join(', ').replace(/^[A-Z]/, (c) => c.toLowerCase()) + '.'),
    ])] : []),
    el('p', { class: 'pro-soon-head', text: 'Planned next' }),
    el('ul', { class: 'pro-soon' }, info.items.map((t) => el('li', { text: t }))),
    el('p', { class: 'hint', text: member ? 'Your membership is checked when the app opens while you are online.'
      : 'Free Plan: any ' + FREE_FEATURE_LIMIT + ' features. Pro is planned at ' + PRO_PRICE + ' (' + PRO_PRICE_NOTE + ') and is not on sale yet.' }),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn primary', type: 'button', text: 'Close', onclick: closeModal })]),
  ]));
}
export function openLegal(which) {
  const other = which === 'terms' ? 'privacy' : 'terms';
  const stopHost = el('div', { class: 'legal-stop' });
  if (which === 'privacy') {
    Promise.all([getUsageProfile(), getUsageCountsOn()]).then(([p, countsOn]) => {
      const countsBtn = el('button', { class: 'btn ghost', type: 'button' });
      const countsNote = el('p', { class: 'hint' });
      const paintCounts = (on) => {
        countsNote.textContent = on ? 'Anonymous usage counts are ON: which features are used, no name, no money data.' : 'Anonymous usage counts are OFF. Nothing about your use will be counted.';
        countsBtn.textContent = on ? 'Turn off anonymous usage counts' : 'Turn on anonymous usage counts';
        countsBtn.onclick = async () => {
          await setUsageCountsOn(!on);
          if (on) requestForget().catch(() => {}); else sendUsage().catch(() => {});
          paintCounts(!on);
        };
      };
      paintCounts(countsOn);
      stopHost.appendChild(countsNote);
      stopHost.appendChild(countsBtn);
      stopHost.appendChild(el('button', { class: 'btn ghost', type: 'button', text: 'Show what MyNotes would send', onclick: openUsagePreview }));
      if (p.share) {
        stopHost.appendChild(el('p', { class: 'hint', text: 'You have shared your age group and/or gender. You can remove them at any time.' }));
        stopHost.appendChild(el('button', { class: 'btn ghost', type: 'button', text: 'Remove my age group and gender', onclick: async () => { await stopSharingUsage(); } }));
      }
    }).catch(() => {});
  }
  openModal(el('div', { class: 'sheet legal-sheet' }, [
    ...renderLegal(el, which),
    stopHost,
    el('div', { class: 'btn-row legal-acts' }, [
      el('button', { class: 'btn ghost', type: 'button', text: other === 'terms' ? 'Read Terms of Use' : 'Read Privacy Policy', onclick: () => openLegal(other) }),
      el('button', { class: 'btn primary', type: 'button', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}
async function openMenu() {
  const items = [];
  if (deferredInstall) items.push(menuItem('⬇️', 'Install app', 'Add to home screen', doInstall));
  const lb = await DB.get('meta', 'lastBackup').catch(() => null);
  const lbDesc = lb && lb.value ? 'Last backup ' + new Date(lb.value).toLocaleDateString() : 'No backup yet - do this regularly';
  const _run = await _runningRelease().catch(() => 0);
  items.push(menuItem('🔄', 'Check for updates', _run ? 'You are on v' + _run + ' - tap to check' : 'Tap to check for a newer version', () => { closeModal(); manualUpdateCheck(); }));
  items.push(menuItem('🗄️', 'Backup & Restore', lbDesc, () => { closeModal(); openBackupSheet(); }));
  if (!isPaidPlan()) items.push(menuItem('⚙️', 'Settings · Choose features', 'Pick any 5 features free', () => { closeModal(); openFeaturePicker(); }));
  items.push(menuItem('🗑️', 'Clear all data', 'Erase everything on this device and start fresh', () => { closeModal(); clearAllDataFlow(); }));
  const lockCfg = await getLockConfig();
  const lockDesc = lockCfg && lockCfg.enabled
    ? (lockCfg.biometric && lockCfg.biometric.enabled ? 'PIN + biometric · tap to manage' : 'PIN · tap to manage')
    : 'Protect this app with a PIN';
  items.push(menuItem('🔒', lockCfg && lockCfg.enabled ? 'App lock · on' : 'Set up app lock', lockDesc, () => { closeModal(); openLockEntry(); }));
  // Only offered when there is no name: once you are greeted by name, the greeting
  // itself is the way back in (tap it), so this row stops taking up space.
  if (!(await getUserName())) items.push(menuItem('👤', 'Add your name', 'Optional - greets you on Home', () => { closeModal(); openNameEditor(); }));
  if (!(await getUsageProfile()).share) items.push(menuItem('📊', 'Help improve MyNotes', 'Optional: share your age group and gender', () => { closeModal(); openUsageProfileEditor(); }));
  items.push(menuItem('📜', 'Privacy & Terms', 'Your data stays on this device · not financial advice', () => { closeModal(); openLegal('privacy'); }));
  // The news key now lives on MyNotes' server, so there is nothing to type in. What is left - whether
  // the Feed may send a company name at all - is decided on the Feed tab itself, where it belongs.
  if (isPaidPlan()) items.push(menuItem('📰', 'News Feed', 'Turn the news Feed on or off', () => { closeModal(); openFeedSettings(); }));
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Menu' }),
    el('div', { class: 'menu-list' }, items),
    el('p', { class: 'hint', text: 'All data is stored only on this device. Export regularly so you have a backup.' }),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
  ]));
}

// ---------- backup ----------
//
// Everything on the device that the user put there. Not `meta`, which is
// settings rather than records, and not `feed`, which is cached news that
// re-fetches itself. Counted rather than sized, because a count is the thing
// worth saying out loud: "43 new entries" means something, "812 KB" does not.
const BACKED_UP_STORES = ['stocks', 'snapshots', 'monthly', 'funds', 'fds', 'dividends',
  'metals', 'bonds', 'emergency', 'bankSavings', 'creditCards', 'allocations',
  'ccReimbursements', 'monthlySheet', 'spends', 'personalSpends', 'vault'];

async function dataCount() {
  const counts = await Promise.all(BACKED_UP_STORES.map(
    (name) => DB.all(name).then((r) => r.length).catch(() => 0)));
  return counts.reduce((a, b) => a + b, 0);
}

// The count goes down WITH the timestamp, every time, from one function - so
// the reminder can ask "how much has changed since" rather than only "how long
// ago", and stay quiet for someone who has genuinely not touched anything.
async function markBackedUp() {
  const count = await dataCount();
  await DB.put('meta', { key: 'lastBackup', value: Date.now() });
  await DB.put('meta', { key: 'lastBackupCount', value: count });
}

async function exportData() {
  const data = await DB.exportAll();
  if (_backupRecordCount(data) === 0) {
    appAlert('There is nothing to back up yet - the app has no records.');
    return;
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'mynote-stocks-backup-' + todayISO() + '.json' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  await markBackedUp();
  toast('Backup downloaded');
}

function importData() {
  // Kept in the page while the picker is open: on some phones a detached file
  // input is discarded before the chosen file is reported back.
  const input = el('input', { type: 'file', accept: 'application/json,.json,application/octet-stream,text/plain', style: 'display:none' });
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch (e) { appAlert('That file could not be read as a backup: ' + e.message); return; }
    const count = _backupRecordCount(data);
    if (count === 0) { appAlert(_EMPTY_BACKUP_MSG); return; }
    if (!(await appConfirm('This backup holds ' + count + ' records. Importing REPLACES all current data on this device. Continue?'))) return;
    try {
      await DB.importAll(data);
      await markBackedUp();
      toast('Backup imported · reloading…');
      // A full reload, like the other restore paths: Home and the feature
      // choices are rebuilt from the restored data instead of showing stale numbers.
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      appAlert('Import failed: ' + e.message);
    }
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

// ---------- backup & restore (folder-based) ----------
// Single entry point routes to: fallback (no FS Access API), setup (no folder
// picked yet), or main (folder ready, list + actions).

const _fmtBackupDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const _fmtBackupSize = (n) => {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
};

// How many of the user's own records a backup (or the live database) holds.
// Settings-like stores (meta, feed, snapshots, healthParams' starter list) don't
// count: a backup with only those is an EMPTY backup, and restoring or writing
// one is how good data gets replaced by nothing.
const _RECORD_STORES = ['stocks', 'monthly', 'funds', 'fds', 'dividends', 'metals', 'bonds', 'emergency', 'bankSavings',
  'creditCards', 'allocations', 'ccReimbursements', 'monthlySheet', 'spends', 'personalSpends', 'vault',
  'healthPeople', 'healthChecks'];
function _backupRecordCount(data) {
  return _RECORD_STORES.reduce((n, k) => n + ((data && Array.isArray(data[k])) ? data[k].length : 0), 0);
}
const _EMPTY_BACKUP_MSG = 'This backup has no records in it, so restoring it would only erase your data. Nothing was changed.';

export async function openBackupSheet() {
  if (!fileSystemAccessSupported()) { openBackupFallbackSheet(); return; }
  const handle = await getSavedFolder();
  if (!handle) { openBackupSetupSheet(); return; }
  // Already allowed: straight to the sheet. Otherwise ask ONE tap to allow the
  // same folder again - never make the user re-pick it just because the browser
  // wants its permission confirmed.
  let state = 'prompt';
  try { state = await handle.queryPermission({ mode: 'readwrite' }); } catch (_) {}
  if (state === 'granted') { openBackupMainSheet(handle); return; }
  openBackupAllowSheet(handle);
}

function openBackupAllowSheet(handle) {
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Backup & Restore' }),
    el('p', { class: 'hint', text:
      'Your backup folder "' + (handle.name || 'folder') + '" is saved. Your browser needs one tap to allow access to it again.' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Allow access', onclick: async () => {
        if (await ensureFolderPermission(handle, 'readwrite')) { closeModal(); openBackupMainSheet(handle); }
        else toast('Access not allowed. Try again, or choose a different folder.');
      } }),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ]),
    el('div', { class: 'menu-foot' }, [
      el('button', { class: 'link-btn', text: 'Choose a different folder', onclick: () => { closeModal(); openBackupSetupSheet(); } }),
    ]),
  ]));
}

function openBackupSetupSheet() {
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Backup & Restore' }),
    el('p', { class: 'hint', text:
      'Pick where to keep your backups - the app creates its own "' + APP_FOLDER_NAME + '" folder there. It keeps the newest ' + BACKUPS_KEEP +
      ' backups and removes older ones automatically. Backups never leave your device.'
    }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn primary', text: 'Create backup folder', onclick: async () => {
        try { await pickFolder(); closeModal(); openBackupSheet(); }
        catch (e) { if (e.name !== 'AbortError') appAlert('Could not pick folder: ' + (e.message || e)); }
      }}),
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
    ]),
    el('div', { class: 'menu-foot' }, [
      el('button', { class: 'link-btn', text: 'Restore from a backup file...', onclick: () => { closeModal(); restoreFromOutsideFile(); } }),
    ]),
  ]));
}

async function openBackupMainSheet(handle) {
  const list = await listBackups(handle).catch(() => []);
  const lastBackupText = list.length ? 'Last: ' + _fmtBackupDate(list[0].date) : 'No backups yet';

  const backupNow = async () => {
    try {
      const data = await DB.exportAll();
      const count = _backupRecordCount(data);
      if (count === 0) {
        await appAlert('There is nothing to back up yet - the app has no records. A backup of an empty app could overwrite a good backup, so none was saved.');
        return;
      }
      // Same-day backups overwrite each other. Never let a smaller one silently replace a fuller one.
      const sameDay = list.find((b) => b.date === new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-' + String(new Date().getDate()).padStart(2, '0'));
      if (sameDay) {
        let existing = 0;
        try { existing = _backupRecordCount(await readBackupByName(handle, sameDay.name)); } catch (_) {}
        if (existing > count && !(await appConfirm('Today\'s backup already holds ' + existing + ' records, but the app has only ' + count + ' now.\n\nOverwrite the fuller backup with this smaller one?'))) return;
      }
      const result = await writeBackup(handle, data);
      await rotateBackups(handle);
      await markBackedUp();
      toast('Backup saved · ' + _fmtBackupDate(result.date));
      closeModal(); openBackupMainSheet(handle);
    } catch (e) { appAlert('Backup failed: ' + (e.message || e)); }
  };

  const restore = async (item) => {
    let data;
    try { data = await readBackupByName(handle, item.name); }
    catch (e) { appAlert('Could not read that backup: ' + (e.message || e)); return; }
    const count = _backupRecordCount(data);
    if (count === 0) { appAlert(_EMPTY_BACKUP_MSG); return; }
    const ok = (await appConfirm(
      'Restore from ' + _fmtBackupDate(item.date) + '?\n\n' +
      'This backup holds ' + count + ' records. It REPLACES all your current data. Any edits made since that backup will be lost.\n\n' +
      'A safety snapshot of your current state will be saved as "prerestore" first.'
    ));
    if (!ok) return;
    try {
      // Snapshot current state to prerestore - single-level "oops" undo. Skipped when
      // the app is empty, so a blank snapshot never replaces a useful one.
      const current = await DB.exportAll();
      if (_backupRecordCount(current) > 0) await writePreRestoreSnapshot(handle, current);
      await DB.importAll(data);
      await markBackedUp();
      toast('Restored · ' + _fmtBackupDate(item.date) + ' · reloading…');
      setTimeout(() => location.reload(), 900);
    } catch (e) { appAlert('Restore failed: ' + (e.message || e)); }
  };

  const changeFolder = async () => {
    try { await pickFolder(); closeModal(); openBackupSheet(); }
    catch (e) { if (e.name !== 'AbortError') appAlert(e.message || e); }
  };

  const rows = list.map((item) => el('div', { class: 'backup-row' }, [
    el('div', { class: 'backup-meta' }, [
      el('div', { class: 'backup-date', text: _fmtBackupDate(item.date) }),
      el('div', { class: 'backup-detail', text: _fmtBackupSize(item.size) }),
    ]),
    el('button', { class: 'btn small', text: 'Restore', onclick: () => restore(item) }),
  ]));

  const listSection = rows.length
    ? el('div', { class: 'backup-list' }, rows)
    : el('p', { class: 'hint', text: 'No backups yet - tap "Backup now" to create your first one.' });

  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Backup & Restore' }),
    el('div', { class: 'backup-folder' }, [
      el('span', { class: 'backup-folder-label', text: 'Folder: ' }),
      el('span', { class: 'backup-folder-name', text: handle.name || '(picked folder)' }),
      el('button', { class: 'link-btn backup-folder-change', text: 'Change', onclick: changeFolder }),
    ]),
    el('div', { class: 'backup-actions' }, [
      el('button', { class: 'btn primary', text: 'Backup now', onclick: backupNow }),
      el('div', { class: 'backup-last', text: lastBackupText }),
    ]),
    el('h3', { class: 'backup-section-title', text: 'Recent backups' }),
    listSection,
    el('p', { class: 'hint', text:
      'Same-day backups overwrite. Older backups in this folder are auto-removed when a new one is saved (keeps the newest ' +
      BACKUPS_KEEP + '). A "prerestore" snapshot is kept separately for one undo level.'
    }),
    el('p', { class: 'backup-tip', text: '💡 Also save a copy of your backup to Google Drive (or email it to yourself). A backup kept only on this phone is lost with it.' }),
    el('div', { class: 'menu-foot' }, [
      el('button', { class: 'link-btn', text: 'Restore from a file outside this folder...', onclick: () => { closeModal(); restoreFromOutsideFile(); } }),
    ]),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

function openBackupFallbackSheet() {
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'Backup & Restore' }),
    el('p', { class: 'hint', text:
      'This browser doesn\'t support the dedicated-folder feature. Backups will download to your normal Downloads folder; you\'ll need to pick a file when restoring.'
    }),
    el('p', { class: 'backup-tip', text: '💡 Also save a copy of your backup to Google Drive (or email it to yourself). A backup kept only on this phone is lost with it.' }),
    el('div', { class: 'menu-list' }, [
      menuItem('⬆️', 'Backup now', 'Downloads a JSON file', () => { closeModal(); exportData(); }),
      menuItem('📂', 'Restore from file', 'Pick a backup file to restore', () => { closeModal(); importData(); }),
    ]),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
  ]));
}

async function restoreFromOutsideFile() {
  let data;
  try { data = await readBackupViaFilePicker(); }
  catch (e) { if (e.message !== 'No file picked' && e.name !== 'AbortError') appAlert('Could not read file: ' + (e.message || e)); return; }
  const count = _backupRecordCount(data);
  if (count === 0) { appAlert(_EMPTY_BACKUP_MSG); return; }
  if (!(await appConfirm('Restore from this file?\n\nIt holds ' + count + ' records and REPLACES all your current data. Any edits since the backup will be lost.'))) return;
  try {
    const handle = await getSavedFolder();
    if (handle) {
      // If a backup folder is set, drop a prerestore there for one-level undo.
      const current = await DB.exportAll();
      if (_backupRecordCount(current) > 0) await writePreRestoreSnapshot(handle, current).catch(() => {});
    }
    await DB.importAll(data);
    toast('Restored · reloading…');
    setTimeout(() => location.reload(), 900);
  } catch (e) { appAlert('Restore failed: ' + (e.message || e)); }
}

// ---------- OCR: update prices from broker screenshot ----------
export function _normName(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// OCR alias memory: when the user overrides the auto-match in the review modal
// (e.g. parsed "Adani Pwr" → mapped manually to stock "Adani Power Ltd"), we
// remember that mapping so next time the same parsed name auto-matches with
// full confidence - no re-tweaking. Keyed by portfolio so an alias in one
// portfolio can't leak into another. Lives in the existing `meta` store; small
// enough to load whole into memory on demand.
const _aliasKey = (portfolio, parsedName) => portfolio + '|' + _normName(parsedName);
async function _loadOcrAliases() {
  const rec = await DB.get('meta', 'ocr-aliases').catch(() => null);
  return (rec && rec.value) || {};
}
async function _saveOcrAlias(portfolio, parsedName, stockId) {
  const norm = _normName(parsedName);
  if (!norm) return;
  const aliases = await _loadOcrAliases();
  const key = _aliasKey(portfolio, parsedName);
  if (stockId) aliases[key] = stockId;
  else delete aliases[key];
  await DB.put('meta', { key: 'ocr-aliases', value: aliases });
}
function _findStockMatch(parsedName, stocks) {
  const t = _normName(parsedName);
  if (!t) return null;
  let best = null;
  for (const s of stocks) {
    if (s.status === 'sold') continue;
    const nn = _normName(s.name);
    if (!nn) continue;
    if (nn === t) return { stock: s, score: 1 };
    // substring (either way) - score by length ratio
    if (nn.includes(t) || t.includes(nn)) {
      const score = Math.min(nn.length, t.length) / Math.max(nn.length, t.length);
      if (!best || score > best.score) best = { stock: s, score };
      continue;
    }
    // looser fallback: count of shared leading letters / total
    let k = 0; const lim = Math.min(nn.length, t.length);
    while (k < lim && nn.charCodeAt(k) === t.charCodeAt(k)) k++;
    if (k >= 3) {
      const score = k / Math.max(nn.length, t.length);
      if (!best || score > best.score) best = { stock: s, score };
    }
  }
  // Always return the best - user can untick in the review if wrong.
  return best;
}

export function showLoader(msg) {
  hideLoader();
  const overlay = el('div', { class: 'loader-overlay', id: '__loader' }, [
    el('div', { class: 'loader-card' }, [
      el('div', { class: 'spinner' }),
      el('div', { class: 'loader-msg', text: msg || 'Working…' }),
    ]),
  ]);
  document.body.appendChild(overlay);
  return overlay;
}
export function setLoader(msg) { const m = document.querySelector('#__loader .loader-msg'); if (m) m.textContent = msg; }
export function hideLoader() { const o = document.getElementById('__loader'); if (o) o.remove(); }

const OCR_LOCK_MSG = 'Updating holdings from a screenshot is a Pro Plan feature. On the Free Plan, edit each stock and enter its units, average price and current price.';
async function openOcrFlow() {
  if (!isPaidPlan()) { toast(OCR_LOCK_MSG); return; }
  // multiple: lets the OS picker accept 1-N screenshots (typical 4-5 for a long
  // holdings list that doesn't fit one screen). Sequential OCR with a shared
  // Tesseract worker - see ocrImages() in ocr.js.
  const input = el('input', { type: 'file', accept: 'image/*', multiple: '' });
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    showLoader('Loading OCR engine…');
    try {
      const mod = await import('./ocr.js');
      const total = files.length;
      const texts = await mod.ocrImages(files, (m) => {
        if (!m || !m.status) return;
        const idx = (m.fileIndex || 0) + 1;
        const pct = (m.progress != null && !isNaN(m.progress)) ? Math.round(m.progress * 100) : null;
        const status = m.status.charAt(0).toUpperCase() + m.status.slice(1);
        const prefix = total > 1 ? 'Image ' + idx + '/' + total + ' · ' : '';
        setLoader(prefix + status + (pct != null ? ' · ' + pct + '%' : ''));
      });
      // Merge rows from all images. Dedup by normalised stock name (first wins)
      // so a scroll-overlap between screenshot N and N+1 doesn't produce dupes.
      const seen = new Set();
      const allRows = [];
      for (const text of texts) {
        const rows = mod.parseBrokerRows(text, state.portfolio);
        for (const r of rows) {
          const key = mod.normName(r.name);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          allRows.push(r);
        }
      }
      hideLoader();
      // Note: the image Files go only to Tesseract for recognition. We never
      // persist them - only the parsed numbers reach the review screen.
      const rawText = texts.join('\n\n----- next image -----\n\n');
      if (!allRows.length) { openOcrDebug(rawText); return; }
      const aliases = await _loadOcrAliases();
      openOcrReview(allRows, aliases, rawText);
    } catch (e) {
      hideLoader();
      appAlert('OCR failed: ' + e.message);
    }
  });
  input.click();
}

// `title`/`note` are overridden when this is opened from the review screen's
// "Raw text" button — there the parser DID find rows, the user just wants to
// see what was actually read so a mis-parse can be diagnosed.
function openOcrDebug(text, title, note) {
  const ta = el('textarea', { readonly: 'true', style: 'width:100%;min-height:240px;font-family:monospace;font-size:0.72rem;' });
  ta.value = text || '(empty)';
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: title || 'No holding rows detected' }),
    el('p', { class: 'note', text: note || 'OCR ran but the parser couldn\'t pick out any "units × avg / LTP:" pattern. The raw text below is what was read - share it so the parser can be tuned. Try cropping to just the holdings rows, or use a higher-resolution screenshot.' }),
    ta,
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Copy text', onclick: () => { ta.select(); document.execCommand && document.execCommand('copy'); toast('Copied'); } }),
      el('button', { class: 'btn primary', text: 'Close', onclick: closeModal }),
    ]),
  ]));
}

function openOcrReview(rows, aliases, rawText) {
  const ym = thisYm();
  const monthLabel = ymToLabel(ym);
  // Groww/wife-in: the "Market Price" view shows units (e.g. "27 shares") and
  // current price, but not the average buy price. So we update units + price
  // and leave the saved avg untouched. The Avg column is hidden in the review
  // and the apply step gates avg writes - defense in depth.
  const noAvg = state.portfolio === 'wife-in';
  aliases = aliases || {};
  // Resolve each row's auto-match: saved alias (manual override from a prior
  // run) wins, otherwise fall back to the fuzzy matcher. An alias that points
  // to a now-sold or deleted stock is ignored.
  const matched = rows.map((r) => {
    const aliasId = aliases[_aliasKey(state.portfolio, r.name)];
    if (aliasId) {
      const stock = state.stocks.find((s) => s.id === aliasId && s.status !== 'sold');
      if (stock) return { ...r, match: { stock, score: 1, fromAlias: true } };
    }
    return { ...r, match: _findStockMatch(r.name, state.stocks) };
  });
  const matchedCount = matched.filter((m) => m.match).length;
  // Stocks shown in the per-row override dropdown - only active holdings, sorted
  // by name. Mirrors what _findStockMatch considers, so manual selection and
  // auto-match can never disagree on which pool is valid.
  const activeStocks = state.stocks.filter((s) => s.status !== 'sold')
    .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  // Big-jump heuristic: a stock's parsed price differing > 30% from its saved
  // currentPrice is almost always a wrong match or an OCR misread (not a real
  // 30%/day move). Flag for verification - separate from the ₹→3 suspect heuristic.
  const BIG_JUMP_THRESHOLD = 0.30;
  const isBigJump = (savedLtp, newLtp) =>
    savedLtp != null && newLtp != null && savedLtp > 0 &&
    Math.abs((newLtp - savedLtp) / savedLtp) > BIG_JUMP_THRESHOLD;

  const head = el('div', { class: 'ocr-head' + (noAvg ? ' no-avg' : '') },
    noAvg
      ? [el('span', { text: '' }), el('span', { text: 'Stock' }), el('span', { text: 'Units' }), el('span', { text: 'Price' })]
      : [el('span', { text: '' }), el('span', { text: 'Stock' }), el('span', { text: 'Units' }), el('span', { text: 'Avg' }), el('span', { text: 'LTP' })]
  );
  // Tesseract often misreads ₹ as the digit "3", inflating a price like ₹84.89
  // to "384.89". Flag any integer-part starting with "3" that has 3+ digits
  // ("3xx" up). Over-flagging is fine - the user just glances at highlights.
  const suspectLtp = (v) => v != null && /^3\d{2,}/.test(String(Math.trunc(v)));
  const refs = matched.map((m) => {
    const enabled = !!m.match;
    const cb = el('input', { type: 'checkbox' }); cb.checked = enabled; cb.disabled = !enabled;
    const unitsI = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.units != null ? m.units : '' });
    const avgI = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.avg != null ? m.avg : '' });
    const ltpI = el('input', { type: 'number', inputmode: 'decimal', step: 'any', value: m.ltp != null ? m.ltp : '' });
    if (suspectLtp(m.ltp)) {
      ltpI.classList.add('ocr-suspect');
      ltpI.title = 'OCR may have misread the ₹ symbol as "3". Verify against the screenshot.';
    }
    // Big-jump check uses the *currently-matched* stock; recomputed on dropdown
    // change too (different stock → different saved price → maybe no longer a jump).
    const flagBigJump = () => {
      const saved = ref.match && ref.match.stock ? ref.match.stock.currentPrice : null;
      const parsed = num(ltpI.value);
      if (isBigJump(saved, parsed)) {
        ltpI.classList.add('ocr-suspect');
        ltpI.title = 'Big change vs saved (₹' + saved + ' → ₹' + parsed + '). Confirm before applying.';
      } else if (!suspectLtp(num(ltpI.value))) {
        ltpI.classList.remove('ocr-suspect');
        ltpI.removeAttribute('title');
      }
    };
    // Dropdown to override the auto-matched stock. Pre-selects the best match;
    // user can pick a different stock, "+ Add as new stock" to create one from
    // this row, or "- Skip -" to drop the row. Selecting a stock auto-checks
    // the row; selecting Skip disables it.
    const sel = el('select', { class: 'ocr-match-sel' });
    sel.appendChild(el('option', { value: '', text: '- Skip (no match) -' }));
    sel.appendChild(el('option', { value: '__new__', text: '+ Add as new stock' }));
    for (const s of activeStocks) {
      const opt = el('option', { value: s.id, text: s.name });
      if (m.match && !m.match.fromAlias && m.match.stock.id === s.id) opt.selected = true;
      if (m.match && m.match.fromAlias && m.match.stock.id === s.id) {
        opt.selected = true; opt.textContent = '★ ' + s.name + ' (saved match)';
      }
      sel.appendChild(opt);
    }
    if (!m.match) sel.value = '';
    const nameCell = el('div', { class: 'ocr-name' }, [
      el('div', { class: 'ocr-parsed', text: m.name }),
      sel,
    ]);
    const row = el('div', { class: 'ocr-row' + (noAvg ? ' no-avg' : '') + (enabled ? '' : ' no-match') },
      noAvg ? [cb, nameCell, unitsI, ltpI] : [cb, nameCell, unitsI, avgI, ltpI]
    );
    // ref.allowAvg controls whether the apply step writes buyPrice from this
    // row. For me-in/me-us it's always true (avg column visible). For wife-in
    // (noAvg) it flips to true only when parsed units differ from the matched
    // stock's saved units - a unit change means a buy/sell happened and the
    // average buy price has definitely shifted, so we surface the Avg input
    // as an inline banner for that row only.
    const ref = { row, cb, unitsI, avgI, ltpI, match: m.match, allowAvg: !noAvg };
    flagBigJump();

    const checkAvgVisibility = () => {
      if (!noAvg) { ref.allowAvg = true; return; }
      // "+ Add as new" path keeps current behaviour: avg stays null (the user
      // can edit the new stock's avg from its detail card right after Apply).
      if (ref.match && ref.match.addNew) {
        ref.allowAvg = false;
        if (ref.avgBanner) ref.avgBanner.style.display = 'none';
        return;
      }
      const stock = ref.match && ref.match.stock;
      const savedUnits = stock ? num(stock.units) : null;
      const parsedUnits = num(unitsI.value);
      const changed = savedUnits != null && parsedUnits != null && Math.abs(parsedUnits - savedUnits) > 0.0001;
      ref.allowAvg = changed;
      if (changed) {
        if (!ref.avgBanner) {
          ref.avgMsg = el('div', { class: 'ocr-avg-msg' });
          ref.avgBanner = el('div', { class: 'ocr-avg-banner' }, [ref.avgMsg, avgI]);
          row.appendChild(ref.avgBanner);
        }
        ref.avgMsg.textContent =
          'Units changed (' + savedUnits + ' → ' + parsedUnits + ') - set new average buy price:';
        ref.avgBanner.style.display = '';
      } else if (ref.avgBanner) {
        ref.avgBanner.style.display = 'none';
      }
    };
    checkAvgVisibility();

    sel.addEventListener('change', async () => {
      if (!sel.value) {
        ref.match = null;
        cb.checked = false; cb.disabled = true;
        row.classList.add('no-match');
        // Remember "Skip" too - next time, the parser won't keep auto-mapping
        // a parsed name the user has explicitly rejected.
        await _saveOcrAlias(state.portfolio, m.name, null).catch(() => {});
      } else if (sel.value === '__new__') {
        // Sentinel: create a brand-new stock at Apply time. No alias saved
        // (the future stock has no id yet); next OCR will fuzzy-match the
        // newly-created stock by name and offer it in the dropdown normally.
        ref.match = { addNew: true, name: m.name };
        cb.disabled = false; cb.checked = true;
        row.classList.remove('no-match');
      } else {
        const stock = state.stocks.find((x) => x.id === sel.value);
        if (!stock) return;
        ref.match = { stock, score: 1 };
        cb.disabled = false; cb.checked = true;
        row.classList.remove('no-match');
        await _saveOcrAlias(state.portfolio, m.name, stock.id).catch(() => {});
      }
      flagBigJump();
      checkAvgVisibility();
    });
    ltpI.addEventListener('input', flagBigJump);
    unitsI.addEventListener('input', checkAvgVisibility);
    return ref;
  });

  const apply = async () => {
    let updated = 0, added = 0;
    for (const r of refs) {
      if (!r.cb.checked || !r.match) continue;
      const nU = num(r.unitsI.value), nA = num(r.avgI.value), nL = num(r.ltpI.value);

      // "+ Add as new" path - create the stock from the parsed row. Category
      // is left blank; the user can edit it from the stock card afterwards.
      // For wife-in (no Avg in Groww view), buyPrice is left null too.
      if (r.match.addNew) {
        const now = new Date().toISOString();
        const fresh = {
          portfolio: state.portfolio,
          name: r.match.name,
          category: '',
          conviction: '',
          status: 'holding',
          units: nU,
          buyPrice: r.allowAvg && nA != null ? nA : null,
          currentPrice: nL,
          soldPrice: null, soldUnits: null, soldDate: null,
          notes: '',
          history: [],
          createdAt: now, updatedAt: now,
        };
        if (fresh.buyPrice && fresh.currentPrice) {
          const pct = Math.round(((fresh.currentPrice - fresh.buyPrice) / fresh.buyPrice) * 10000) / 100;
          fresh.history.push({ month: monthLabel, pct });
        }
        await DB.put('stocks', fresh);
        added++;
        continue;
      }

      const fresh = await DB.get('stocks', r.match.stock.id);
      if (!fresh) continue;
      // Only overwrite a field if the screenshot provided a value (so brokers
      // that don't show Avg in the holdings view don't wipe what's already saved).
      // r.allowAvg gates the buyPrice write: always true for me-in/me-us; for
      // wife-in (Groww) it's true only when parsed units differ from the saved
      // units (a buy/sell happened) - the inline avg banner in the review
      // exposes the avg input only in that case.
      if (nU != null) fresh.units = nU;
      if (r.allowAvg && nA != null) fresh.buyPrice = nA;
      if (nL != null) fresh.currentPrice = nL;
      if (fresh.buyPrice && fresh.currentPrice) {
        const pct = Math.round(((fresh.currentPrice - fresh.buyPrice) / fresh.buyPrice) * 10000) / 100;
        const hist = (fresh.history || []).filter((h) => h.month !== monthLabel);
        hist.push({ month: monthLabel, pct });
        hist.sort((a, c) => (labelToYm(a.month) || '').localeCompare(labelToYm(c.month) || ''));
        fresh.history = hist;
      }
      fresh.updatedAt = new Date().toISOString();
      await DB.put('stocks', fresh);
      updated++;
    }
    closeModal();
    if (!updated && !added) { toast('Nothing applied'); return; }
    await refresh(); // reloads state.stocks
    // capture the current month's portfolio totals from the freshly updated holdings
    const s = summarize(state.stocks);
    const existing = state.months.find((x) => x.ym === ym);
    const rec = {
      key: monthKey(state.portfolio, ym),
      portfolio: state.portfolio, ym,
      invested: s.hasVal ? s.invested : null,
      value: s.hasVal ? s.value : null,
      profitLoss: s.hasVal ? s.pl : null,
      returnPct: s.hasVal ? Math.round(s.plPct * 100) / 100 : null,
      countProfit: s.up, countLoss: s.down,
      nifty: existing ? existing.nifty : null,
      source: 'ocr',
      updatedAt: new Date().toISOString(),
    };
    await syncNifty(rec);
    await DB.put('monthly', rec);
    const parts = [];
    if (updated) parts.push('Updated ' + updated);
    if (added) parts.push('Added ' + added);
    toast(parts.join(' · ') + ' · ' + monthLabel + ' captured');
    refresh();
  };

  // ---- Live "what the portfolio will look like after Apply" preview ----
  // Replaces the old wall of instructions. The point is a single number the
  // user can eyeball against the total their broker app shows: if the overall
  // return % lines up, every parsed row is almost certainly right.
  //
  // It spans the WHOLE portfolio, not just the uploaded rows - the rows being
  // updated contribute their NEW values and every stock left out of this
  // upload contributes its saved values, which is what makes the total
  // comparable to the broker's. Mirrors apply()'s field-by-field rules exactly
  // (blank input keeps the saved value; buyPrice only when allowAvg) so the
  // preview can't promise something Apply won't do.
  const previewHost = el('div', { class: 'summary ocr-preview' });
  const cur = curOf(state.portfolio);
  const projectStocks = () => {
    const replaced = new Map();
    const added = [];
    for (const r of refs) {
      if (!r.cb.checked || !r.match) continue;
      const nU = num(r.unitsI.value), nA = num(r.avgI.value), nL = num(r.ltpI.value);
      if (r.match.addNew) {
        added.push({
          status: 'holding', units: nU,
          buyPrice: r.allowAvg && nA != null ? nA : null,
          currentPrice: nL, history: [],
        });
        continue;
      }
      const proj = Object.assign({}, r.match.stock);
      if (nU != null) proj.units = nU;
      if (r.allowAvg && nA != null) proj.buyPrice = nA;
      if (nL != null) proj.currentPrice = nL;
      replaced.set(r.match.stock.id, proj);
    }
    const list = state.stocks.map((s) => replaced.get(s.id) || s).concat(added);
    return { list, touched: replaced.size + added.length };
  };

  const renderPreview = () => {
    const { list, touched } = projectStocks();
    const after = summarize(list);
    const before = summarize(state.stocks);
    const untouched = Math.max(0, after.holdings - touched);
    previewHost.innerHTML = '';
    previewHost.appendChild(el('div', { class: 'row-between' }, [
      el('span', { class: 'label', text: 'After apply · whole portfolio' }),
      after.hasVal
        ? el('span', { class: 'badge ' + (after.pl >= 0 ? 'good' : 'bad'), text: fmtPct(after.plPct) })
        : el('span', { class: 'badge muted', text: 'no prices yet' }),
    ]));
    previewHost.appendChild(el('div', { class: 'big', text: after.hasVal ? fmtCur(after.value, cur) : '-' }));
    const grid = el('div', { class: 'grid' });
    const deltaPct = after.hasVal && before.hasVal ? after.plPct - before.plPct : null;
    [
      ['Invested', after.hasVal ? fmtCur(after.invested, cur) : '-', ''],
      ['Profit / Loss', after.hasVal ? (after.pl >= 0 ? '+' : '') + fmtCur(after.pl, cur) : '-', after.hasVal ? pctClass(after.pl) : ''],
      ['From this upload', touched + ' of ' + rows.length, ''],
      ['Not in upload', String(untouched), ''],
      ['Was', before.hasVal ? fmtPct(before.plPct) : '-', ''],
      ['Change', deltaPct != null ? fmtPct(deltaPct) : '-', deltaPct != null ? pctClass(deltaPct) : ''],
    ].forEach(([k, v, cls]) => grid.appendChild(el('div', { class: 'cell' }, [
      el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls || ''), text: v }),
    ])));
    previewHost.appendChild(grid);
  };

  // Recompute on every edit. These listeners are registered after the per-row
  // ones above, so ref.match / ref.allowAvg are already updated when they fire.
  // The dropdown's own handler finishes asynchronously (it awaits the alias
  // save before re-running checkAvgVisibility), so that one also re-renders on
  // a short delay to pick up the settled allowAvg.
  refs.forEach((r) => {
    [r.unitsI, r.avgI, r.ltpI].forEach((inp) => inp && inp.addEventListener('input', renderPreview));
    r.cb.addEventListener('change', renderPreview);
    const sel = r.row.querySelector('.ocr-match-sel');
    if (sel) sel.addEventListener('change', () => { renderPreview(); setTimeout(renderPreview, 80); });
  });
  renderPreview();

  openModal(el('div', { class: 'sheet ocr-sheet' }, [
    el('h2', { text: 'Update from screenshot' }),
    previewHost,
    head,
    el('div', { class: 'ocr-list' }, refs.map((r) => r.row)),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: closeModal }),
      // Escape hatch for a mis-parse: the broker app's layout changes now and
      // then, and seeing what Tesseract actually read is the only way to retune
      // the parser. Available even when rows WERE found, since a wrong name or
      // a missing price is exactly the case worth reporting.
      el('button', {
        class: 'btn ghost', text: 'Raw text',
        onclick: () => openOcrDebug(rawText, 'Raw OCR text',
          'This is exactly what Tesseract read from your screenshot(s). If the rows above came out wrong, copy this and share it so the parser can be fixed.'),
      }),
      el('button', { class: 'btn primary', text: 'Apply', onclick: apply }),
    ]),
  ]));
}

// ---------- app lock (PIN + optional biometric) ----------

// Shared keypad widget used by the lock screen, setup wizard and Change PIN.
// onPress receives the digit string ('0'..'9') or 'back'. onBio is optional -
// when provided, a fingerprint key appears in the bottom-left slot.
function buildKeypad(onPress, onBio) {
  const grid = el('div', { class: 'kpad' });
  const digit = (d) => el('button', { type: 'button', class: 'kp', text: d, onclick: () => onPress(d) });
  for (let d = 1; d <= 9; d++) grid.appendChild(digit(String(d)));
  if (onBio) {
    grid.appendChild(el('button', { type: 'button', class: 'kp kp-bio', text: '👆', 'aria-label': 'Use biometric', onclick: onBio }));
  } else {
    grid.appendChild(el('span', { class: 'kp kp-empty' }));
  }
  grid.appendChild(digit('0'));
  grid.appendChild(el('button', { type: 'button', class: 'kp kp-back', text: '⌫', 'aria-label': 'Backspace', onclick: () => onPress('back') }));
  return grid;
}

// Render the row of PIN-progress dots (filled vs empty) into `host`.
function renderPinDots(host, filled) {
  host.innerHTML = '';
  for (let i = 0; i < PIN_LENGTH; i++) host.appendChild(el('span', { class: 'pin-dot' + (i < filled ? ' filled' : '') }));
}

// Generic PIN-entry controller. Calls onComplete(pin) when 4 digits are in.
// Returns { reset, setError } so callers can drive multi-step flows.
function makePinController(dotsHost, errorHost, onComplete) {
  let entered = '';
  const render = () => renderPinDots(dotsHost, entered.length);
  const reset = () => { entered = ''; render(); };
  const setError = (msg) => {
    errorHost.textContent = msg || '';
    if (msg) setTimeout(() => { if (errorHost.textContent === msg) errorHost.textContent = ''; }, 1800);
  };
  const onPress = (k) => {
    if (k === 'back') { entered = entered.slice(0, -1); render(); return; }
    if (entered.length >= PIN_LENGTH) return;
    entered += k;
    render();
    if (entered.length === PIN_LENGTH) {
      const pin = entered;
      // Defer onComplete so the last dot paints before any verify work runs.
      setTimeout(() => onComplete(pin), 30);
    }
  };
  render();
  return { onPress, reset, setError };
}

// Full-screen lock overlay shown on app start when a PIN is set. Resolves when
// the user unlocks. The overlay covers any already-built chrome behind it.
async function showLockScreen() {
  const cfg = await getLockConfig();
  if (!cfg || !cfg.enabled) return; // no lock configured
  return new Promise((resolve) => {
    const hasBio = !!(cfg.biometric && cfg.biometric.enabled);
    const overlay = el('div', { class: 'lock-screen', id: '__lockScreen' });
    document.body.appendChild(overlay);
    document.body.classList.add('locked');

    const dots = el('div', { class: 'pin-dots' });
    const errorEl = el('div', { class: 'lock-error' });
    const subText = el('div', { class: 'lock-sub', text: hasBio ? 'Use biometric or enter your PIN' : 'Enter your PIN to unlock' });

    const finish = () => {
      overlay.classList.add('fade-out');
      document.body.classList.remove('locked');
      setTimeout(() => overlay.remove(), 240);
      resolve();
    };

    const ctrl = makePinController(dots, errorEl, async (pin) => {
      const ok = await verifyPin(pin).catch(() => false);
      if (ok) { finish(); return; }
      overlay.classList.add('shake');
      setTimeout(() => overlay.classList.remove('shake'), 420);
      ctrl.setError('Wrong PIN');
      ctrl.reset();
    });

    // silent=true on the auto-prompt: some browsers (notably Safari) require a
    // user gesture for credentials.get(), and we don't want a scary error toast
    // for that. The keypad 👆 button calls this with silent=false so a real
    // user cancel still shows feedback.
    const tryBio = async (silent) => {
      try {
        if (await verifyBiometric()) finish();
      } catch (e) {
        if (!silent) ctrl.setError('Biometric cancelled - use PIN');
      }
    };

    overlay.appendChild(el('div', { class: 'lock-card' }, [
      el('div', { class: 'lock-logo', text: '🔒' }),
      el('div', { class: 'lock-title', text: 'MyNotes' }),
      subText,
      dots,
      errorEl,
      buildKeypad(ctrl.onPress, hasBio ? () => tryBio(false) : null),
      el('div', { class: 'lock-foot' }, [
        el('button', { type: 'button', class: 'link-btn', text: 'Forgot PIN? Reset app', onclick: () => forgotPinFlow() }),
      ]),
    ]));

    // Auto-prompt biometric - feels native on mobile (lock screen → fingerprint).
    // silent=true so a browser that blocks auto-prompts (Safari) fails quietly
    // and the user just uses the keypad's 👆 key or types the PIN.
    if (hasBio) setTimeout(() => tryBio(true), 350);
  });
}

async function forgotPinFlow() {
  const warn = 'Resetting will erase ALL local data on this device and turn off the lock.\n\n' +
    'Make sure you have a recent backup (Menu → Export). You can re-import after reset.\n\nContinue?';
  if (!(await appConfirm(warn))) return;
  if (!(await appConfirm('Last warning - reset now and lose all unsynced changes?'))) return;
  try { await wipeAllData(); } catch (_) {}
  location.reload();
}

// First-time setup: enter PIN → confirm PIN → optional biometric.
async function openLockSetup() {
  const dots = el('div', { class: 'pin-dots' });
  const errorEl = el('div', { class: 'lock-error' });
  const title = el('div', { class: 'lock-title', text: 'Set up app lock' });
  const sub = el('div', { class: 'lock-sub', text: 'Choose a ' + PIN_LENGTH + '-digit PIN' });
  let stage = 'set';   // 'set' → 'confirm' → 'bio'
  let firstPin = '';

  const card = el('div', { class: 'lock-card lock-card-modal' });

  const showBioStep = async () => {
    stage = 'bio';
    sub.textContent = 'PIN saved. Want faster unlock with biometric?';
    dots.style.display = 'none';
    const keypad = card.querySelector('.kpad');
    if (keypad) keypad.style.display = 'none';
    const avail = await biometricAvailable();
    const enableBtn = el('button', {
      type: 'button', class: 'btn primary', text: avail ? 'Enable biometric' : 'Not available on this device',
      onclick: async () => {
        try {
          await registerBiometric();
          closeModal();
          toast('App lock enabled · biometric on');
        } catch (e) { errorEl.textContent = 'Could not enable: ' + (e.message || e); }
      },
    });
    if (!avail) enableBtn.disabled = true;
    card.appendChild(el('div', { class: 'lock-bio-row' }, [
      enableBtn,
      el('button', { type: 'button', class: 'btn ghost', text: 'Skip for now', onclick: () => { closeModal(); toast('App lock enabled'); } }),
    ]));
  };

  const ctrl = makePinController(dots, errorEl, async (pin) => {
    if (stage === 'set') {
      firstPin = pin; stage = 'confirm';
      sub.textContent = 'Confirm your PIN';
      ctrl.reset();
    } else if (stage === 'confirm') {
      if (pin === firstPin) {
        try { await setPin(firstPin); } catch (e) { ctrl.setError(e.message); ctrl.reset(); return; }
        showBioStep();
      } else {
        ctrl.setError('PINs didn\'t match - try again');
        firstPin = ''; stage = 'set';
        sub.textContent = 'Choose a ' + PIN_LENGTH + '-digit PIN';
        ctrl.reset();
      }
    }
  });

  card.appendChild(el('div', { class: 'lock-logo', text: '🔒' }));
  card.appendChild(title);
  card.appendChild(sub);
  card.appendChild(dots);
  card.appendChild(errorEl);
  card.appendChild(buildKeypad(ctrl.onPress, null));

  openModal(card);
}

// Change PIN flow: verify current PIN → new PIN → confirm new PIN.
async function openChangePin() {
  const dots = el('div', { class: 'pin-dots' });
  const errorEl = el('div', { class: 'lock-error' });
  const sub = el('div', { class: 'lock-sub', text: 'Enter current PIN' });
  let stage = 'old', newPin = '';
  const ctrl = makePinController(dots, errorEl, async (pin) => {
    if (stage === 'old') {
      if (!(await verifyPin(pin))) { ctrl.setError('Wrong PIN'); ctrl.reset(); return; }
      stage = 'new'; sub.textContent = 'Enter new PIN'; ctrl.reset();
    } else if (stage === 'new') {
      newPin = pin; stage = 'confirm'; sub.textContent = 'Confirm new PIN'; ctrl.reset();
    } else {
      if (pin === newPin) {
        try { await setPin(newPin); closeModal(); toast('PIN changed'); }
        catch (e) { ctrl.setError(e.message); ctrl.reset(); }
      } else {
        ctrl.setError('PINs didn\'t match'); stage = 'new'; sub.textContent = 'Enter new PIN'; newPin = ''; ctrl.reset();
      }
    }
  });
  openModal(el('div', { class: 'lock-card lock-card-modal' }, [
    el('div', { class: 'lock-logo', text: '🔒' }),
    el('div', { class: 'lock-title', text: 'Change PIN' }),
    sub, dots, errorEl, buildKeypad(ctrl.onPress, null),
  ]));
}

// Settings sheet shown when the user taps the menu item while lock is on.
async function openLockSettings() {
  const cfg = await getLockConfig();
  const bioAvail = await biometricAvailable();
  const items = [];
  items.push(menuItem('🔢', 'Change PIN', 'Set a new ' + PIN_LENGTH + '-digit PIN', () => { closeModal(); openChangePin(); }));
  if (cfg.biometric && cfg.biometric.enabled) {
    items.push(menuItem('👆', 'Disable biometric', 'Unlock with PIN only', async () => {
      await disableBiometric(); closeModal(); toast('Biometric disabled');
    }));
  } else if (bioAvail) {
    items.push(menuItem('👆', 'Enable biometric', 'Unlock with fingerprint or face', async () => {
      try { await registerBiometric(); closeModal(); toast('Biometric enabled'); }
      catch (e) { appAlert('Could not enable: ' + (e.message || e)); }
    }));
  }
  items.push(menuItem('🔓', 'Turn off app lock', 'Disable PIN and biometric', async () => {
    if (!(await appConfirm('Turn off the app lock?\n\nAnyone with this device will be able to open the app.'))) return;
    await disableLock(); closeModal(); toast('App lock disabled');
  }));
  openModal(el('div', { class: 'sheet' }, [
    el('h2', { text: 'App lock' }),
    el('p', { class: 'hint', text: 'Lock state stays on this device only. No data leaves your phone.' }),
    el('div', { class: 'menu-list' }, items),
    el('div', { class: 'btn-row' }, [el('button', { class: 'btn ghost', text: 'Close', onclick: closeModal })]),
  ]));
}

// Entry point invoked from the main menu. Routes to setup or settings.
async function openLockEntry() {
  const cfg = await getLockConfig();
  if (cfg && cfg.enabled) openLockSettings();
  else openLockSetup();
}

// ---------- app updates (user-triggered) ----------

// ---------- App updates ----------
// A new version is fetched in the background; a gradient card asks before it is
// applied, so the page never reloads under the user mid-task.
//
// Two independent signals raise the card, because relying on the browser's own
// service-worker events alone missed updates (the card never appeared and the
// app quietly ran one release behind):
//   1. the service worker reports a new worker installed and waiting;
//   2. the app itself compares the release it is RUNNING with the one on the
//      server (checkForNewVersion below) - that works even if (1) never fires.
const _releaseNum = (name) => Number((String(name).match(/-v(\d+)$/) || [])[1]) || 0;

// The release this page is running = the oldest MyNotes cache on the device (a
// newer worker's cache appears next to it while it waits, and the old one is
// deleted the moment that worker takes over).
async function _runningRelease() {
  if (!('caches' in window)) return 0;
  const nums = (await caches.keys()).filter((k) => /^mynote-app-v\d+$/.test(k)).map(_releaseNum);
  return nums.length ? Math.min(...nums) : 0;
}
async function _serverRelease() {
  // A UNIQUE url every time. The running service worker intercepts same-origin
  // GETs and answers from its own cache first, so a plain fetch of
  // service-worker.js returns the copy we are already running and every check
  // says "up to date" - which is exactly why the update card stopped appearing.
  // A url it has never cached cannot be answered from the cache.
  const r = await fetch('service-worker.js?_=' + Date.now(), { cache: 'no-store' });
  const m = (await r.text()).match(/const CACHE = '(mynote-app-v\d+)'/);
  return m ? _releaseNum(m[1]) : 0;
}
export async function checkForNewVersion() {
  try {
    if (navigator.onLine === false) return;
    const [running, latest] = await Promise.all([_runningRelease(), _serverRelease()]);
    if (running && latest && latest > running) showUpdatePopup(latest);
  } catch (_) { /* offline or blocked: try again next time */ }
}

// Last resort that always works: drop the worker and its caches, then reload so
// everything is fetched fresh. Your data (IndexedDB) is not touched.
async function _hardRefresh() {
  try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (_) {}
  try { for (const k of await caches.keys()) if (k.startsWith('mynote-app-')) await caches.delete(k); } catch (_) {}
  location.reload();
}

async function applyUpdate(titleEl) {
  titleEl.textContent = 'Updating…';
  // If nothing has happened after a few seconds, do the hard refresh instead.
  const bail = setTimeout(_hardRefresh, 7000);
  try {
    const reg = window.__swReg || (await navigator.serviceWorker.getRegistration());
    if (!reg) { clearTimeout(bail); return _hardRefresh(); }
    if (!reg.waiting) {
      try { await reg.update(); } catch (_) {}
      for (let i = 0; i < 20 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 250));
    }
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });   // controllerchange then reloads
    else { clearTimeout(bail); _hardRefresh(); }
  } catch (_) { clearTimeout(bail); _hardRefresh(); }
}

// Menu > Check for updates: always answers, even when the automatic card did not.
export async function manualUpdateCheck() {
  try {
    const [running, latest] = await Promise.all([_runningRelease(), _serverRelease()]);
    if (!latest) { toast('Could not read the latest version. Are you online?'); return; }
    if (latest > running) {
      try { sessionStorage.removeItem('mynoteUpdateLater'); } catch (_) {}
      showUpdatePopup(latest);
    } else toast('You are on the latest version (v' + running + ').');
  } catch (_) { toast('Could not check for updates. Are you online?'); }
}

const _dismissedRelease = () => Number(sessionStorage.getItem('mynoteUpdateLater') || 0);
function showUpdatePopup(release) {
  if (document.querySelector('.update-pop')) return;
  // "Later" is remembered for this visit, per release, so it is not nagged again
  // every check - a newer release still shows.
  if (release && _dismissedRelease() >= release) return;
  const title = el('div', { class: 'update-pop-title', text: 'New version available' });
  const pop = el('div', { class: 'update-pop', role: 'alertdialog', 'aria-label': 'Update available' }, [
    el('div', { class: 'update-pop-ico', text: '🚀' }),
    el('div', { class: 'update-pop-body' }, [
      title,
      el('div', { class: 'update-pop-sub', text: 'Update now to get the latest improvements.' }),
    ]),
    el('div', { class: 'update-pop-actions' }, [
      el('button', { class: 'update-pop-btn go', type: 'button', text: 'Update', onclick: () => applyUpdate(title) }),
      el('button', { class: 'update-pop-btn later', type: 'button', text: 'Later', onclick: () => {
        try { if (release) sessionStorage.setItem('mynoteUpdateLater', String(release)); } catch (_) {}
        pop.remove();
      } }),
    ]),
  ]);
  document.body.appendChild(pop);
}

// ---------- install ----------
function doInstall() {
  closeModal();
  triggerInstall();
}
export function canInstall() { return !!deferredInstall; }
export async function triggerInstall() {
  if (!deferredInstall) return false;
  const ev = deferredInstall;
  ev.prompt();
  let accepted = false;
  try { accepted = (await ev.userChoice).outcome === 'accepted'; } catch (_) {}
  deferredInstall = null;
  return accepted;
}

// ---------- init ----------
function bind() {
  $('#addBtn').addEventListener('click', () => openStockForm(null));
  $('#ocrBtn').addEventListener('click', openOcrFlow);
  $('#mfAddBtn').addEventListener('click', () => openFundForm(null));
  $('#mfFetchBtn').addEventListener('click', () => fetchMfNavs());
  $('#fdAddBtn').addEventListener('click', () => openFdForm(null));
  $('#metalAddBtn').addEventListener('click', () => openMetalTxn(null));
  $('#bondAddBtn').addEventListener('click', () => openBondForm(null));
  $('#efAddBtn').addEventListener('click', () => efAddForTab());
  $('#bankSavAddBtn').addEventListener('click', () => openBankSavForm(null));
  $('#ccAddBtn').addEventListener('click', () => openCreditCardForm(null));
  $('#spendAddBtn').addEventListener('click', openSpendQuick);
  $('#vaultAddBtn').addEventListener('click', async () => {
    if (!_vaultKey) return;
    openVaultForm(await import('./vault.js'), null);
  });
  $('#pfAddBtn').addEventListener('click', () => openPfSpendForm(null));
  $('#backBtn').addEventListener('click', goHome);
  $('#menuBtn').addEventListener('click', openMenu);
  $('#proBtn').addEventListener('click', () => openProInfo(state.appMode));
  const onSearch = debounce(renderList, 120);
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; onSearch(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyTheme();
  });
  watchVaultSession();
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
}

// Ask the browser to make our storage durable so the OS won't evict it under
// storage pressure. Pure upside; the user may see a prompt (Firefox) or it
// auto-grants for installed PWAs (Chrome). Failures are silent.
async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try { await navigator.storage.persist(); } catch (_) {}
  }
}

// One nudge a session, when there is something to lose and it has been either
// too long or too much since it was last saved.
//
// This began `const stocks = await DB.all('stocks'); if (!stocks.length) return;`
// which meant it never once fired for anyone whose data is spends, cards and
// passwords rather than shares - the people with the most to lose, since none
// of that exists anywhere else. A share can be re-entered from a statement; a
// password in the vault cannot be recovered from anything.
//
// Two triggers rather than one. Time alone nags people who have changed
// nothing, and a count alone never reaches someone who edits rarely but has
// years of history sitting on one phone.
const BACKUP_NUDGE_DAYS = 30;
const BACKUP_NUDGE_CHANGES = 25;

async function checkBackupReminder() {
  try {
    if (sessionStorage.getItem('backupNudgeShown')) return;
    const now = await dataCount();
    if (!now) return;                    // nothing on the device to lose yet
    const m = await DB.get('meta', 'lastBackup').catch(() => null);
    const c = await DB.get('meta', 'lastBackupCount').catch(() => null);
    const last = m && m.value ? m.value : 0;
    const then = c && typeof c.value === 'number' ? c.value : null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    // Unknown for a backup taken before the count was recorded. An unknown is
    // not treated as a reason to nag - the date on its own still is.
    const added = then == null ? null : Math.max(0, now - then);
    const stale = days == null || days > BACKUP_NUDGE_DAYS;
    const drifted = added != null && added >= BACKUP_NUDGE_CHANGES;
    if (!stale && !drifted) return;

    const ago = days + (days === 1 ? ' day' : ' days') + ' ago';
    let msg;
    if (days == null) {
      // The one case worth naming what is at stake rather than counting it.
      // More than one row, because a vault that exists always holds the
      // hidden copy of its own master password. The rows are ciphertext, so
      // nothing out here can tell which one that is - the count is all there
      // is to go on, and one row means nothing has been saved yet.
      const vault = await DB.all('vault').catch(() => []);
      const verb = now === 1 ? ' exists' : ' exist';
      msg = 'No backup yet · ' + now + (now === 1 ? ' entry' : ' entries')
        + (vault.length > 1 ? ', passwords included,' + verb : verb) + ' only on this phone';
    } else if (drifted) {
      msg = added + ' new since your last backup, ' + ago;
    } else {
      msg = 'Last backup ' + ago;
    }
    sessionStorage.setItem('backupNudgeShown', '1');
    setTimeout(() => toast(msg + ' · tap to back up', () => openBackupSheet()), 1500);
  } catch (_) {}
}
function checkMonthEndSnapshotReminder() {
  if (!isMonthEndReminderWindow() || !missingCurrentMonthCapture(state.months)) return;
  const key = 'snapshotReminderShown_' + state.portfolio + '_' + thisYm();
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  setTimeout(() => toast('Month-end reminder: capture ' + ymToLabel(thisYm()) + ' snapshot'), 2300);
}


// Handle quick-add shortcuts from home screen or share intent
// URL params: ?quickadd=spend or ?quickadd=personal
function _checkQuickAddIntent() {
  try {
    const params = new URLSearchParams(location.search);
    const quickAdd = params.get('quickadd');
    if (!quickAdd || !state) return;
    
    if ((quickAdd === 'spend' && _modeBlocked('expense')) || (quickAdd === 'personal' && _modeBlocked('personal'))) {
      _sendToFeaturePicker();
      return;
    }
    if (quickAdd === 'spend') {
      state.appMode = 'expense';
      ui._expTab = 'spend';
      renderHomeExpense();
      setTimeout(() => openSpendQuick(), 200);
    } else if (quickAdd === 'personal') {
      state.appMode = 'personal';
      ui._pfTab = 'spends';
      renderPersonal();
      setTimeout(() => openPfSpendForm(null), 200);
    }
  } catch (e) {
    console.error('quickadd error:', e);
  }
}

function _isInstalledApp() {
  try {
    if (navigator.standalone) return true;
    if (document.referrer && document.referrer.startsWith('android-app://')) return true;
    return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
      .some((m) => window.matchMedia('(display-mode: ' + m + ')').matches);
  } catch (_) { return false; }
}
function _shouldShowLanding() {
  if (/[?&]testdb=1/.test(location.search)) return false;   // automated tests run the app itself
  if (new URLSearchParams(location.search).has('landing')) return true;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return false;
  return !_isInstalledApp();
}

async function init() {
  applyTheme();
  buildChrome();
  // Before anything renders a picker or groups a month by category.
  await loadCategoryLists().catch(() => {});
  // Seed the root history entry as depth 0 - every setAppMode() push builds on
  // top of this, so unwinding all the way back here (goHome, or one back-step
  // per level) leaves nothing of ours left to pop, and the next back gesture
  // correctly falls through to the browser/OS default (closing the app).
  try { history.replaceState({ appMode: 'home', depth: 0 }, '', location.pathname + location.search); } catch (_) {}
  window.addEventListener('popstate', (e) => {
    const mode = (e.state && e.state.appMode) || 'home';
    applyAppMode(mode);
  });
  bind();
  // Opened as an ordinary web page (not installed)? Show what the app is and how
  // to install it - the app itself only opens once installed. localhost is left
  // open for development; ?landing=1 forces the page for testing.
  if (_shouldShowLanding()) {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).catch(() => {});
    const { showLanding } = await import('./landing.js');
    showLanding();
    return;
  }
  // App-lock gate: if the user has set a PIN, block here until they unlock.
  // Data load happens *after* unlock - so even if the overlay is somehow
  // bypassed, the in-memory state is still empty until verification succeeds.
  try { await showLockScreen(); } catch (e) { console.error('lock screen error', e); }
  // Load the stock data (render() no-ops while appMode==='home'), then show the
  // Home launcher. Tapping "Stocks" just unhides the already-loaded surface.
  try { await refresh(); } catch (e) { console.error(e); toast('Could not open local database'); }
  getInstallId().catch(() => {});
  // The remembered plan is applied before the first screen so a Pro member sees Pro even offline.
  document.body.dataset.plan = await getCachedPlan();
  // The choose-features overlay (if needed) is up BEFORE Home is shown.
  await maybeShowOnboarding();
  const _testMode = applyUsageTestParam();
  if (_testMode) toast(_testMode === 'on' ? 'Usage test mode ON for this device only' : 'Usage test mode OFF');
  sendUsage().catch(() => {});
  // Every time the app opens (and whenever the phone comes back online) ask the server whether this install
  // has Pro. Silent when offline or when it cannot be reached: the remembered plan stays.
  checkPlan().catch(() => {});
  window.addEventListener('online', () => { checkPlan().catch(() => {}); });
  // Also ask again whenever the person comes back to the app, and every few minutes while it stays open, so an
  // upgrade made elsewhere (or by the admin) shows up while they are looking at the app, not only at the next launch.
  // At most one question every 20 seconds, and only while the app is on screen and online.
  let lastPlanAsk = Date.now();
  const askPlan = () => {
    if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
    if (Date.now() - lastPlanAsk < 20000) return;
    lastPlanAsk = Date.now();
    checkPlan().catch(() => {});
  };
  document.addEventListener('visibilitychange', askPlan);
  window.addEventListener('focus', askPlan);
  setInterval(askPlan, 5 * 60 * 1000);
  window.addEventListener('mynote-plan', (e) => {
    const plan = e.detail && e.detail.plan === 'paid' ? 'paid' : 'free';
    const wasPaid = document.body.dataset.plan === 'paid';
    document.body.dataset.plan = plan;
    if (plan === 'paid' && !wasPaid) toast('Your Pro Plan is active. Thank you!');
    if (plan !== 'paid' && wasPaid) toast('Your Pro Plan has ended. You are on the Free Plan.');
    getEnabledModules().catch(() => {}).then(async () => {
      // The icon and badge change with a short crossfade in either direction, not a jump.
      if ((plan === 'paid') !== wasPaid) await playPlanChange(plan === 'paid');
      // Through the same entry as a normal open, so a first-run install that turned out to be Pro still gets the
      // welcome and the Terms/Privacy confirmation before the setup, never straight into it.
      if (plan === 'paid') await maybeShowOnboarding();
      // Back to Free: every feature is no longer on, so the person has to keep at most FREE_FEATURE_LIMIT of them.
      // Their earlier choice is used when it fits; otherwise they pick again. Nothing they entered is deleted.
      if (plan !== 'paid' && wasPaid && !document.querySelector('.onboard') && (!_modsCache || _modsCache.size > FREE_FEATURE_LIMIT)) {
        await openFeaturePicker({ required: true });
        return;
      }
      // Whatever screen is showing is redrawn under the new plan (locks, buttons, badges), unless the person is
      // in the middle of a form or a setup flow: those are left alone and pick the plan up when they close.
      if (!document.querySelector('.modal-host:not(.hidden), .onboard')) applyAppMode(state.appMode);
      else if (state.appMode === 'home') renderHome();
    });
  });
  applyAppMode('home');
  if ('serviceWorker' in navigator) {
    try {
      // updateViaCache: 'none' ensures any update check bypasses the HTTP cache
      // for the SW script - so we always see the bumped CACHE = 'vNN'. Updates
      // are checked in the background and only APPLIED when the user taps
      // Update on the popup.
      const reg = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
      window.__swReg = reg;

      // Mark "update ready" if a new SW is already waiting (e.g. installed in
      // a previous tab/session) and we have an active controller serving us.
      const markReady = () => {
        if (navigator.serviceWorker.controller) showUpdatePopup();
      };
      // Watch a worker until it is installed. Covers all three moments an update
      // can be in: already waiting, already installing when this page opened (the
      // "updatefound" event has then already fired and is never repeated), or
      // found later.
      const watch = (sw) => {
        if (!sw) return;
        if (sw.state === 'installed') markReady();
        sw.addEventListener('statechange', () => { if (sw.state === 'installed') markReady(); });
      };
      watch(reg.waiting);
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));

      // Look for a new version now, whenever the app comes back to the
      // foreground, and every 30 minutes while it stays open.
      const checkNow = () => { reg.update().catch(() => {}); checkForNewVersion(); };
      checkNow();
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkNow(); });
      setInterval(checkNow, 30 * 60 * 1000);

      // controllerchange fires when the new SW claims the page (after the
      // user's tap triggered SKIP_WAITING). This reload is intentional.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    } catch (e) { console.warn('SW registration failed', e); }
  }
  requestPersistentStorage();
  checkBackupReminder();
  checkMonthEndSnapshotReminder();
  // Idempotent: back-fills wife-in (and reverse) months with the peer's Nifty
  // where one side is missing it. Cheap; a no-op once everything's in sync.
  syncNiftyAll().catch(() => {});
  // Check for quick-add intent from home screen shortcuts
  _checkQuickAddIntent();
  // Silent feed refresh on app open - so the user doesn't have to visit the
  // Feed tab to get fresh news. Fires for the active portfolio when its
  // session-anchor sync is stale.
  _autoRefreshFeedOnInit().catch(() => {});
}

init();
