// Aggregate statistics for the /admin dashboard.
//
// Privacy by design: every query below returns COUNTS ONLY. No install id, no row-level data, and no
// cross-tabulation (age is never combined with gender or region), so a single person cannot be picked
// out of the results even though the page is public.
import { FEATURES, AGE_BANDS, GENDERS, PLATFORMS } from './validate.js';
import { PROVIDER_BACKOFF_MS } from './news.js';
import { insights, WEEKDAYS } from './insights.js';

export const STAT_QUERIES = {
  headline: `SELECT
      COUNT(*) AS total,
      SUM(plan = 'paid') AS paid,
      SUM(last_seen >= NOW() - INTERVAL 1 DAY) AS active1,
      SUM(last_seen >= NOW() - INTERVAL 7 DAY) AS active7,
      SUM(last_seen >= NOW() - INTERVAL 30 DAY) AS active30,
      SUM(first_seen >= NOW() - INTERVAL 7 DAY) AS new7,
      SUM(first_seen >= NOW() - INTERVAL 30 DAY) AS new30,
      SUM(last_seen < NOW() - INTERVAL 30 DAY) AS lapsed,
      SUM(last_seen BETWEEN NOW() - INTERVAL 60 DAY AND NOW() - INTERVAL 30 DAY) AS justLapsed,
      SUM(age_band IS NOT NULL OR gender IS NOT NULL) AS shared
    FROM installs`,
  // How healthy the news side is. All three read tables that only exist once the Feed has been used, so
  // api/stats.js lets each fail quietly. Counts and dates only: no company is tied to any install here.
  newsArchive: `SELECT COUNT(*) AS n, COUNT(DISTINCT name_key) AS companies, COUNT(DISTINCT day) AS days,
      MIN(day) AS firstDay, MAX(fetched_at) AS lastAt FROM news_archive`,
  newsToday: 'SELECT COALESCE(SUM(n), 0) AS calls, COUNT(*) AS callers FROM news_quota WHERE day = CURRENT_DATE',
  newsProvider: "SELECT COUNT(*) AS n, MAX(at) AS at FROM news_state WHERE k = 'provider_fail'",
  // One point per day for the last 30: the only figure on the page that shows a direction rather than a
  // snapshot. COUNT(DISTINCT install_id) is a count, not an identifier - no id leaves the query.
  daily: `SELECT day AS k, COUNT(DISTINCT install_id) AS n FROM install_days
    WHERE day >= CURRENT_DATE - INTERVAL 29 DAY GROUP BY day ORDER BY day`,
  // Days each install checked in during the last 30 (counts only; no ids leave the query).
  days: `SELECT COUNT(*) AS tracked, SUM(d >= 8) AS regular, SUM(d BETWEEN 3 AND 7) AS casual, SUM(d <= 2) AS light, AVG(d) AS avgDays
    FROM (SELECT COUNT(*) AS d FROM install_days WHERE day >= CURRENT_DATE - INTERVAL 29 DAY GROUP BY install_id) t`,
  // New installs per day, the last 30: growth as a line. Counts only.
  newDaily: `SELECT DATE(first_seen) AS k, COUNT(*) AS n FROM installs
    WHERE first_seen >= CURRENT_DATE - INTERVAL 29 DAY GROUP BY k ORDER BY k`,
  // Check-ins by day of the week over 90 days (1 = Sunday): when people actually open the app.
  weekday: `SELECT DAYOFWEEK(day) AS k, COUNT(*) AS n FROM install_days
    WHERE day >= CURRENT_DATE - INTERVAL 89 DAY GROUP BY k`,
  // Pro rate by device. Platform is a device, not a demographic, so this is not the age/gender/region cross-tab the
  // privacy guard forbids.
  planPlatform: "SELECT platform AS k, COUNT(*) AS total, SUM(plan = 'paid') AS paid FROM installs GROUP BY k",
  features: 'SELECT feature, COUNT(*) AS n FROM install_features GROUP BY feature',
  // How many features each install has switched on: shows whether the 5-feature free limit actually binds.
  featureCounts: 'SELECT c, COUNT(*) AS n FROM (SELECT COUNT(*) AS c FROM install_features GROUP BY install_id) t GROUP BY c ORDER BY c',
  // What Pro installs actually switch on, against what Free ones do: the case for the price, and which
  // feature a Free install spends one of its five slots on. Plan is not a demographic, so this pairing
  // cannot single anyone out the way age with region would.
  planFeatures: `SELECT f.feature AS k, i.plan AS p, COUNT(*) AS n
    FROM install_features f JOIN installs i ON i.install_id = f.install_id
    GROUP BY k, p`,
  // Which features get chosen together - the input for deciding bundles.
  pairs: `SELECT a.feature AS f1, b.feature AS f2, COUNT(*) AS n
    FROM install_features a JOIN install_features b ON a.install_id = b.install_id AND a.feature < b.feature
    GROUP BY f1, f2 ORDER BY n DESC LIMIT 12`,
  ages: 'SELECT age_band AS k, COUNT(*) AS n FROM installs WHERE age_band IS NOT NULL GROUP BY k',
  genders: 'SELECT gender AS k, COUNT(*) AS n FROM installs WHERE gender IS NOT NULL GROUP BY k',
  platforms: 'SELECT platform AS k, COUNT(*) AS n FROM installs GROUP BY k',
  versions: 'SELECT app_version AS k, COUNT(*) AS n FROM installs GROUP BY k ORDER BY k DESC LIMIT 12',
  regions: 'SELECT time_zone AS k, COUNT(*) AS n FROM installs WHERE time_zone IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 15',
  languages: 'SELECT language AS k, COUNT(*) AS n FROM installs WHERE language IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 10',
  // New installs per week, plus how many of THAT week's arrivals were still opening the app in the last
  // seven days. Read down the column it is a retention curve: does a cohort stay, or quietly go silent.
  // Which companies people follow in the Feed, most followed first. `follower` is the weekly one-way
  // hash from lib/news.js, so this counts people without the server ever holding anyone's portfolio.
  // One week only. A follower value is per week, so counting across several weeks would count the same
  // person once per week and overstate it; within one week the count is exactly the number of people.
  stocks: `SELECT MAX(name) AS k, COUNT(DISTINCT follower) AS n FROM stock_usage
    WHERE week = (SELECT MAX(week) FROM stock_usage)
    GROUP BY name_key ORDER BY n DESC, k LIMIT 25`,
  weekly: `SELECT DATE_FORMAT(first_seen, '%x-W%v') AS k, COUNT(*) AS n,
      SUM(last_seen >= NOW() - INTERVAL 7 DAY) AS alive
    FROM installs GROUP BY k ORDER BY k DESC LIMIT 12`,
};

const num = (v) => Number(v || 0);
const pct = (n, total) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

// Counts keyed by k, in the order of `keys`, including keys with no rows at all (a feature nobody
// picked is the most useful thing on the page, so it must not simply be missing).
function byKey(rows, keys, total) {
  const found = new Map((rows || []).map((r) => [String(r.k), num(r.n)]));
  const list = keys
    ? keys.map((k) => ({ key: k, n: found.get(String(k)) || 0 }))
    : (rows || []).map((r) => ({ key: String(r.k), n: num(r.n) }));
  return list.map((x) => ({ ...x, pct: pct(x.n, total) }));
}

// Is the update path working? Everyone on the newest build means the service worker is landing; a long
// tail three or more versions back means it is not, and a fix shipped today is not reaching people.
function versionHealth(rows) {
  const list = (rows || []).map((r) => ({ v: Number(r.k) || 0, n: num(r.n) })).filter((r) => r.v > 0);
  const tracked = list.reduce((s, r) => s + r.n, 0);
  if (!tracked) return { latest: 0, onLatest: 0, onLatestPct: 0, behind: 0, behindPct: 0, tracked: 0 };
  const latest = Math.max(...list.map((r) => r.v));
  const onLatest = list.filter((r) => r.v === latest).reduce((s, r) => s + r.n, 0);
  const behind = list.filter((r) => r.v <= latest - 3).reduce((s, r) => s + r.n, 0);
  return { latest, onLatest, onLatestPct: pct(onLatest, tracked), behind, behindPct: pct(behind, tracked), tracked };
}

// Free against Pro for every feature. Each side is a percentage OF ITS OWN GROUP, because the two groups
// are nowhere near the same size - comparing raw counts would just say "there are more free installs".
function planFeatures(rows, keys, freeTotal, paidTotal) {
  const get = (k, p) => num(((rows || []).find((r) => String(r.k) === k && r.p === p) || {}).n);
  return keys.map((k) => {
    const free = get(k, 'free');
    const paid = get(k, 'paid');
    return { key: k, free, paid, freePct: pct(free, freeTotal), paidPct: pct(paid, paidTotal) };
  }).sort((a, b) => b.paidPct - a.paidPct || b.freePct - a.freePct || a.key.localeCompare(b.key));
}

// The news side at a glance: how much history the archive holds, how many upstream requests were spent
// today, and whether the provider is currently refusing us. `callsToday` counts every attempt including
// refused ones, because that is what the provider counts against its daily allowance.
export function newsHealth(raw, now = Date.now()) {
  const a = (raw.newsArchive && raw.newsArchive[0]) || {};
  const t = (raw.newsToday && raw.newsToday[0]) || {};
  const p = (raw.newsProvider && raw.newsProvider[0]) || {};
  const failAt = p.at ? new Date(p.at).getTime() : 0;
  return {
    companies: num(a.companies),
    articleDays: num(a.n),
    days: num(a.days),
    firstDay: a.firstDay ? String(a.firstDay).slice(0, 10) : '',
    lastAt: a.lastAt ? new Date(a.lastAt).toISOString() : '',
    callsToday: num(t.calls),
    callersToday: num(t.callers),
    provider: {
      coolingOff: !!failAt && now - failAt < PROVIDER_BACKOFF_MS,
      lastRefusalAt: failAt ? new Date(failAt).toISOString() : '',
    },
  };
}

export function shapeStats(raw, freeLimit = 5) {
  const h = (raw.headline && raw.headline[0]) || {};
  const total = num(h.total);

  const features = FEATURES
    .map((id) => {
      const row = (raw.features || []).find((r) => r.feature === id);
      const n = num(row && row.n);
      return { key: id, n, pct: pct(n, total) };
    })
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));

  const counts = (raw.featureCounts || []).map((r) => ({ c: num(r.c), n: num(r.n) }));
  const withFeatures = counts.reduce((s, r) => s + r.n, 0);
  const atLimit = counts.filter((r) => r.c >= freeLimit).reduce((s, r) => s + r.n, 0);
  const totalChosen = counts.reduce((s, r) => s + r.c * r.n, 0);

  const shaped = {
    generatedAt: new Date().toISOString(),
    headline: {
      total,
      paid: num(h.paid),
      free: total - num(h.paid),
      active1: num(h.active1),
      active7: num(h.active7),
      active30: num(h.active30),
      new7: num(h.new7),
      new30: num(h.new30),
      lapsed: num(h.lapsed),
      // Gone in the last month, as opposed to gone for good: the first group is the one worth chasing.
      justLapsed: num(h.justLapsed),
      shared: num(h.shared),
      sharedPct: pct(num(h.shared), total),
      active30Pct: pct(num(h.active30), total),
      // The habit number: of everyone who opened the app this month, how many opened it today.
      stickiness: pct(num(h.active1), num(h.active30)),
    },
    regularity: (() => { const d = (raw.days && raw.days[0]) || {}; return { tracked: num(d.tracked), regular: num(d.regular), casual: num(d.casual), light: num(d.light), avgDays: Math.round(num(d.avgDays) * 10) / 10, regularPct: pct(num(d.regular), num(d.tracked)) }; })(),
    features,
    unused: features.filter((f) => f.n === 0).map((f) => f.key),
    freePlan: {
      limit: freeLimit,
      atLimit,
      atLimitPct: pct(atLimit, withFeatures),
      avgFeatures: withFeatures > 0 ? Math.round((totalChosen / withFeatures) * 10) / 10 : 0,
      distribution: counts,
    },
    pairs: (raw.pairs || []).map((r) => ({ a: r.f1, b: r.f2, n: num(r.n), pct: pct(num(r.n), total) })),
    ages: byKey(raw.ages, AGE_BANDS, total),
    genders: byKey(raw.genders, GENDERS, total),
    platforms: byKey(raw.platforms, PLATFORMS, total),
    versions: byKey(raw.versions, null, total),
    versionHealth: versionHealth(raw.versions),
    // One point per day, oldest first, ready to draw. A day nobody opened the app is simply absent, which
    // is what the sparkline should show too.
    daily: (raw.daily || []).map((r) => ({ day: String(r.k).slice(0, 10), n: num(r.n) })),
    planFeatures: planFeatures(raw.planFeatures, FEATURES, total - num(h.paid), num(h.paid)),
    // Followed companies over the last four weeks. The percentage is meaningless here (the base is
    // Feed users, not installs), so only the count is carried.
    stocks: (raw.stocks || []).map((r) => ({ key: String(r.k), n: num(r.n) })),
    news: newsHealth(raw),
    regions: byKey(raw.regions, null, total),
    languages: byKey(raw.languages, null, total),
    // Each week's arrivals, and how many of them are still here - a retention curve read top to bottom.
    weekly: byKey(raw.weekly, null, total).map((w, i) => {
      const row = (raw.weekly || [])[i] || {};
      const alive = num(row.alive);
      return { ...w, alive, alivePct: pct(alive, w.n) };
    }),
    newDaily: (raw.newDaily || []).map((r) => ({ day: String(r.k).slice(0, 10), n: num(r.n) })),
    weekday: WEEKDAYS.map((name, i) => ({ name, n: num(((raw.weekday || []).find((r) => Number(r.k) === i + 1) || {}).n) })),
    planPlatform: (raw.planPlatform || []).map((r) => ({ key: String(r.k), total: num(r.total), paid: num(r.paid), paidPct: pct(num(r.paid), num(r.total)) }))
      .sort((a, b) => b.total - a.total),
  };
  shaped.insights = insights(shaped);
  return shaped;
}
