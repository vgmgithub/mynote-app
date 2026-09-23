// cron.js — the nightly news sweep, as logic with no database and no network of its own.
//
// Two runs a day, one per market: India before the NSE pre-open, the US ahead of its own session.
// Each run asks the provider once per company that somebody follows, writes the day into the archive,
// and stops when the budget for the run is gone.
//
// WHY A BUDGET AT ALL.
//
// Every company costs one upstream request, and the number of companies grows with the user base while
// the plan's daily allowance does not. Without a ceiling the first run of the month would quietly eat
// the whole month. NEWS_DAILY_BUDGET is that ceiling, read from the environment so the plan can change
// without a deploy, and it is split between the two runs rather than raced for.
//
// Companies are swept most-followed first, so if the budget does run out it runs out on the long tail
// that one person watches rather than on the names everybody holds.

export const MARKETS = ['in', 'us'];

// Deliberately low. A wrong env value should under-fetch, never overspend: somebody who forgets to set
// this gets a small sweep and a working app, not a bill.
export const DEFAULT_DAILY_BUDGET = 90;

// The two runs do not get half each. India is swept first in the day and the US run would otherwise
// inherit whatever India left, making the US feed hostage to India's company count.
export const MARKET_SHARE = { in: 0.6, us: 0.4 };

export function parseBudget(raw, fallback = DEFAULT_DAILY_BUDGET) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), 100000);
}

// What one run may spend. Floors rather than rounds, so the two runs together can never exceed the day.
export function budgetForMarket(market, total) {
  const share = MARKET_SHARE[market];
  if (!share) return 0;
  return Math.max(1, Math.floor(total * share));
}

export function isMarket(m) {
  return MARKETS.indexOf(m) >= 0;
}

// Vercel sends the cron secret as a bearer token. Anything else is refused, because this endpoint
// spends money every time it runs.
export function cronAuthorized(headerValue, secret) {
  if (!secret) return false;
  const expected = 'Bearer ' + secret;
  const got = String(headerValue || '');
  if (got.length !== expected.length) return false;
  // Constant time over equal-length strings: a timing oracle on a secret that authorises spending is
  // worth closing even though the window is small.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// Companies already carrying today's news are skipped rather than re-fetched: a re-run of the cron, a
// manual trigger, or a user who happened to pull one on demand should all cost nothing extra.
export function planSweep(companies, alreadyFresh, budget) {
  const done = new Set(alreadyFresh);
  const todo = [];
  for (const c of companies) {
    if (todo.length >= budget) break;
    if (done.has(c.nameKey)) continue;
    todo.push(c);
  }
  return { todo, skipped: companies.length - todo.length, budget };
}

// One company at a time, because the provider's search takes one name. `fetchOne` is injected so this
// stays testable and so a failure is counted rather than thrown: a single dead company must not end a
// sweep that still has ninety to do.
// Returned by fetchOne for a company somebody else is fetching at this moment (lib/newsstore.js
// claimFetch), or finished meanwhile. Not a failure: it must never count toward stopping the sweep.
export const SWEEP_SKIP = Object.freeze({ skip: true });

export async function runSweep({ todo, fetchOne, onWrite, stopAfterFailures = 5 }) {
  const result = { fetched: 0, empty: 0, failed: 0, busy: 0, stopped: false };
  let consecutive = 0;
  for (const c of todo) {
    let articles = null;
    try { articles = await fetchOne(c); } catch (_) { articles = null; }
    if (articles === SWEEP_SKIP) { result.busy++; continue; }
    if (articles == null) {
      result.failed++;
      // The provider is refusing, not this one company. Carrying on would burn the rest of the budget
      // on calls that are all going to fail the same way.
      if (++consecutive >= stopAfterFailures) { result.stopped = true; break; }
      continue;
    }
    consecutive = 0;
    if (!articles.length) result.empty++;
    else result.fetched++;
    if (onWrite) await onWrite(c, articles);
  }
  return result;
}
