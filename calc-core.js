// Financial Calculators: the arithmetic, with no DOM and no storage, so every number is tested on its own.
// The screen is calc-ui.js. Nothing here reads or writes the user's records: these are what-ifs on figures typed in.
import { computeFd, addMonths } from './fd.js';

// The inflation rate a new user starts from (Inflation tab). Their own figure, once saved in meta.inflationRatePct,
// always wins - the same default the old standalone Inflation Calculator used, so nobody's saved rate changes.
export const DEFAULT_INFLATION_PCT = 4.82;

const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// ---------- FD ----------
// The FD tab asks the same maths the Fixed Deposits screen uses for a real deposit (fd.js computeFd), on a deposit
// made up from what was typed, so the two can never disagree. `months` is the tenure; `payout` true means interest
// is paid out (monthly) instead of reinvested.
export function fdCalc({ principal, ratePct, months, compounding = 'quarterly', payout = false, today }) {
  const P = pos(principal), r = pos(ratePct), m = Math.round(pos(months));
  if (!P || !r || !m) return null;
  const start = today || new Date().toISOString().slice(0, 10);
  const maturityDate = addMonths(start, m);
  const c = computeFd({ principal: P, rate: r, startDate: start, maturityDate, compounding, payout: payout ? 'payout' : 'cumulative' },
    Date.parse(start + 'T00:00:00Z'));
  return {
    principal: P, ratePct: r, months: m, maturityDate,
    maturityValue: c.maturityValue, interest: c.totalInterest,
    monthlyIncome: payout ? c.monthlyIncome : 0,
    // What the deposit earns per year once compounding is counted: the figure banks quote as the "annualised yield".
    effectivePct: c.tenureYears > 0 && !payout ? (Math.pow(c.maturityValue / P, 1 / c.tenureYears) - 1) * 100 : r,
  };
}

// ---------- Compound interest ----------
// A lump sum now plus an optional amount added at the end of every month, growing at `ratePct` a year compounded
// `perYear` times a year. A monthly addition with quarterly (say) compounding grows at the equivalent monthly rate,
// so the lump sum on its own gives exactly P(1 + r/n)^(nt).
export const PER_YEAR = { yearly: 1, 'half-yearly': 2, quarterly: 4, monthly: 12 };
export function compoundGrowth({ principal, monthly, ratePct, years, perYear = 12 }) {
  const P = pos(principal), add = pos(monthly), r = pos(ratePct) / 100;
  const y = Math.min(60, Math.round(pos(years)));
  const n = [1, 2, 4, 12].includes(Number(perYear)) ? Number(perYear) : 12;
  if (!y || (!P && !add)) return null;
  const mRate = Math.pow(1 + r / n, n / 12) - 1;
  let value = P, invested = P;
  const byYear = [];
  for (let month = 1; month <= y * 12; month++) {
    value = value * (1 + mRate) + add;
    invested += add;
    if (month % 12 === 0) byYear.push({ year: month / 12, value, invested });
  }
  return { futureValue: value, invested, interest: value - invested, years: y, byYear };
}

// ---------- Inflation ----------
// What a rupee amount at some future date is worth in today's money, and what today's cost will be then.
export function presentValue(amount, ratePct, years) {
  const a = pos(amount), y = Number(years);
  if (!a || !(y > 0) || !Number.isFinite(Number(ratePct))) return null;
  return a / Math.pow(1 + Number(ratePct) / 100, y);
}
export function futureCost(amount, ratePct, years) {
  const a = pos(amount), y = Number(years);
  if (!a || !(y > 0) || !Number.isFinite(Number(ratePct))) return null;
  return a * Math.pow(1 + Number(ratePct) / 100, y);
}

// ---------- Where could this money go? ----------
// Decision SUPPORT, not advice. It never names a product, never promises a return, and never says "invest in": it
// lays the broad kinds of place MyNotes already tracks side by side against the three things that matter most for
// a given sum - when it is needed, how much a fall would hurt, and whether it must stay reachable - and says which
// ones are usually considered a closer or looser fit for that situation, and why. The owner of the decision is the
// person reading it.
//
//   minMonths  how long money usually needs to stay put for the category's swings to even out
//   risk       1 low, 2 medium, 3 high: how far the value can fall in the meantime
//   reach      how quickly it can be turned back into cash
export const MONEY_OPTIONS = [
  { id: 'banksav', label: 'Savings account', minMonths: 0, risk: 1, reach: 'high',
    liquidity: 'Instant', preservation: 'High', growth: 'Low', volatility: 'Very low',
    note: 'Deposits are insured up to ₹5 lakh per bank (DICGC). Interest usually trails inflation.' },
  { id: 'fd', label: 'Fixed deposit', minMonths: 3, risk: 1, reach: 'medium',
    liquidity: 'Breakable, often with a penalty', preservation: 'High', growth: 'Low to moderate', volatility: 'None (fixed rate)',
    note: 'Rate is locked for the tenure. Insured up to ₹5 lakh per bank (DICGC). Interest is taxed at your slab.' },
  { id: 'mfdebt', label: 'Mutual funds: debt / liquid', minMonths: 6, risk: 1.5, reach: 'high',
    liquidity: 'Usually 1–3 working days', preservation: 'Moderate to high', growth: 'Low to moderate', volatility: 'Low',
    note: 'Not insured. Value moves with interest rates and the credit quality of what the fund holds.' },
  { id: 'bond', label: 'Bonds', minMonths: 12, risk: 2, reach: 'low',
    liquidity: 'Can be hard to sell before maturity', preservation: 'Depends on the issuer', growth: 'Low to moderate', volatility: 'Low to medium',
    note: 'The issuer’s credit rating matters: a higher coupon usually means more risk of not being paid.' },
  { id: 'metal', label: 'Gold & silver', minMonths: 36, risk: 2.5, reach: 'medium',
    liquidity: 'Usually quick to sell', preservation: 'Moderate', growth: 'Moderate over long periods', volatility: 'Medium to high',
    note: 'Often held to diversify rather than to grow. Prices can fall for years at a stretch.' },
  { id: 'mfequity', label: 'Mutual funds: equity', minMonths: 60, risk: 3, reach: 'high',
    liquidity: 'Usually 2–3 working days', preservation: 'Low in the short term', growth: 'High over long periods', volatility: 'High',
    note: 'Not insured. Falls of 20–40% have happened and taken years to recover.' },
  { id: 'stocks', label: 'Stocks', minMonths: 60, risk: 3, reach: 'high',
    liquidity: 'Quick to sell on market days', preservation: 'Low', growth: 'High over long periods', volatility: 'High',
    note: 'Single companies can fall far further than the market as a whole.' },
];
export const RISK_LEVEL = { low: 1, medium: 2, high: 3 };
export const GOALS = [['', 'No particular goal'], ['emergency', 'Emergency reserve'], ['purchase', 'A planned purchase'], ['growth', 'Long-term growth']];

// Said wherever this page is shown. Kept here so the screen and its tests share one wording.
export const DECISION_DISCLAIMER = 'This is general information to help you think it through, not financial advice. '
  + 'MyNotes is not a registered investment adviser. Past returns do not predict future ones, and every option here can '
  + 'have costs, taxes and risks not shown. For a decision that matters, talk to a SEBI-registered adviser.';

const monthsText = (m) => (m < 12 ? m + ' month' + (m === 1 ? '' : 's') : (m % 12 === 0 ? m / 12 + ' year' + (m === 12 ? '' : 's') : (m / 12).toFixed(1) + ' years'));

// `months` = when the money is needed; `risk` = 'low'|'medium'|'high'; `goal` optional (GOALS). Returns every option
// with a fit ('closer', 'partly', 'looser') and the reasons, closer fits first; plus a one-line framing of the
// situation. Pure: the same inputs always give the same answer.
export function moneyOptions({ amount, months, risk = 'low', goal = '' }) {
  const m = Math.round(pos(months));
  const tol = RISK_LEVEL[risk] || 1;
  if (!m) return null;
  const rows = MONEY_OPTIONS.map((o) => {
    const reasons = [];
    let score = 0;                                   // 0 closer, 1 partly, 2 looser
    if (m < o.minMonths) {
      const short = m < o.minMonths / 2;
      score = Math.max(score, short ? 2 : 1);
      reasons.push('Its value can be down when the money is needed: it usually needs ' + monthsText(o.minMonths) + ' or more, and this is ' + monthsText(m) + '.');
    } else if (o.minMonths > 0) reasons.push('The time frame (' + monthsText(m) + ') is long enough for its usual ups and downs.');
    if (o.risk > tol) {
      score = Math.max(score, o.risk - tol >= 1 ? 2 : 1);
      reasons.push('It can swing more than a ' + risk + ' risk tolerance usually allows.');
    } else if (o.risk <= 1) reasons.push('It is designed to keep the amount you put in.');
    if (goal === 'emergency' && o.reach !== 'high') {
      score = Math.max(score, o.reach === 'low' ? 2 : 1);
      reasons.push('An emergency reserve usually needs to be reachable within a day or two.');
    }
    if (goal === 'growth' && o.risk <= 1 && m >= 60) {
      score = Math.max(score, 1);
      reasons.push('Over this long, options built to preserve money may not keep up with inflation.');
    }
    return { ...o, fit: ['closer', 'partly', 'looser'][score], score, reasons };
  }).sort((a, b) => a.score - b.score);
  const horizon = m < 12 ? 'short-term' : m <= 36 ? 'medium-term' : 'long-term';
  const framing = horizon === 'short-term' || tol === 1
    ? 'For a ' + horizon + ' need with a ' + risk + ' risk tolerance, options designed for capital preservation and easy access may be more suitable.'
    : horizon === 'long-term' && tol === 3
      ? 'With a long time frame and a high risk tolerance, growth-oriented options come into consideration, alongside how much of a fall you could live through.'
      : 'For a ' + horizon + ' need with a ' + risk + ' risk tolerance, a mix of steadier and growth-oriented options is often considered.';
  return { amount: pos(amount), months: m, risk, goal, framing, rows };
}
