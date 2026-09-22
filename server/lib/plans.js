// plans.js — what a plan costs, what it entitles you to, and when that runs out.
//
// No database and no network: every function here takes rows and returns an answer, so the rules can
// be read and tested without standing a server up.
//
// THE RULES THAT MATTER LATER.
//
//   A price change never touches anybody already paying. The live price comes from plan_prices; what
//   a subscriber owes comes from their own subscription row, frozen at signup. Grandfathering is
//   therefore the default, not something a future migration has to remember to do.
//
//   Entitlement is a ladder. plans.rank is what a feature compares against, so adding 'pro_plus' at
//   rank 20 gives it everything 'pro' has without restating a single feature.
//
//   Lifetime is the same shape as any other period, with no end date. It is priced and stored today
//   and only hidden in the app, so opening it is a row edit rather than a code change.

export const PERIODS = ['monthly', 'annual', 'lifetime'];
// What the app is allowed to sell right now. Lifetime is deliberately absent: it exists everywhere
// else, so this list is the single place that decides whether it is on sale.
export const SELLABLE_PERIODS = ['monthly', 'annual'];

export const isPeriod = (p) => PERIODS.indexOf(p) >= 0;
export const isSellable = (p) => SELLABLE_PERIODS.indexOf(p) >= 0;

// Rank 0 is the free plan: it is not a row, because nobody subscribes to it.
export const FREE_RANK = 0;

export function parseBuy(body) {
  const b = body || {};
  const installId = typeof b.installId === 'string' ? b.installId : '';
  if (!/^[0-9a-f-]{32,36}$/.test(installId)) return { ok: false, status: 400, error: 'bad installId' };
  const plan = typeof b.plan === 'string' && b.plan ? b.plan : 'pro';
  if (!/^[a-z_]{2,32}$/.test(plan)) return { ok: false, status: 400, error: 'bad plan' };
  // An app that predates periods asked for the only thing there was, which was the annual amount.
  const period = typeof b.period === 'string' && b.period ? b.period : 'annual';
  if (!isSellable(period)) return { ok: false, status: 400, error: 'that plan is not on sale' };
  return { ok: true, installId, plan, period };
}

// The live price for a plan and period, or null. Only `active` rows are sellable, which is what keeps
// a retired price readable by old receipts while being unbuyable.
export function livePrice(prices, planCode, period) {
  const rows = (prices || []).filter((p) => p.plan_code === planCode && p.period === period && Number(p.active) === 1);
  if (!rows.length) return null;
  // Newest wins, so inserting a new price retires the old one even if somebody forgets to clear the flag.
  rows.sort((a, b) => new Date(b.from_at) - new Date(a.from_at));
  const r = rows[0];
  return { planCode, period, amount: Number(r.amount), currency: r.currency || 'INR', label: r.label };
}

// What the app shows on its plan screen: everything on sale, cheapest period first. A period with no
// active price simply is not offered, which is how lifetime stays invisible without a special case.
export function sellableOffers(plans, prices) {
  const out = [];
  for (const plan of (plans || []).filter((p) => Number(p.active) === 1)) {
    for (const period of SELLABLE_PERIODS) {
      const price = livePrice(prices, plan.code, period);
      if (price) out.push({ ...price, planName: plan.name, rank: Number(plan.rank) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.amount - b.amount);
}

// When a period bought now runs out. Lifetime has no end, which the caller stores as NULL.
//
// Month arithmetic is done by asking for the same date next month and accepting what the calendar
// says: adding 30 days would drift a subscription backwards through the year, and a 31 January
// subscription has to land on 28 February rather than 3 March.
// ---------- the billing test clock ----------
//
// Nobody tests a renewal by waiting a month. `clock` lets an environment redefine what a period is
// worth in minutes, so staging can run a whole subscription life - buy, warn, expire, renew - inside
// an hour. It is settings data, editable from the admin page, because a value that needs a redeploy
// cannot be changed while somebody is halfway through a test.
//
// Durations are written the way somebody setting up a test would say them: "30m", "2h", "7d". A bare
// number is read as minutes, so a field typed in a hurry still means something sensible.
//
// Shape: { enabled, monthly, annual, remindBefore }. With `enabled` false, or no row at all, every
// function below falls back to real calendar time - which is what production runs on, and what a
// forgotten or malformed setting must therefore also produce.
export const DEFAULT_CLOCK = { enabled: false, monthly: '1h', annual: '2h', remindBefore: '15m' };

// Real time, and the only place these numbers live.
export const REAL_REMIND_DAYS = { monthly: 3, annual: 14 };

const UNIT_MS = { m: 60000, h: 3600000, d: 86400000 };
const MAX_MS = 400 * UNIT_MS.d;          // a year and a bit: past this, somebody has fat-fingered it

// "90m" | "2h" | "7d" | 45 -> milliseconds, or null when it cannot be read. Never throws: this value
// comes from a text field on a web page, so every wrong thing anybody can type has to land somewhere.
export function parseDuration(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? Math.min(raw * UNIT_MS.m, MAX_MS) : null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([mhd])?\s*$/i.exec(String(raw == null ? '' : raw));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n * UNIT_MS[(m[2] || 'm').toLowerCase()], MAX_MS);
}

// Back to the shortest text that means the same thing, so the admin field reads back as it was typed.
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  for (const u of ['d', 'h', 'm']) {
    if (ms % UNIT_MS[u] === 0) return (ms / UNIT_MS[u]) + u;
  }
  return Math.round(ms / UNIT_MS.m) + 'm';
}

export function parseClock(raw) {
  let o = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (_) { o = null; } }
  if (!o || typeof o !== 'object') return { ...DEFAULT_CLOCK };
  const pick = (v, fallback) => (parseDuration(v) == null ? fallback : String(v).trim());
  return {
    enabled: o.enabled === true || o.enabled === 1 || o.enabled === '1',
    monthly: pick(o.monthly, DEFAULT_CLOCK.monthly),
    annual: pick(o.annual, DEFAULT_CLOCK.annual),
    remindBefore: pick(o.remindBefore, DEFAULT_CLOCK.remindBefore),
  };
}

// How long a period lasts under a test clock, in ms, or null when real time applies.
export function testSpanMs(period, clock) {
  const c = parseClock(clock);
  if (!c.enabled || period === 'lifetime') return null;
  return parseDuration(period === 'monthly' ? c.monthly : c.annual);
}

export function periodEnd(period, from = new Date(), clock = null) {
  if (period === 'lifetime') return null;
  const span = testSpanMs(period, clock);
  // A test period is a flat span: the calendar rules below are exactly what is being stepped over,
  // and 31 January has no meaning when a month is an hour long.
  if (span != null) return new Date(from.getTime() + span);
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  if (period === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  // Rolled past the end of a shorter month, so step back onto its last day.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
}

// A renewal runs from where the last one ended, not from today - otherwise paying early shortens what
// you paid for. An expired subscription restarts from now, because the gap is not owed.
export function renewalEnd(period, currentEnd, now = new Date(), clock = null) {
  const base = currentEnd && new Date(currentEnd) > now ? new Date(currentEnd) : now;
  return periodEnd(period, base, clock);
}

// ---------- ending soon ----------
//
// How long before the end the warning goes up. Under a test clock that is whatever was set, so a
// one-hour subscription can warn at fifteen minutes; on real time it is days, because a notice three
// days before a monthly renewal is useful and one fifteen minutes before is not.
export function remindLeadMs(period, clock = null) {
  const c = parseClock(clock);
  if (c.enabled) return parseDuration(c.remindBefore) || 0;
  return (REAL_REMIND_DAYS[period] || 3) * UNIT_MS.d;
}

// Is this subscription inside its warning window, and has that warning not already been given for
// THIS term? `reminded_for` holds the end date it was raised for, so a renewal re-arms the notice by
// itself - the stored date stops matching current_end and the next term gets its own.
//
// Lifetime never ends, so it is never reminded. Nor is anything already expired: that is a different
// message, and a "your plan is ending" notice after it has ended reads as a bug.
export function needsReminder(sub, now = new Date(), clock = null) {
  if (!isLive(sub, now) || !sub.current_end) return false;
  const end = new Date(sub.current_end);
  if (now.getTime() < end.getTime() - remindLeadMs(sub.period, clock)) return false;
  return !(sub.reminded_for && new Date(sub.reminded_for).getTime() === end.getTime());
}

// What the app shows about the end of a term. Returned by /api/plan so a device that only ever polls
// still learns it - there is no account here, so there is no inbox to send to.
export function renewalNotice(sub, now = new Date(), clock = null) {
  if (!sub || !sub.current_end || sub.period === 'lifetime') return null;
  const end = new Date(sub.current_end);
  const msLeft = end.getTime() - now.getTime();
  if (msLeft <= 0) return { state: 'ended', endsAt: end.toISOString(), msLeft: 0, period: sub.period };
  if (msLeft > remindLeadMs(sub.period, clock)) return null;
  return {
    state: sub.status === 'cancelled' ? 'ending' : 'renewing',
    endsAt: end.toISOString(),
    msLeft,
    period: sub.period,
  };
}

export const isLive = (sub, now = new Date()) => !!sub && sub.status === 'active'
  && (sub.current_end == null || new Date(sub.current_end) > now);

// The plan an install is actually on. The highest-ranked live subscription wins, so somebody who
// upgrades mid-term is never dropped to the lower tier by a row that has not expired yet.
export function entitlement(subs, plans, now = new Date()) {
  const rank = new Map((plans || []).map((p) => [p.code, Number(p.rank) || 0]));
  let best = null;
  for (const s of subs || []) {
    if (!isLive(s, now)) continue;
    if (!best || (rank.get(s.plan_code) || 0) > (rank.get(best.plan_code) || 0)) best = s;
  }
  if (!best) return { plan: 'free', code: null, rank: FREE_RANK, until: null, period: null };
  return {
    // Old apps understand 'free' and 'paid' and nothing else. They keep getting exactly that, while
    // `code` and `rank` carry the detail a newer one can read.
    plan: 'paid',
    code: best.plan_code,
    rank: rank.get(best.plan_code) || 0,
    until: best.current_end ? new Date(best.current_end).toISOString() : null,
    period: best.period,
  };
}

// Does this install have at least the tier a feature needs? The one call a feature gate should make.
export const meetsRank = (ent, needed) => (ent ? ent.rank : FREE_RANK) >= needed;
