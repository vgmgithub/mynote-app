import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeStats, STAT_QUERIES } from '../lib/stats.js';
import { FEATURES } from '../lib/validate.js';

const raw = () => ({
  headline: [{ total: 10, paid: 2, active7: 6, active30: 9, new7: 3, new30: 7, lapsed: 1, shared: 4 }],
  features: [{ feature: 'stocks', n: 8 }, { feature: 'mf', n: 5 }, { feature: 'expense', n: 5 }],
  featureCounts: [{ c: 1, n: 2 }, { c: 2, n: 5 }, { c: 5, n: 3 }],
  pairs: [{ f1: 'mf', f2: 'stocks', n: 4 }],
  ages: [{ k: '25-34', n: 3 }],
  genders: [{ k: 'Female', n: 2 }],
  platforms: [{ k: 'android', n: 7 }],
  versions: [{ k: 604, n: 6 }],
  regions: [{ k: 'Asia/Calcutta', n: 9 }],
  languages: [{ k: 'en-IN', n: 8 }],
  weekly: [{ k: '2026-W38', n: 10 }],
  days: [{ tracked: 8, regular: 2, casual: 3, light: 3, avgDays: 5.25 }],
});

test('headline figures, including the free/paid split derived from the total', () => {
  const s = shapeStats(raw()).headline;
  assert.equal(s.total, 10);
  assert.equal(s.paid, 2);
  assert.equal(s.free, 8);
  assert.equal(s.lapsed, 1);
  assert.equal(s.sharedPct, 40);
  assert.equal(s.active30Pct, 90);
});

test('regularity: how many installs open the app on 8+ days of 30, and it survives a missing table', () => {
  const r = shapeStats(raw()).regularity;
  assert.deepEqual([r.tracked, r.regular, r.casual, r.light, r.avgDays, r.regularPct], [8, 2, 3, 3, 5.3, 25]);
  const none = shapeStats({ ...raw(), days: [] }).regularity;
  assert.deepEqual([none.tracked, none.regular, none.regularPct], [0, 0, 0]);
});

test('every feature appears, ranked, with the ones nobody picked listed separately', () => {
  const s = shapeStats(raw());
  assert.equal(s.features.length, FEATURES.length, 'all 14 features are present, not just those with rows');
  assert.equal(s.features[0].key, 'stocks');
  assert.equal(s.features[0].pct, 80);
  assert.deepEqual(s.features.slice(1, 3).map((f) => f.key), ['expense', 'mf'], 'ties break alphabetically');
  assert.ok(s.unused.includes('vault') && s.unused.includes('health'));
  assert.ok(!s.unused.includes('stocks'));
  assert.equal(s.unused.length, FEATURES.length - 3);
});

test('free-plan pressure: how many sit at the limit, and the average per install', () => {
  const f = shapeStats(raw()).freePlan;
  assert.equal(f.limit, 5);
  assert.equal(f.atLimit, 3, '3 installs use all five slots');
  assert.equal(f.atLimitPct, 30, 'out of the 10 installs that picked anything');
  assert.equal(f.avgFeatures, 2.7, '(1*2 + 2*5 + 5*3) / 10');
});

test('an empty database gives zeroes, not errors or NaN', () => {
  const s = shapeStats({});
  assert.equal(s.headline.total, 0);
  assert.equal(s.headline.sharedPct, 0);
  assert.equal(s.freePlan.avgFeatures, 0);
  assert.equal(s.freePlan.atLimitPct, 0);
  assert.equal(s.features.length, FEATURES.length);
  assert.equal(s.unused.length, FEATURES.length);
  assert.deepEqual(s.pairs, []);
  assert.ok(s.features.every((f) => f.n === 0 && f.pct === 0));
  assert.ok(!JSON.stringify(s).includes('NaN') && !JSON.stringify(s).includes('null'));
});

test('no query selects a raw identifier or row-level data', () => {
  for (const [name, sql] of Object.entries(STAT_QUERIES)) {
    assert.match(sql, /^SELECT/i, name);
    assert.match(sql, /COUNT\(|SUM\(/i, name + ' must aggregate');
    assert.doesNotMatch(sql, /SELECT\s+\*/i, name + ' must not select whole rows');
    assert.doesNotMatch(sql, /\bSELECT\s+install_id\b|,\s*install_id\s+AS/i, name + ' must not return install ids');
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i, name + ' must be read-only');
  }
});

test('the daily line is one point per day, oldest first, and survives a missing install_days table', () => {
  const d = shapeStats({ ...raw(), daily: [{ k: '2026-09-19', n: 3 }, { k: '2026-09-20', n: 5 }] }).daily;
  assert.deepEqual(d, [{ day: '2026-09-19', n: 3 }, { day: '2026-09-20', n: 5 }]);
  assert.deepEqual(shapeStats(raw()).daily, [], 'no table, no points - not an error');
});

test('stickiness is today against the month, and the churn edge separates newly quiet from long gone', () => {
  const h = shapeStats({ ...raw(), headline: [{ total: 10, paid: 2, active1: 3, active30: 9, lapsed: 4, justLapsed: 1 }] }).headline;
  assert.equal(h.stickiness, 33.3, 'of the 9 active this month, 3 opened it today');
  assert.equal(h.lapsed, 4);
  assert.equal(h.justLapsed, 1, 'one of the four went quiet in the last month and is worth chasing');
  assert.equal(shapeStats({ ...raw(), headline: [{ total: 0 }] }).headline.stickiness, 0, 'an empty database is 0%, not NaN');
});

test('retention: each week carries how many of its own arrivals are still opening the app', () => {
  const w = shapeStats({ ...raw(), weekly: [{ k: '2026-W38', n: 8, alive: 2 }, { k: '2026-W37', n: 0, alive: 0 }] }).weekly;
  assert.equal(w[0].n, 8);
  assert.equal(w[0].alive, 2);
  assert.equal(w[0].alivePct, 25, 'a quarter of that week stayed');
  assert.equal(w[1].alivePct, 0, 'a week with no arrivals is 0%, not a division by zero');
});

test('update health: who is on the newest build and who is three or more behind', () => {
  const v = shapeStats({ ...raw(), versions: [{ k: 709, n: 6 }, { k: 708, n: 2 }, { k: 700, n: 2 }] }).versionHealth;
  assert.equal(v.latest, 709);
  assert.equal(v.onLatest, 6);
  assert.equal(v.onLatestPct, 60);
  assert.equal(v.behind, 2, 'v700 is well past three behind; v708 is not');
  assert.equal(v.behindPct, 20);
  assert.deepEqual(shapeStats({ ...raw(), versions: [] }).versionHealth.tracked, 0);
});

test('feature adoption by plan is a share of each plan, because the two groups are different sizes', () => {
  const s = shapeStats({
    ...raw(),
    headline: [{ total: 12, paid: 2 }],                    // 10 free, 2 paid
    planFeatures: [{ k: 'vault', p: 'paid', n: 2 }, { k: 'vault', p: 'free', n: 1 },
      { k: 'stocks', p: 'free', n: 9 }, { k: 'stocks', p: 'paid', n: 1 }],
  }).planFeatures;
  const by = Object.fromEntries(s.map((f) => [f.key, f]));
  assert.deepEqual([by.vault.paid, by.vault.paidPct], [2, 100], 'both Pro installs use the vault');
  assert.deepEqual([by.vault.free, by.vault.freePct], [1, 10]);
  assert.deepEqual([by.stocks.free, by.stocks.freePct], [9, 90]);
  assert.equal(s.length, FEATURES.length, 'a feature nobody on either plan uses still has a row');
  assert.equal(s[0].key, 'vault', 'ranked by the Pro share: what the plan is actually being bought for');
});

test('age is never combined with gender or region in one query (nobody can be singled out)', () => {
  for (const sql of Object.values(STAT_QUERIES)) {
    const dims = ['age_band', 'gender', 'time_zone'].filter((d) => new RegExp('GROUP BY[\s\S]*' + d, 'i').test(sql)
      || new RegExp(d + '\s+AS\s+k', 'i').test(sql));
    assert.ok(dims.length <= 1, 'cross-tabulated: ' + dims.join(' + '));
  }
});
