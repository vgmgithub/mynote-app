import { thisYm, todayISO, num } from './core.js';
import { recentCategories, usualAmounts, lastChoice, leftAfter, dayShift } from './spend-quick.js';
import { quickCategories, amountChips, dateChips, bigAmount, leftLine, leftWords, afterWords, markMissing, addedPill, stepFlow, groupHue, budgetCard } from './spend-kit.js';
import { fmtIntCur, renderPersonal, tagsOf, isForOthers, TAG_MAX, updateExpNavActive, spendEntryFilter, spendFilterNote, tagRow, tagField, knownTags, knownTagsFor, catAddBtn, openCatManager, normaliseTag, EXP_TABS, reviewMovedNote } from './personal-ui.js';
import { ui } from './state.js';
import { DB } from './db.js';
import { renderCc } from './cc-ui.js';
import { efLoad } from './ef.js';
import { _vaultCopyBtn } from './vault-ui.js';
import { el, b, modOn, _modsCache, state, $, toast, closeModal, openModal, EXPENSE_START_YM, expRenderStale, appConfirm, _historyIcon, _spendableDaysLeft, perDayLabel, perDayAllowance, TRACKER_START_YM, field, _fetchLiveRates, isSgb } from './app.js';
import { _reviewKittyFit, DAY_DETAIL_FROM_YM, dayDetailOk, _reviewSmallTickets, _reviewCreeping, _reviewMethods, _emergencyDrawIn, _repayEarmarkIn, _sharedFor, _kittyNoEarmark, _kittyFor, _reviewIgnores, REVIEW_MIN_HISTORY, _median, REVIEW_FORECAST_MIN, _reviewForecast, _reviewCycle, _reviewCurve, _catMonthHistory, _smallTicketUsual, rvwKeepList, _reviewSavings, _reviewAnalysis } from './expense-review-logic.js';
import { renderAllocation } from './expense-alloc.js';
import { openSpendForm } from './spend-form.js';
import { explainRow, _rvwMonthBars } from './expense-review.js';
import { renderSpendTracker, _spendMonthLabel, ccReimbursements } from './expense-tracker.js';
import { renderTagAnalysis } from './expense-tags.js';
import { renderExpenseSheet } from './expense-sheet.js';
export { sheetLoanSummary, openLoanEntries, isOwedRow, syncOwedRow, dropOwedRow } from './expense-sheet.js';
export { renderTagAnalysis } from './expense-tags.js';
export { _trkHeatmapGrid } from './expense-heatmap.js';
export { _spendMonthLabel, _thisSpendYm, _reimbParts, _reimbMap } from './expense-tracker.js';
export { openInfoSheet, explainRow, rvwSection, _rvwCurveChart, _rvwMonthBars, renderReview, rvwBudgetBadge, rvwBudgetRow, _rvwScopeLine, _rvwCreepingSection, _rvwMethodsSection, _rvwFitSection, _ordinalSuffix, _recurringDue } from './expense-review.js';
export { openSpendQuick } from './spend-form.js';
export { openAllocFormForThisYear } from './expense-alloc.js';
export { _reviewKittyFit, _reviewSmallTickets, _reviewCreeping, _reviewMethods, _sharedFor, _kittyFor, REVIEW_MIN_HISTORY, _daysInYm, _reviewForecast, _reviewCycle, _reviewCurve, _catMonthHistory, _smallTicketUsual, _whenInMonth, rvwKeepList, _reviewSavings, _reviewAnalysis } from './expense-review-logic.js';


// ---------- Expense section page (Credit Card | Allocation | Expense) ----------
export async function renderHomeExpense() {
  // Logged from the Home FAB: Home's FAB rings (personal-ui.js) catch up.
  if (state.appMode === 'home') { try { window.dispatchEvent(new Event('mynote-spend-saved')); } catch (_) {} }
  // Does nothing unless the Expense section is actually on screen. The spend
  // form can be opened from the FAB on HOME, and its save calls back here to
  // refresh the Tracker — which used to repaint a hidden view and, worse,
  // reset the FABs from `_expTab` (still 'cc' when the section was never
  // opened), so Home was left showing the add-credit-card button. Which FAB
  // belongs to which screen is applyAppMode's business, not this function's.
  // Credit Cards has its own screen now; its saves still call this to refresh.
  if (state.appMode === 'cc') { renderCc(); return; }
  if (state.appMode !== 'expense') return;
  // Credit Cards and Review both moved out of here (to their own feature, and to Analysis); a tab left on either
  // opens the Tracker.
  if (!EXP_TABS.some(([v]) => v === ui._expTab)) ui._expTab = 'tracker';

  const host = $('#expenseView');
  host.innerHTML = '';
  updateExpNavActive();
  $('#ccAddBtn').classList.add('hidden');
  $('#spendAddBtn').classList.toggle('hidden', ui._expTab !== 'tracker');

  const token = ++ui._expRenderToken;
  if (ui._expTab === 'alloc') { await renderAllocation(host, token); return; }
  if (ui._expTab === 'tracker') {
    await reviewMovedNote(host, renderHomeExpense);
    if (expRenderStale(token)) return;
    await renderSpendTracker(host, token);
    return;
  }
  if (ui._expTab === 'cat') {
    const m = await import('./category-spend.js');
    if (expRenderStale(token)) return;
    await m.renderCategorySpend(host, token, { kind: 'house', stale: expRenderStale, rerender: renderHomeExpense });
    return;
  }
  if (ui._expTab === 'tags') { await renderTagAnalysis(host, token, { source: 'house', rerender: renderHomeExpense, stale: expRenderStale }); return; }
  await renderExpenseSheet(host, token);
}

// Expense-sheet money formatting: whole rupees when the figure IS whole,
// otherwise two decimals. Sources like the emergency fund's available cash come
// out fractional, and rounding those away would make a box disagree with the
// number printed above it.
// Two decimal places, and never 0.1 + 0.2 = 0.30000000000000004.
export const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const _msheetCurFmt2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtSheetCur = (n) => {
  const v = round2(n);
  return Number.isInteger(v) ? fmtIntCur(v) : _msheetCurFmt2.format(v);
};

// A committed row's box holds an ADDITIVE EXPRESSION, not a single number:
// "2000+5000" keeps what was added and when, instead of collapsing to 7000 the
// moment it's entered. Fetch appends its figure as another term. The row's
// headline is the sum.
//
// Parsed by pulling out every signed number rather than evaluating: the input
// is user text, and a regex sum can't be tricked into running anything. A bare
// "-500" term still subtracts, so a correction doesn't need a separate field.
export const sumExpr = (s) => {
  const parts = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?/g);
  return parts ? round2(parts.reduce((a, b) => a + Number(b), 0)) : 0;
};
// Trailing zeros off, so an appended term reads "+5000" not "+5000.00".
export const exprTerm = (n) => String(round2(n));
// Clamp every term in an expression to 2dp, leaving the "+" structure alone.
// Sources are computed by float arithmetic (the emergency fund's available cash
// especially), and earlier versions stored the raw sum — so a box could hold
// "140600.25999999999". Applied on read AND on save, so those clean themselves
// up the next time the month is touched, with no migration.
export const normaliseExpr = (s) => String(s == null ? '' : s).replace(/-?\d+(?:\.\d+)?/g, (m) => String(round2(m)));




// ---------- Daily spend tracker (Expense → Tracker tab) ----------
// The household kitty for THIS month: what the budget is, what's gone, what's
// left. One row per spend (see db.js `spends`), rolled up by category here.
//
// Categories are fixed rather than free text — the whole point is that the same
// grocery run lands in the same bucket every time, which typing can't promise.
// Grouped only for the picker's sake; the group isn't stored, so regrouping
// later can't strand existing rows.
// ---------- Personal Finance ----------
//
// The Tracker in Expense is HOUSEHOLD spending, measured against a kitty of
// House Exp doubled. This is the other half of the card bill: what gets spent
// on the person rather than the house, against its own allowance.
//
// Kept apart from household spending everywhere - own store, own categories,
// own limits - because the two answer different questions and only the
// household half is credited back on a card. Mixing them is how a month's
// household total quietly starts including a haircut.
const PERSONAL_CATEGORIES = [
  { group: 'Food', items: ['Eat Out', 'Order In', 'Tea & Snacks', 'Coffee'] },
  { group: 'Shopping', items: ['Clothes', 'Footwear', 'Gadgets', 'Accessories'] },
  { group: 'Travel', items: ['Fuel', 'Cab & Auto', 'Train & Bus', 'Stay', 'Trip'] },
  { group: 'Health', items: ['Gym', 'Grooming', 'Medicine', 'Supplements'] },
  { group: 'Fun', items: ['Movies', 'Subscriptions', 'Games', 'Books', 'Outing'] },
  { group: 'Other', items: ['Gift', 'Recharge', 'Fees & Charges', 'Misc', 'Refund'] },
];

// ---------- Refund: a spend that came back ----------
//
// The one category that is not spending. A return, a cancelled booking, a
// friend settling up - money that has already been logged as gone and has now
// come back, so the month's total has to come down by it.
//
// It is stored as a NEGATIVE amount, and that is the whole implementation.
// Every figure on this section is some `reduce((a, r) => a + r.amount)` over
// the same rows - the two limits, the category roll-up, Review, what is logged
// against a card, Card check - and a negative term is already correct in all
// of them. A positive amount plus a "this one is a refund" flag would mean
// finding and fixing every one of those sums, and being wrong wherever one was
// missed.
//
// So the SIGN is what the arithmetic and the colour read, never the name: a
// category renamed later leaves its entries adding up exactly as before.
//
// The household kitty works the same way and for the same reasons - a returned
// pair of shoes and a returned grocery order are the same event - so this is
// one constant serving both sides rather than two that could drift apart.
export const REFUND_CAT = 'Refund';
export const isRefund = (r) => (Number(r && r.amount) || 0) < 0;
// What a refund reads as on screen: money back, in green, never a minus sign
// buried in a column of black figures.
const fmtRefund = (amt) => '+' + fmtSheetCur(Math.abs(Number(amt) || 0));
export const fmtSigned = (amt) => (Number(amt) < 0 ? fmtRefund(amt) : fmtSheetCur(amt));
// Card and UPI only. There is no cash line because a personal allowance is
// held on a card and a UPI handle, and a method nobody uses is one more tap
// on every entry.
export const PF_METHODS = ['Card', 'UPI'];
export const PF_START_YM = '2026-09';        // the month this started being tracked

// ---------- The two category lists, editable ----------
//
// The constants above are DEFAULTS - what a fresh install starts from - not the
// live lists. Both are editable and stored in `meta`, which keeps them inside
// backup and restore without a schema change.
//
// Household and personal stay SEPARATE. They are genuinely different
// vocabularies: one has Rent and Milk in it, the other Gym and Movies, and
// merging them would make every picker twice as long and half as useful.
export const CAT_KINDS = {
  spend: { metaKey: 'spendCategories', store: 'spends', fallback: () => SPEND_CATEGORIES, label: 'household spends' },
  pf: { metaKey: 'pfCategories', store: 'personalSpends', fallback: () => PERSONAL_CATEGORIES, label: 'personal spends' },
};
let _catLists = { spend: null, pf: null };
export let _catMaps = { spend: new Map(), pf: new Map() };

// Whatever is on record for a kind, or the built-in list until one is saved.
export const catList = (kind) => _catLists[kind] || CAT_KINDS[kind].fallback();
const _buildCatMap = (list) => {
  const m = new Map();
  (list || []).forEach((g) => (g.items || []).forEach((n) => m.set(n, g.group)));
  return m;
};
// Anything unrecognised - a category retired from the list but still sitting in
// old months - lands in Other rather than disappearing along with its money.
export const _pfGroupOf = (name) => _catMaps.pf.get(name) || 'Other';
export const _spendGroupOf = (name) => _catMaps.spend.get(name) || 'Other';

// Read both lists once at boot, and again after any edit. Shape is validated on
// the way in: a hand-edited backup should not be able to put a picker into a
// state the form cannot render.
export async function loadCategoryLists() {
  for (const kind of Object.keys(CAT_KINDS)) {
    let list = null;
    try {
      const row = await DB.get('meta', CAT_KINDS[kind].metaKey);
      const raw = row && row.value;
      if (Array.isArray(raw)) {
        list = raw
          .map((g) => ({
            group: String((g && g.group) || '').trim(),
            items: Array.isArray(g && g.items)
              ? g.items.map((x) => String(x || '').trim()).filter(Boolean)
              : [],
          }))
          .filter((g) => g.group);
        if (!list.length) list = null;
      }
    } catch (_) { list = null; }
    // Refund is not an ordinary category the user curates - it is how money
    // coming back is recorded, and both tabs' arithmetic assumes it can be
    // reached. Put back in memory only, so a list saved before it existed
    // still offers it without rewriting what the user saved.
    if (list && !list.some((g) => (g.items || []).indexOf(REFUND_CAT) >= 0)) {
      const other = list.find((g) => g.group === 'Other') || list[list.length - 1];
      if (other) other.items = (other.items || []).concat([REFUND_CAT]);
    }
    _catLists[kind] = list;
    _catMaps[kind] = _buildCatMap(catList(kind));
  }
}
export async function saveCategoryList(kind, list) {
  await DB.put('meta', { key: CAT_KINDS[kind].metaKey, value: list, updatedAt: new Date().toISOString() });
  await loadCategoryLists();
}
export const _pfGroupClass = (group) => 'pf-g-' + String(group).toLowerCase().replace(/[^a-z]/g, '');

// Entries filter: 'all', 'upi', or 'card:<id>' for one card. Only the entry
// LIST is narrowed - the allowance strips above stay whole, because the card
// limit is one figure across every card and showing a single card against it
// would read as a per-card limit.
// Same render-race guard the Expense section uses: every tab here awaits a
// read, and a fast tab switch must not let a stale one paint over the new one.
export const pfRenderStale = (token) => token !== ui._pfRenderToken;

// The month's two allowances. The card figure is the Yearly plan tab's own
// "Card" line - the one place the household budget is already written down -
// so it is read live rather than copied. The UPI one has no home in that
// budget, so it is a setting of its own.
export function _pfCardLimit(ym, allocs) {
  const al = (allocs || []).find((x) => Number(x.year) === Number(String(ym).slice(0, 4)));
  return al ? round2(Number(al.card) || 0) : 0;
}
export async function _pfUpiLimit() {
  const row = await DB.get('meta', 'pfUpiLimit').catch(() => null);
  const v = row ? Number(row.value) : NaN;
  return v > 0 ? round2(v) : 0;
}

export const SPEND_CATEGORIES = [
  { group: 'Fixed', items: ['Rent', 'Electricity', 'Internet', 'Water', 'GAS'] },
  { group: 'Home', items: ['Pet Spend', 'Plants / Aquarium', 'Urban/House', 'Medicine'] },
  { group: 'Grocery', items: ['Online Grocery', 'Flipkart Grocery', 'Amazon Grocery', 'Local Shop', 'Brigade', 'Milk', 'Non veg', 'Fruits'] },
  { group: 'Lifestyle', items: ['Dining', 'App Subscription', 'Cinema'] },
  { group: 'Other', items: ['Prev Bill Bal / Misc', 'Refund'] },
];
export const SPEND_METHODS = ['UPI', 'Card', 'Cash'];
// Category -> its picker group, and that group's colour class. Built from the
// same list the form uses, so a category can never drift into a group the
// picker doesn't show. Anything unrecognised (a category retired from the list
// but still sitting in old months) lands in Other rather than disappearing.
export const _spendGroupClass = (group) => 'trk-g-' + String(group).toLowerCase().replace(/[^a-z]/g, '');



// "12 Sep" — short, since the rows already sit under one month.
export const _SPEND_MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function _spendDayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? String(+m[3]) + ' ' + _SPEND_MONS[+m[2] - 1] : '—';
}


// Swipe left/right to step a month, matching the Credit Card tab (left goes
// forward in time). Attached to a whole tab body, but a gesture starting inside
// the month strip is ignored: that strip scrolls horizontally, so a swipe there
// is the user scrolling it, not asking to change month.
//
// The move must also be mostly horizontal. Without that, a diagonal flick while
// scrolling the page changes month underneath you, which reads as the app
// losing your place.
// ---------- Month-timeline scroll behaviour (shared) ----------
// Every month strip in the Expense section - Credit Card, Tracker, Review - is
// rebuilt from scratch on each render, which means its scroll container is new
// and its scrollLeft starts at 0. Centring the selected chip from there made a
// click on "three months back" animate all the way from the FIRST month, and a
// re-render for any other reason (saving a spend, switching the inner view)
// threw away wherever the strip had been scrolled to.
//
// So the offset is remembered per strip and restored before anything is
// animated: a pick then slides only the remaining distance, and a plain
// re-render leaves the strip exactly where it was.
const _monthStripScroll = new Map();

// Mounts a month strip. `key` names the strip (its own scroll memory), `wrap`
// is the overflow container, `animate` says the user just picked a month, so
// the move to centre is worth showing.
export function _mountMonthStrip(key, wrap, animate) {
  const saved = _monthStripScroll.get(key);
  const hadSaved = saved != null && saved > 0;
  if (hadSaved) wrap.scrollLeft = saved;
  // Manual scrolling is what most of these offsets come from.
  wrap.addEventListener('scroll', () => { _monthStripScroll.set(key, wrap.scrollLeft); }, { passive: true });

  // Centring needs real geometry, and the strip has none until it is laid out.
  // One frame is enough, and it is after the restore above, so nothing is ever
  // seen at 0.
  requestAnimationFrame(() => {
    if (!wrap.isConnected) return;
    const chip = wrap.querySelector('.cc-timeline-chip.active');
    if (!chip) return;
    const view = wrap.clientWidth;
    const max = Math.max(0, wrap.scrollWidth - view);
    const centre = Math.max(0, Math.min(max, chip.offsetLeft - (view - chip.offsetWidth) / 2));
    // On a plain re-render the user's own scroll position wins - unless the
    // selected month has been left off-screen by it, which would hide the one
    // chip the rest of the page is about.
    if (!animate && hadSaved) {
      const l = chip.offsetLeft - wrap.scrollLeft;
      if (l >= 0 && l + chip.offsetWidth <= view) return;
    }
    if (Math.abs(centre - wrap.scrollLeft) < 2) return;
    // scrollTo on the strip, not scrollIntoView on the chip: these strips are
    // sticky, and scrollIntoView walks up the ancestors and moves the PAGE's
    // scroll too.
    _monthStripScroll.set(key, centre);
    if (animate && typeof wrap.scrollTo === 'function') wrap.scrollTo({ left: centre, behavior: 'smooth' });
    else wrap.scrollLeft = centre;
  });
}

// A drag that starts inside something that scrolls SIDEWAYS belongs to that
// strip, not to the month. The month timeline was the first of these; the
// entries filter is the second, and scrolling its chips was moving the month
// instead of the chips.
//
// Two tests rather than a list of class names. The computed one covers any
// strip added later without having to remember this function exists; the named
// one covers a strip that happens not to overflow right now - a timeline of
// three chips still owns its own gestures, because whether it scrolls today
// depends on how many months are on record.
const SWIPE_OWN_STRIPS = '.cc-timeline-scroll, .pf-filter';
function _ownsHorizontalDrag(target, stopAt) {
  if (target && target.closest && target.closest(SWIPE_OWN_STRIPS)) return true;
  for (let n = target; n && n !== stopAt; n = n.parentElement) {
    if (n.nodeType !== 1) continue;
    if (n.scrollWidth - n.clientWidth > 4) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}

export function _attachMonthSwipe(node, months, curYm, pick) {
  let x0 = 0, y0 = 0, startedIn = null;
  const THRESHOLD = 50;
  node.addEventListener('touchstart', (e) => {
    startedIn = e.target;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  node.addEventListener('touchend', (e) => {
    if (_ownsHorizontalDrag(startedIn, node)) return;
    const dx = x0 - e.changedTouches[0].clientX;
    const dy = y0 - e.changedTouches[0].clientY;
    if (Math.abs(dx) < THRESHOLD) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const next = months[months.indexOf(curYm) + (dx > 0 ? 1 : -1)];
    if (next) pick(next);
  }, { passive: true });
}





// Combined metals portfolio: digital gold + SGB (from Stocks, valued at the gold
// ₹/gram price) as one gold figure, plus silver. Shared by Home + Overview so the
// two never drift. SGB grams count as gold ("end of the day it's gold").
export async function metalPortfolio() {
  const mod = await import('./metal.js');
  let [txns, liveMeta, stocks] = await Promise.all([
    DB.all('metals').catch(() => []),
    DB.get('meta', 'homeLiveRates').catch(() => null),
    DB.all('stocks').catch(() => []),
  ]);
  // The manual "Set price" flow is gone (superseded by the Home strip's live
  // fetch, 2026-09-15) - if nothing has EVER been fetched yet (a fresh
  // install opened straight to Metals before Home got a chance to), fetch it
  // now rather than valuing every holding at ₹0.
  let live = (liveMeta && liveMeta.value) || null;
  if (!live) live = await _fetchLiveRates().catch(() => null) || {};
  const goldPrice = Number(live.gold) || 0, silverPrice = Number(live.silver) || 0;
  const gd = mod.summary(txns, 'gold', goldPrice);      // digital gold only
  const silver = mod.summary(txns, 'silver', silverPrice);
  const sgbs = stocks.filter(isSgb);
  let sgbGrams = 0, sgbInv = 0;
  sgbs.forEach((x) => { const u = Number(x.units) || 0; sgbGrams += u; sgbInv += u * (Number(x.buyPrice) || 0); });
  const grams = gd.grams + sgbGrams;
  const gold = {
    grams, invested: gd.invested + sgbInv, value: grams * goldPrice,
    realized: gd.realized, digital: gd, sgbGrams, sgbInv, sgbCount: sgbs.length, price: goldPrice,
  };
  gold.pl = gold.value - gold.invested;
  gold.plPct = gold.invested > 0 ? (gold.pl / gold.invested) * 100 : null;
  return { gold, silver, live, hasTxns: (txns || []).length > 0 };
}
export const _gramsShort = (x) => String(Math.round((Number(x) || 0) * 100) / 100);
