// Review logic (pure, no DOM): month fit, forecast, cycle, savings and kitty maths. Split out of expense-ui.js.
import { fmtIntCur } from './personal-ui.js';
import { el, perDayAllowance } from './app.js';
import { round2, fmtSheetCur, _spendGroupOf, _spendDayLabel } from './expense-ui.js';

// Is the kitty itself the problem? Being over most months is not a discipline
// finding, it is a budget finding — and answering "spend less" to a household
// whose allocation was never realistic is the wrong advice. Completed months
// only: the current one is part-way through and would drag every figure down.
//
// `kittyOf` is passed in because the House Exp allocation is per YEAR, so a
// window spanning a year boundary has two different kitties in it.
export function _reviewKittyFit(ym, byYm, kittyOf, thisYm) {
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // Every month on record that had spending and a budget behind it - no window.
  // This is a month-TOTAL question, so it is not day-floored, and it does not
  // age out either: each month is judged against the kitty that applied in that
  // month (kittyOf(k), not today's), so an older month is compared fairly
  // rather than against a figure it never had. More months simply means a
  // better-founded answer, and the count is printed so the reader can see how
  // much is behind it.
  const months = [...byYm.keys()]
    .filter((k) => k < thisYm && totalOf(k) > 0 && kittyOf(k) > 0)
    .sort();
  if (months.length < 3) return null;

  const rows = months.map((k) => ({ ym: k, total: totalOf(k), kitty: kittyOf(k) }));
  const over = rows.filter((r) => r.total > r.kitty);
  const totals = rows.map((r) => r.total);
  const leanest = rows.reduce((a, b) => (b.total < a.total ? b : a));
  const heaviest = rows.reduce((a, b) => (b.total > a.total ? b : a));

  // What kitty would have covered all but the single worst month. Taking the
  // very highest would size the budget to one outlier; the second-highest
  // covers the realistic range. Rounded up to a round number, because nobody
  // sets an allocation to ₹24,317.
  const sorted = totals.slice().sort((a, b) => b - a);
  const target = sorted.length > 1 ? sorted[1] : sorted[0];
  const suggested = Math.ceil(target / 500) * 500;
  const covered = rows.filter((r) => r.total <= suggested).length;
  const currentKitty = kittyOf(ym);

  return {
    months: rows.length, overCount: over.length,
    avgOvershoot: over.length ? round2(over.reduce((s, r) => s + (r.total - r.kitty), 0) / over.length) : 0,
    leanest, heaviest, suggested, covered, currentKitty,
    // Only worth suggesting a change if it is both higher than what is set and
    // would actually have covered more months than the present figure did.
    coveredNow: rows.filter((r) => r.total <= currentKitty).length,
  };
}

// Where a month bleeds out in small pieces. Nothing else in the app looks at
// individual entries — every other view sums them — and a month is often lost
// to forty small taps rather than one big one.
const SMALL_TICKET = 200;
// ---------- Where the DAY inside a month can be trusted ----------
//
// Two different questions are asked of history on the Review tabs, and the same
// months are not equally good at answering both.
//
//   WHAT was spent, by category, month by month - "how much on food in March" -
//   is sound all the way back. Those months were entered from records that had
//   the totals right.
//
//   WHEN inside the month it was spent - which day, how many separate
//   payments, weekday or weekend - is not. Older months were reconstructed
//   afterwards: the category totals were known, the individual dates were not,
//   so entries carry a date that was near enough for the month and no better
//   than that.
//
// Reading a day-of-month pattern out of dates that were never observed would
// invent a spending habit and then advise against it. So anything that looks
// INSIDE a month is floored at the month real day-by-day logging began, while
// the category comparisons keep the full history.
//
// One line to move if the floor ever changes; nothing else needs touching.
export const DAY_DETAIL_FROM_YM = '2026-09';
export const dayDetailOk = (ym) => String(ym || '') >= DAY_DETAIL_FROM_YM;

export function _reviewSmallTickets(ym, byYm) {
  const rows = byYm.get(ym) || [];
  if (!rows.length) return null;
  const small = rows.filter((r) => (Number(r.amount) || 0) > 0 && (Number(r.amount) || 0) <= SMALL_TICKET);
  // Under five of them there is no pattern to report, just a few small buys.
  if (small.length < 5) return null;
  const monthTotal = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const smallTotal = round2(small.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const byCat = new Map();
  small.forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    const e = byCat.get(n) || { count: 0, total: 0 };
    e.count++; e.total = round2(e.total + (Number(r.amount) || 0));
    byCat.set(n, e);
  });
  return {
    threshold: SMALL_TICKET,
    count: small.length, total: smallTotal,
    entryShare: Math.round((small.length / rows.length) * 100),
    valueShare: monthTotal > 0 ? Math.round((smallTotal / monthTotal) * 100) : 0,
    top: [...byCat.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3)
      .map(([name, e]) => ({ name, count: e.count, total: e.total })),
  };
}

// Categories rising every month for several months running. The median check
// on the main list misses these by design: drift that never spikes stays close
// to its own median while quietly doubling over half a year.
const CREEP_MIN_RUN = 3;   // months, including the selected one
export function _reviewCreeping(ym, byYm, groupOf) {
  const grp = groupOf || _spendGroupOf;
  const months = [...byYm.keys()].filter((k) => k <= ym).sort();
  if (months.length < CREEP_MIN_RUN) return [];
  const perMonth = months.map((k) => {
    const m = new Map();
    (byYm.get(k) || []).forEach((r) => {
      const n = r.category || 'Prev Bill Bal / Misc';
      m.set(n, round2((m.get(n) || 0) + (Number(r.amount) || 0)));
    });
    return { ym: k, cats: m };
  });
  const last = perMonth[perMonth.length - 1];
  if (last.ym !== ym) return [];

  const out = [];
  last.cats.forEach((_, name) => {
    // Walk backwards while each month is strictly lower than the one after it.
    // A gap month (category absent) ends the run rather than counting as zero:
    // "absent" usually means not bought, not bought-for-nothing, and treating
    // it as a rise from zero would call every reappearance a trend.
    const run = [];
    for (let i = perMonth.length - 1; i >= 0; i--) {
      const v = perMonth[i].cats.get(name);
      if (v == null) break;
      if (run.length && v >= run[run.length - 1].amount) break;
      run.push({ ym: perMonth[i].ym, amount: v });
    }
    if (run.length < CREEP_MIN_RUN) return;
    const seq = run.slice().reverse();
    const from = seq[0].amount, to = seq[seq.length - 1].amount;
    out.push({
      name, group: grp(name), seq,
      rise: round2(to - from),
      risePct: from > 0 ? Math.round(((to - from) / from) * 100) : null,
      months: seq.length,
      fixed: _reviewIgnores(name),
    });
  });
  return out.sort((a, b) => b.rise - a.rise);
}

// Card vs UPI vs Cash. The card share matters beyond curiosity: it is the part
// that lands on a statement later and feeds the month's reimbursement, so a
// month that felt cheap can still be building a bill.
export function _reviewMethods(ym, byYm, prevYm) {
  const tally = (k) => {
    const m = { UPI: 0, Card: 0, Cash: 0 };
    let total = 0;
    (byYm.get(k) || []).forEach((r) => {
      const a = Number(r.amount) || 0;
      const meth = m[r.method] != null ? r.method : 'UPI';
      m[meth] = round2(m[meth] + a);
      total = round2(total + a);
    });
    return { m, total };
  };
  const cur = tally(ym);
  if (!cur.total) return null;
  const prev = tally(prevYm);
  const share = (v, t) => (t > 0 ? Math.round((v / t) * 100) : 0);
  return {
    rows: ['Card', 'UPI', 'Cash']
      .map((k) => ({ method: k, amount: cur.m[k], share: share(cur.m[k], cur.total) }))
      .filter((r) => r.amount > 0),
    cardAmount: cur.m.Card,
    cardShare: share(cur.m.Card, cur.total),
    // Only comparable when the previous month has something in it.
    prevCardShare: prev.total > 0 ? share(prev.m.Card, prev.total) : null,
  };
}

// ---------- Review (Expense → Review tab) ----------
// Where this month's spending is unusual FOR THIS HOUSEHOLD, and what pulling
// it back to normal would actually recover. Everything below is arithmetic on
// months already loaded — no projection of category spend, no score out of a
// hundred, nothing the user could not check by hand from the Tracker.
//
// A category is judged against its own MEDIAN month, not its mean: with a
// handful of months on record one holiday, one hospital trip or one deposit
// drags a mean far enough to make every other month look thrifty.

// The household kitty for one month: the Yearly plan tab's House Exp, PLUS what someone else
// contributes to the house (if the plan says so), PLUS any emergency draw taken from the
// Emergency Fund that month.
//
// An emergency draw is money that genuinely left the fund and became spendable
// that month, so a month that had one is not overspending its budget — it had
// a bigger budget. Without this, the month an emergency happened would be the
// month the Tracker and Review both shout loudest about, which is both wrong
// and the least useful moment to be shouted at.
//
// Only loanKind 'emergency' counts. A self loan is borrowing for something that
// could have waited, and a gift to family is money out of the household, not
// into its spending — neither should quietly raise the budget.
//
// `loans` is the raw `emergency` store rows of kind 'loan'; passing them in
// keeps this pure and lets each surface load them however it already loads.
export function _emergencyDrawIn(ym, loans) {
  return round2((loans || []).reduce((s, l) => {
    if (l.kind !== 'loan' || l.loanKind !== 'emergency') return s;
    // 'balance' means the draw is left to reconcile against the fund's own
    // balance and must NOT also raise a month's spending budget, or the same
    // money would be counted in both places. Rows written before the choice
    // existed have no field and keep the behaviour they already had.
    if (l.applyTo === 'balance') return s;
    if (String(l.takenDate || '').slice(0, 7) !== ym) return s;
    return s + (Number(l.amount) || 0);
  }, 0));
}

// An emergency draw taken with "Monthly kitty" raises the month it arrived in,
// and its repayment schedule lowers the months it is paid back over. Both are
// derived from the loan record; nothing about the kitty is stored.
//
// The subtraction is only for what is still OUTSTANDING in that month. Once a
// repayment is actually recorded it becomes a Tracker entry under the loan's
// category, and that entry already consumes the month's budget — so leaving
// the earmark in place as well would charge the same rupee twice. Either way a
// month ends up down by its planned amount: as a smaller kitty before the
// repayment, as a logged spend after it.
function _loanPlannedFor(loan, ym) {
  return round2((loan.plan || []).reduce((s, p) => (String(p.ym) === ym ? s + (Number(p.amount) || 0) : s), 0));
}
function _loanRepaidIn(loan, ym) {
  return round2((loan.repayments || []).reduce((s, rp) => (String(rp.date || '').slice(0, 7) === ym ? s + (Number(rp.amount) || 0) : s), 0));
}
// What a month's kitty gives up to loans still being repaid.
export function _repayEarmarkIn(ym, loans) {
  return round2((loans || []).reduce((s, l) => {
    if (l.kind !== 'loan' || l.loanKind !== 'emergency' || l.applyTo === 'balance') return s;
    const outstanding = _loanPlannedFor(l, ym) - _loanRepaidIn(l, ym);
    return s + Math.max(0, outstanding);
  }, 0));
}

// What someone else puts into the household each month, when the Yearly plan says the house is shared.
export function _sharedFor(ym, allocs) {
  const al = (allocs || []).find((x) => Number(x.year) === Number(String(ym).slice(0, 4)));
  return al && al.sharedOn ? round2(Math.max(0, Number(al.sharedAmount) || 0)) : 0;
}
// The household budget before any repayment earmark: the plan, what others share in, and an emergency draw in
// the month it was taken. Used by the All months heatmap, where paid repayments count as spending instead.
export function _kittyNoEarmark(ym, allocs, loans) {
  const al = (allocs || []).find((x) => Number(x.year) === Number(String(ym).slice(0, 4)));
  const share = al ? Number(al.houseExp) || 0 : 0;
  return Math.max(0, round2(share + _sharedFor(ym, allocs) + _emergencyDrawIn(ym, loans)));
}
export function _kittyFor(ym, allocs, loans) {
  const al = (allocs || []).find((x) => Number(x.year) === Number(String(ym).slice(0, 4)));
  const share = al ? Number(al.houseExp) || 0 : 0;
  // Floored at zero: a schedule bigger than the month's own budget would
  // otherwise produce a negative kitty, which reads as a bug rather than as
  // "everything this month is already committed".
  // A planned repayment no longer lowers the month's budget ahead of time: it reduces what is left only once it
  // is recorded as paid (the Tracker entry the loan writes then). _repayEarmarkIn is kept for the "due" badge.
  return _kittyNoEarmark(ym, allocs, loans);
}

// Categories where being "over" isn't a decision anyone can act on this month.
// The Fixed group is contractual; Medicine is not a lifestyle choice, and
// listing it under "spend less" would be both useless and crass.
// Rent and bills are contractual and Medicine is not a lifestyle choice, so
// neither is something "spend less" can address. A personal list has no Fixed
// group, so there only Medicine is held back.
export const _reviewIgnores = (name, groupOf) => (groupOf || _spendGroupOf)(name) === 'Fixed' || name === 'Medicine';

// At least this many earlier months with entries before a category's median is
// worth quoting. Two is the floor at which a median means anything at all;
// below it the tab says so rather than inventing a baseline.
export const REVIEW_MIN_HISTORY = 2;

export const _median = (nums) => {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? round2(a[mid]) : round2((a[mid - 1] + a[mid]) / 2);
};

// ---------- Forecasting the rest of a month ----------
//
// The obvious way to forecast a month is spent / days-so-far * days-in-month.
// It is also wrong in the way that matters most: household spending is not
// spread evenly across a month. Rent, EMIs and bills land in the first week,
// so on the 6th that formula projects a fortune, and by the 25th it quietly
// under-counts everything still to come. Both errors are large AND
// predictable, which is exactly what makes them removable.
//
// So this builds the estimate the other way round. What has already been spent
// is a FACT, not an estimate; only the remainder is estimated, and it is
// estimated from what the days after today's date actually cost in each
// earlier month, compared at the same day of the month. Rent that has already
// gone out on the 5th is therefore not counted again, and rent that has not
// gone out yet is.
//
// The median across those months is the central figure and their spread is the
// range, so one wild month widens the range instead of moving the answer.
export const REVIEW_FORECAST_MIN = 2;   // earlier months needed before forecasting at all
const REVIEW_FORECAST_GOOD = 8;  // % median error at or under which the method is doing well
const REVIEW_FORECAST_FAIR = 18; // ...and under which it is still worth quoting

export const _daysInYm = (k) => new Date(Number(String(k).slice(0, 4)), Number(String(k).slice(5, 7)), 0).getDate();

// One month's spending by day-of-month. Indexed by day, so day 1 is at [1].
function _spendDayTotals(rows, dim) {
  const out = new Array(dim + 2).fill(0);
  (rows || []).forEach((r) => {
    const d = Number(String(r.date || '').slice(8, 10)) || 0;
    if (d >= 1 && d <= dim) out[d] = round2(out[d] + (Number(r.amount) || 0));
  });
  return out;
}

// For each earlier month: what it spent BY `day`, what it spent AFTER `day`,
// and what it came to. A month shorter than `day` has no remainder, which is
// correct rather than a gap - by that day of the month it was already over.
function _monthSplitsAt(yms, byYm, day) {
  return (yms || []).map((k) => {
    const dim = _daysInYm(k);
    const days = _spendDayTotals(byYm.get(k) || [], dim);
    let by = 0, rest = 0, total = 0;
    for (let d = 1; d <= dim; d++) {
      total = round2(total + days[d]);
      if (d <= day) by = round2(by + days[d]);
      else rest = round2(rest + days[d]);
    }
    return { ym: k, by, rest, total };
  }).filter((r) => r.total > 0);
}

// The estimator itself, deliberately factored out so the live forecast and its
// own backtest below run the identical code path. Anything else would make the
// reported accuracy a claim about a different method than the one on screen.
function _forecastFrom(targetYm, priorYms, byYm, day) {
  const dim = _daysInYm(targetYm);
  const cut = Math.min(day, dim);
  const days = _spendDayTotals(byYm.get(targetYm) || [], dim);
  let spent = 0;
  for (let d = 1; d <= cut; d++) spent = round2(spent + days[d]);
  // Already booked for days still to come - rare, but a spend can be entered
  // with a later date, and it must not drop out of the month.
  let loggedAfter = 0;
  for (let d = cut + 1; d <= dim; d++) loggedAfter = round2(loggedAfter + days[d]);
  const splits = _monthSplitsAt(priorYms, byYm, cut);
  if (splits.length < REVIEW_FORECAST_MIN) return null;
  const rests = splits.map((r) => r.rest).sort((x, y) => x - y);
  return {
    dim, day: cut, spent, splits, loggedAfter,
    rest: _median(rests),
    restLo: rests[0], restHi: rests[rests.length - 1],
    // What a usual month had spent by this same day - the honest pacing
    // comparison, and the one figure a naive average gets most wrong.
    usualByNow: _median(splits.map((r) => r.by)),
  };
}

// The live forecast, plus its measured track record.
//
// How well the method actually does is not a matter of opinion: run it against
// each earlier month at the same day of the month, using only the months
// before that one, and compare with what the month really came to. The median
// absolute error rides alongside the forecast, so the figure carries its own
// evidence instead of an assurance.
export function _reviewForecast(ym, byYm, nowDate, dueTotal, kitty) {
  const dim = _daysInYm(ym);
  const day = Math.min(nowDate.getDate(), dim);
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // Priced from what the SAME DAYS cost before, so only months whose days are
  // real can be priced from.
  const hist = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k) && totalOf(k) > 0).sort();
  const f = _forecastFrom(ym, hist, byYm, day);
  if (!f) return null;

  // Recurring items that have NOT landed yet are a floor under the remainder,
  // not an addition to it: the median already contains them for the months
  // they occurred in, so taking the larger of the two avoids counting the same
  // rent twice while still refusing to forecast below a bill known to be due.
  const due = round2(dueTotal || 0);
  const rest = Math.max(f.rest, due, f.loggedAfter);
  const forecast = round2(f.spent + rest);

  const back = [];
  hist.forEach((k, i) => {
    const priors = hist.slice(0, i);
    if (priors.length < REVIEW_FORECAST_MIN) return;
    const g = _forecastFrom(k, priors, byYm, day);
    const actual = totalOf(k);
    if (!g || !(actual > 0)) return;
    const est = round2(g.spent + g.rest);
    back.push({ ym: k, est, actual, errPct: round2((Math.abs(est - actual) / actual) * 100) });
  });
  const errPct = back.length ? _median(back.map((b) => b.errPct)) : null;
  const grade = errPct == null
    ? (hist.length >= 4 ? 'fair' : 'rough')
    : errPct <= REVIEW_FORECAST_GOOD ? 'good' : errPct <= REVIEW_FORECAST_FAIR ? 'fair' : 'rough';

  const daysLeft = dim - day;
  return {
    dim, day, daysLeft, months: hist.length,
    spent: f.spent, rest, due,
    restIsDueFloor: due > f.rest && due >= f.loggedAfter,
    loggedAfter: f.loggedAfter,
    forecast,
    // The range is the observed spread of remainders, never narrower than the
    // central figure it brackets.
    lo: round2(f.spent + Math.min(f.restLo, rest)),
    hi: round2(f.spent + Math.max(f.restHi, rest)),
    usualByNow: f.usualByNow,
    vsUsualByNow: round2(f.spent - f.usualByNow),
    restPerDay: daysLeft > 0 ? round2(rest / daysLeft) : null,
    // What is affordable per day from here to finish inside the kitty. Negative
    // is meaningful and is shown as such: the kitty is already gone.
    // Today included: what is left can still be spent today, unlike `rest`
    // above, which prices only the days after it.
    fitDays: daysLeft + 1,
    fitPerDay: kitty > 0 ? perDayAllowance(kitty - f.spent, daysLeft + 1) : null,
    overKitty: kitty > 0 ? round2(forecast - kitty) : null,
    backtests: back, errPct, grade,
  };
}

// ---------- The shape of a month ----------
//
// A total says how much; this says WHEN, which is the half that changes
// behaviour. Knowing that half of every month is gone by the 9th, or that a
// weekend day costs twice a weekday, is what makes an ordinary Saturday a
// decision rather than a surprise at month end.
//
// Read in thirds rather than per day: a household does not repeat the 14th, it
// repeats "early", "middle" and "late".
const CYCLE_MIN_MONTHS = 3;
const CYCLE_LOOKBACK = 12;
const _DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function _reviewCycle(ym, byYm, nowDate, isCurrent) {
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  // The shape of a month IS the day question, so this is day-floored too - and
  // returns null rather than a shape drawn from dates nobody recorded.
  const hist = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k) && totalOf(k) > 0).sort().slice(-CYCLE_LOOKBACK);
  if (hist.length < CYCLE_MIN_MONTHS) return null;

  const thirds = [[], [], []];
  const halfDays = [], noSpend = [], wkEndPerDay = [], wkDayPerDay = [], wkEndShare = [];
  const dowAmt = new Array(7).fill(0), dowDays = new Array(7).fill(0);
  // Which categories make each third of the month heavy. Kept per month so the
  // figure quoted is a median month, like everything else on this tab, rather
  // than a total divided by however many months happen to be on record.
  const thirdCat = [new Map(), new Map(), new Map()];

  hist.forEach((k) => {
    const dim = _daysInYm(k);
    const y = Number(k.slice(0, 4)), mo = Number(k.slice(5, 7));
    const days = _spendDayTotals(byYm.get(k) || [], dim);
    const total = totalOf(k);
    const t = [0, 0, 0];
    const catPer = [new Map(), new Map(), new Map()];
    (byYm.get(k) || []).forEach((r) => {
      const d = Number(String(r.date || '').slice(8, 10)) || 0;
      if (d < 1 || d > dim) return;
      const i = d <= 10 ? 0 : d <= 20 ? 1 : 2;
      const n = r.category || 'Prev Bill Bal / Misc';
      catPer[i].set(n, round2((catPer[i].get(n) || 0) + (Number(r.amount) || 0)));
    });
    catPer.forEach((m, i) => m.forEach((v, n) => {
      if (!thirdCat[i].has(n)) thirdCat[i].set(n, []);
      thirdCat[i].get(n).push(v);
    }));
    let run = 0, half = null, zero = 0, we = 0, weD = 0, wd = 0, wdD = 0;
    for (let d = 1; d <= dim; d++) {
      const amt = days[d];
      run = round2(run + amt);
      if (half == null && total > 0 && run >= total / 2) half = d;
      if (amt <= 0) zero++;
      const dow = new Date(y, mo - 1, d).getDay();
      dowAmt[dow] = round2(dowAmt[dow] + amt); dowDays[dow]++;
      if (dow === 0 || dow === 6) { we = round2(we + amt); weD++; } else { wd = round2(wd + amt); wdD++; }
      t[d <= 10 ? 0 : d <= 20 ? 1 : 2] += amt;
    }
    if (total > 0) {
      t.forEach((v, i) => thirds[i].push(round2((v / total) * 100)));
      wkEndShare.push(round2((we / total) * 100));
    }
    if (half != null) halfDays.push(half);
    noSpend.push(zero);
    if (weD) wkEndPerDay.push(round2(we / weD));
    if (wdD) wkDayPerDay.push(round2(wd / wdD));
  });

  // This month against that shape. Only for the current month - a finished
  // month has no "so far".
  const dim = _daysInYm(ym);
  const day = isCurrent ? Math.min(nowDate.getDate(), dim) : dim;
  const nowDays = _spendDayTotals(byYm.get(ym) || [], dim);
  let noSpendSoFar = 0;
  for (let d = 1; d <= day; d++) if (nowDays[d] <= 0) noSpendSoFar++;

  const perDow = _DOW.map((name, i) => ({
    name, i, perDay: dowDays[i] ? round2(dowAmt[i] / dowDays[i]) : 0,
  }));
  const busiest = perDow.slice().sort((a, b) => b.perDay - a.perDay)[0];
  const quietest = perDow.slice().filter((r) => r.perDay > 0).sort((a, b) => a.perDay - b.perDay)[0] || null;

  const wePerDay = _median(wkEndPerDay), wdPerDay = _median(wkDayPerDay);
  return {
    months: hist.length,
    // Rounded to whole percent and normalised so the three read as one month
    // rather than summing to 99 or 101 through rounding.
    thirds: (() => {
      const raw = thirds.map((v) => _median(v));
      const sum = raw.reduce((a, b) => a + b, 0) || 1;
      const pct = raw.map((v) => Math.round((v / sum) * 100));
      pct[2] = Math.max(0, 100 - pct[0] - pct[1]);
      return pct;
    })(),
    halfBy: halfDays.length ? Math.round(_median(halfDays)) : null,
    noSpendTypical: Math.round(_median(noSpend)),
    noSpendSoFar, daysSoFar: day, dim,
    weekendPerDay: wePerDay, weekdayPerDay: wdPerDay,
    weekendGap: round2(wePerDay - wdPerDay),
    weekendShare: wkEndShare.length ? Math.round(_median(wkEndShare)) : null,
    busiest, quietest, perDow,
    // Top three categories in each third of a typical month.
    thirdTops: thirdCat.map((m) => [...m.entries()]
      .map(([name, vals]) => ({ name, amount: _median(vals) }))
      .filter((r) => r.amount > 0)
      .sort((x, y) => y.amount - x.amount)
      .slice(0, 3)),
  };
}

// Cumulative spend day by day: this month against a usual one. The chart drawn
// from this is the whole forecast in one picture - where the month has got to,
// where it normally would be by now, and where the two are heading.
//
// A history month shorter than this one simply plateaus at its own last day,
// which is what actually happened rather than a gap in the line.
export function _reviewCurve(ym, byYm, day) {
  const dim = _daysInYm(ym);
  const totalOf = (k) => round2((byYm.get(k) || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  // A usual-month curve is cumulative BY DAY, so day-floored as well.
  const hist = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k) && totalOf(k) > 0).sort();
  if (!hist.length) return null;
  const histCum = hist.map((k) => {
    const hd = _daysInYm(k);
    const days = _spendDayTotals(byYm.get(k) || [], hd);
    const cum = [];
    let run = 0;
    for (let d = 1; d <= dim; d++) { run = round2(run + (d <= hd ? days[d] : 0)); cum[d] = run; }
    return cum;
  });
  const nowDays = _spendDayTotals(byYm.get(ym) || [], dim);
  const out = [];
  let run = 0;
  for (let d = 1; d <= dim; d++) {
    run = round2(run + nowDays[d]);
    out.push({ day: d, now: d <= day ? run : null, usual: _median(histCum.map((c) => c[d])) });
  }
  return out;
}

// One category's last few months, for the mini bars revealed when a row is
// tapped. The evidence behind "usually X a month", in the form where an eye
// can check it.
export function _catMonthHistory(name, ym, byYm, count) {
  const months = [...byYm.keys()].filter((k) => k <= ym).sort().slice(-(count || 6));
  return months.map((k) => ({
    ym: k, current: k === ym,
    amount: round2((byYm.get(k) || [])
      .filter((r) => (r.category || 'Prev Bill Bal / Misc') === name)
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0)),
  }));
}

// A usual month's worth of small change, for comparison against this one.
export function _smallTicketUsual(ym, byYm) {
  // How many separate small payments a month usually holds. A month entered as
  // one lump per category has no small payments in it by construction, so a
  // reconstructed month would drag this figure to nothing.
  const vals = [...byYm.keys()].filter((k) => k < ym && dayDetailOk(k)).sort().slice(-CYCLE_LOOKBACK)
    .map((k) => round2((byYm.get(k) || [])
      .filter((r) => (Number(r.amount) || 0) > 0 && (Number(r.amount) || 0) <= SMALL_TICKET)
      .reduce((s, r) => s + (Number(r.amount) || 0), 0)))
    .filter((v) => v > 0);
  return vals.length >= REVIEW_FORECAST_MIN ? _median(vals) : null;
}

// ---------- "Where money could be kept": cards you can open ----------
//
// One card per place. Collapsed it says it in plain words ("3 more times than usual - 5 this month, usually 2")
// with what could be kept on the right; opened it shows the spends themselves, each with its date and when in
// the month it fell (start / middle / end), so the leak can be found rather than taken on trust.
//
// Which spends? For a place that went wrong by visiting MORE OFTEN, the last few (as many as the extra
// visits): the first usual-many are what a normal month has anyway, so the ones after them are the ones that
// took it over. For dearer-each-time or anything else there is no single culprit, so it lists the month's
// spends in that category, biggest first.
//
// `o.rowsFor(row)` gives that row's month of spends, `o.groupClass(group)` its colour class, `o.dot(row)`
// an optional marker (household / personal on Analysis). Open state is remembered across redraws.
const _keepOpen = new Set();
export const _whenInMonth = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const dim = new Date(+m[1], +m[2], 0).getDate(), d = +m[3];
  return d <= Math.ceil(dim / 3) ? 'Start of month' : d <= Math.ceil(dim * 2 / 3) ? 'Mid-month' : 'End of month';
};
export function rvwKeepList(rows, o) {
  const money = (n) => fmtSheetCur(n);
  return el('div', { class: 'rvw-keep-list' }, rows.map((r) => {
    const isCat = r.kind === 'category';
    const key = (o.scope || '') + '|' + r.name;
    const cat = (n) => n || 'Prev Bill Bal / Misc';
    const mine = isCat ? (o.rowsFor(r) || []).filter((x) => cat(x.category) === r.name && (Number(x.amount) || 0) > 0)
      .slice().sort((a, b2) => String(a.date || '').localeCompare(String(b2.date || '')) || ((a.id || 0) - (b2.id || 0))) : [];
    const moreOften = isCat && r.driver === 'more often' && r.fewer > 0;
    const shown = moreOften ? mine.slice(-r.fewer) : mine.slice().sort((a, b2) => (Number(b2.amount) || 0) - (Number(a.amount) || 0)).slice(0, 8);
    // The plain-words line under the name.
    const line = moreOften
      ? [el('b', { text: r.fewer + (r.fewer === 1 ? ' more time' : ' more times') }), document.createTextNode(' than usual \u00b7 ' + r.count + ' this month, usually ' + r.usualCount)]
      : isCat && r.driver === 'dearer each time'
        ? [el('b', { text: 'Dearer each time' }), document.createTextNode(' \u00b7 ' + money(r.nowAvg) + ' each, usually ' + money(r.usualAvg))]
        : isCat ? [el('b', { text: money(r.save) + ' above usual' }), document.createTextNode(' \u00b7 usually ' + money(r.usual) + ' a month')]
          : [document.createTextNode(r.how)];
    const open = _keepOpen.has(key);
    const body = el('div', { class: 'rvw-keep-body' + (open ? '' : ' hidden') });
    if (isCat && shown.length) {
      body.appendChild(el('div', { class: 'rvw-keep-title', text: moreOften
        ? (shown.length === 1 ? 'The one that took it past usual' : 'The ' + shown.length + ' that took it past usual')
        : 'This month\u2019s spends here, biggest first' }));
      shown.forEach((x) => body.appendChild(el('div', { class: 'rvw-keep-spend' }, [
        el('span', { class: 'rvw-keep-date', text: _spendDayLabel(x.date) }),
        el('span', { class: 'rvw-keep-when', text: _whenInMonth(x.date) }),
        el('b', { class: 'rvw-keep-amt', text: money(Number(x.amount) || 0) }),
      ])));
      const sum = round2(shown.reduce((t, x) => t + (Number(x.amount) || 0), 0));
      // Said plainly: the gap to a usual month is the whole month against its usual, so it only equals these
      // spends when the earlier visits cost about what they usually do.
      const monthTotal = round2(mine.reduce((t, x) => t + (Number(x.amount) || 0), 0));
      body.appendChild(el('div', { class: 'rvw-keep-foot', text: moreOften
        ? (Math.abs(sum - r.save) <= Math.max(1, r.save * 0.05)
          ? 'Together ' + money(sum) + ' \u00b7 without them this would be a usual month.'
          : 'Together ' + money(sum) + ' \u00b7 the full ' + money(r.save) + ' gap to a usual month also includes the other visits costing more than usual.')
        : money(monthTotal) + ' spent here this month, against a usual ' + money(r.usual) + ' \u00b7 ' + money(r.save) + ' above.' }));
    } else if (isCat) {
      body.appendChild(el('div', { class: 'rvw-keep-foot', text: 'No spends to list.' }));
    }
    const head = el('button', { class: 'rvw-keep-head' + (open ? ' is-open' : ''), type: 'button', 'aria-expanded': String(open) }, [
      el('div', { class: 'rvw-keep-main' }, [
        el('div', { class: 'rvw-keep-name' }, [o.dot ? o.dot(r) : null, document.createTextNode(r.name)].filter(Boolean)),
        el('div', { class: 'rvw-keep-line' }, line),
      ]),
      el('div', { class: 'rvw-keep-fig' }, [
        el('div', { class: 'rvw-keep-val', text: r.kind === 'weekend' ? fmtIntCur(r.save) : money(r.save) }),
        el('div', { class: 'rvw-keep-unit', text: r.kind === 'weekend' ? 'a day' : 'could keep' }),
      ]),
      isCat ? el('span', { class: 'rvw-sec-chev rvw-keep-chev' }) : null,
    ].filter(Boolean));
    if (isCat) {
      head.addEventListener('click', () => {
        const now = body.classList.toggle('hidden') === false;
        if (now) _keepOpen.add(key); else _keepOpen.delete(key);
        head.classList.toggle('is-open', now); head.setAttribute('aria-expanded', String(now));
      });
    } else head.disabled = true;
    return el('div', { class: 'rvw-keep ' + o.groupClass(r.group) + (isCat ? '' : ' is-static') }, [head, body]);
  }));
}

// ---------- Where the money could actually stay ----------
//
// Every line here is measured against something this household has ALREADY
// done in some earlier month, which is what separates a saving from a wish.
// Nothing is invented: a category's own median month, its own usual number of
// visits, its own weekday spending.
//
// These overlap on purpose and are NOT summed. The same 180 rupees can be a
// small spend, a Saturday and an over-median Snacks entry all at once; three
// ways of seeing one leak is useful, adding them up three times is not. The
// only figure quoted as a total is the category one, which cannot overlap
// itself.
export function _reviewSavings(a, cycle, small, smallUsual) {
  const out = [];
  a.actionable.forEach((r) => {
    const fewer = r.usualCount && r.count > r.usualCount ? r.count - r.usualCount : 0;
    out.push({
      name: r.name, group: r.group, save: r.over, kind: 'category',
      // What the "keep" card shows and expands: visits now and usually, what each cost, and the usual month.
      count: r.count, usualCount: r.usualCount, fewer, driver: r.driver, nowAvg: r.nowAvg, usualAvg: r.usualAvg, usual: r.usual,
      how: (r.driver === 'more often' && fewer)
        ? fewer + (fewer === 1 ? ' fewer time' : ' fewer times') + ' this month would do it'
        : 'back to its usual ' + fmtSheetCur(r.usual) + ' a month',
    });
  });
  if (small && smallUsual != null) {
    const excess = round2(small.total - smallUsual);
    if (excess > 0) out.push({
      name: 'Small spends under ' + fmtSheetCur(small.threshold), group: 'Other',
      save: excess, kind: 'small',
      how: small.count + ' of them so far, ' + fmtSheetCur(small.total) + ' in all \u00b7 a usual month runs ' + fmtSheetCur(smallUsual),
    });
  }
  if (cycle && cycle.weekendGap > 0 && cycle.weekendPerDay > 0) {
    out.push({
      name: 'Weekend days', group: 'Lifestyle', save: cycle.weekendGap, kind: 'weekend',
      how: 'weekends run ' + fmtIntCur(cycle.weekendPerDay) + ' a day against '
        + fmtIntCur(cycle.weekdayPerDay) + ' on weekdays \u2014 that is the gap for each one you keep quiet',
    });
  }
  out.sort((x, y) => y.save - x.save);
  return { rows: out.slice(0, 6) };
}

// Pure: (selected month, all months by ym, this month, kitty, clock) → findings.
export function _reviewAnalysis(ym, byYm, thisYm, kitty, nowDate, groupOf) {
  // Defaults to the household category list. Personal Finance passes its own,
  // which is the only part of this that differs between the two.
  const gOf = groupOf || _spendGroupOf;
  const year = Number(ym.slice(0, 4)), mon = Number(ym.slice(5, 7));
  const daysInMonth = new Date(year, mon, 0).getDate();
  const isCurrent = ym === thisYm;
  const daysElapsed = isCurrent ? Math.min(nowDate.getDate(), daysInMonth) : daysInMonth;
  const daysLeft = isCurrent ? daysInMonth - daysElapsed : 0;

  const rowsOf = (k) => byYm.get(k) || [];
  const totalOf = (k) => round2(rowsOf(k).reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const spent = totalOf(ym);

  // Earlier months that actually have entries. Only these form a baseline —
  // a month with nothing logged is missing data, not a frugal month, and
  // averaging zeros in would understate every category's normal.
  const historyYms = [...byYm.keys()].filter((k) => k < ym && totalOf(k) > 0).sort();

  // This month, per category.
  const nowCat = new Map();
  rowsOf(ym).forEach((r) => {
    const n = r.category || 'Prev Bill Bal / Misc';
    const e = nowCat.get(n) || { total: 0, count: 0 };
    e.total = round2(e.total + (Number(r.amount) || 0));
    e.count++;
    nowCat.set(n, e);
  });

  // Every earlier month, per category, kept per-month so a median can be taken
  // across months rather than across individual entries.
  const histCat = new Map(); // name -> { totals: [], counts: [] }
  historyYms.forEach((k) => {
    const perCat = new Map();
    rowsOf(k).forEach((r) => {
      const n = r.category || 'Prev Bill Bal / Misc';
      const e = perCat.get(n) || { total: 0, count: 0 };
      e.total = round2(e.total + (Number(r.amount) || 0));
      e.count++;
      perCat.set(n, e);
    });
    perCat.forEach((v, n) => {
      if (!histCat.has(n)) histCat.set(n, { totals: [], counts: [] });
      histCat.get(n).totals.push(v.total);
      histCat.get(n).counts.push(v.count);
    });
  });

  const actionable = [], fixedRows = [], unjudged = [];
  nowCat.forEach((cur, name) => {
    if (_reviewIgnores(name, gOf)) { fixedRows.push({ name, now: cur.total }); return; }
    const h = histCat.get(name);
    if (!h || h.totals.length < REVIEW_MIN_HISTORY) {
      unjudged.push({ name, now: cur.total, months: h ? h.totals.length : 0 });
      return;
    }
    const usual = _median(h.totals);
    const over = round2(cur.total - usual);
    if (over <= 0) return; // at or under its own normal — nothing to say

    // More often, or dearer each time? The remedy differs, so it's only stated
    // when one clearly dominates; when the two move together it is left out
    // rather than picking a side on a rounding difference.
    const usualCount = Math.round(_median(h.counts)) || 0;
    const usualAvg = usualCount > 0 ? round2(usual / usualCount) : 0;
    const nowAvg = cur.count > 0 ? round2(cur.total / cur.count) : 0;
    const cRatio = usualCount > 0 ? cur.count / usualCount : 0;
    const aRatio = usualAvg > 0 ? nowAvg / usualAvg : 0;
    let driver = null;
    if (cRatio && aRatio && Math.abs(cRatio - aRatio) >= 0.15) {
      driver = cRatio > aRatio ? 'more often' : 'dearer each time';
    }
    actionable.push({
      name, group: gOf(name), now: cur.total, usual, over,
      count: cur.count, usualCount, nowAvg, usualAvg, driver,
      months: h.totals.length,
    });
  });

  actionable.sort((a, b) => b.over - a.over);
  fixedRows.sort((a, b) => b.now - a.now);
  unjudged.sort((a, b) => b.now - a.now);

  return {
    ym, isCurrent, daysInMonth, daysElapsed, daysLeft,
    spent, kitty, overKitty: round2(spent - kitty),
    historyMonths: historyYms.length,
    // Quoted only once there is enough of the month behind it to mean
    // something. On the 2nd, scaling two days up to thirty says nothing.
    pace: isCurrent && daysElapsed >= 10 ? round2((spent / daysElapsed) * daysInMonth) : null,
    actionable, fixedRows, unjudged,
    recoverable: round2(actionable.reduce((s, r) => s + r.over, 0)),
  };
}
