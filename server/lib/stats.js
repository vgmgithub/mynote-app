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
      SUM(last_seen >= NOW() - INTERVAL 7 DAY) AS active7,
      SUM(last_seen >= NOW() - INTERVAL 30 DAY) AS active30,
      SUM(first_seen >= NOW() - INTERVAL 7 DAY) AS new7,
      SUM(first_seen >= NOW() - INTERVAL 30 DAY) AS new30,
      SUM(last_seen < NOW() - INTERVAL 30 DAY) AS lapsed,
      SUM(age_band IS NOT NULL OR gender IS NOT NULL) AS shared
    FROM installs`,
  features: 'SELECT feature, COUNT(*) AS n FROM install_features GROUP BY feature',
  // How many features each install has switched on: shows whether the 5-feature free limit actually binds.
  featureCounts: 'SELECT c, COUNT(*) AS n FROM (SELECT COUNT(*) AS c FROM install_features GROUP BY install_id) t GROUP BY c ORDER BY c',
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
  weekly: `SELECT DATE_FORMAT(first_seen, '%x-W%v') AS k, COUNT(*) AS n FROM installs GROUP BY k ORDER BY k DESC LIMIT 12`,
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
      active7: num(h.active7),
      active30: num(h.active30),
      new7: num(h.new7),
      new30: num(h.new30),
      lapsed: num(h.lapsed),
      shared: num(h.shared),
      sharedPct: pct(num(h.shared), total),
      active30Pct: pct(num(h.active30), total),
    },
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
    regions: byKey(raw.regions, null, total),
    languages: byKey(raw.languages, null, total),
    weekly: byKey(raw.weekly, null, total),
  };
}
