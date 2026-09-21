// Aggregate statistics for the /admin dashboard.
//
// Privacy by design: every query below returns COUNTS ONLY. No install id, no row-level data, and no
// cross-tabulation (age is never combined with gender or region), so a single person cannot be picked
// out of the results even though the page is public.
import { FEATURES, AGE_BANDS, GENDERS, PLATFORMS } from './validate.js';

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
  // One point per day for the last 30: the only figure on the page that shows a direction rather than a
  // snapshot. COUNT(DISTINCT install_id) is a count, not an identifier - no id leaves the query.
  daily: `SELECT day AS k, COUNT(DISTINCT install_id) AS n FROM install_days
    WHERE day >= CURRENT_DATE - INTERVAL 29 DAY GROUP BY day ORDER BY day`,
  // Days each install checked in during the last 30 (counts only; no ids leave the query).
  days: `SELECT COUNT(*) AS tracked, SUM(d >= 8) AS regular, SUM(d BETWEEN 3 AND 7) AS casual, SUM(d <= 2) AS light, AVG(d) AS avgDays
    FROM (SELECT COUNT(*) AS d FROM install_days WHERE day >= CURRENT_DATE - INTERVAL 29 DAY GROUP BY install_id) t`,
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

  return {
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
    regions: byKey(raw.regions, null, total),
    languages: byKey(raw.languages, null, total),
    // Each week's arrivals, and how many of them are still here - a retention curve read top to bottom.
    weekly: byKey(raw.weekly, null, total).map((w, i) => {
      const row = (raw.weekly || [])[i] || {};
      const alive = num(row.alive);
      return { ...w, alive, alivePct: pct(alive, w.n) };
    }),
  };
}
