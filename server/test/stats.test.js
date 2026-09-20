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

test('age is never combined with gender or region in one query (nobody can be singled out)', () => {
  for (const sql of Object.values(STAT_QUERIES)) {
    const dims = ['age_band', 'gender', 'time_zone'].filter((d) => new RegExp('GROUP BY[\s\S]*' + d, 'i').test(sql)
      || new RegExp(d + '\s+AS\s+k', 'i').test(sql));
    assert.ok(dims.length <= 1, 'cross-tabulated: ' + dims.join(' + '));
  }
});
