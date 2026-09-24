import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fdCalc, compoundGrowth, presentValue, futureCost, moneyOptions, MONEY_OPTIONS, DEFAULT_INFLATION_PCT, DECISION_DISCLAIMER } from '../../calc-core.js';
import { computeFd } from '../../fd.js';

const near = (a, b, tol = 0.01, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b}`);

test('FD tab: the same answer the Fixed Deposits screen gives for a real deposit', () => {
  const r = fdCalc({ principal: 100000, ratePct: 7.5, months: 12, compounding: 'quarterly', today: '2026-01-01' });
  const real = computeFd({ principal: 100000, rate: 7.5, startDate: '2026-01-01', maturityDate: '2027-01-01', compounding: 'quarterly', payout: 'cumulative' }, Date.parse('2026-01-01T00:00:00Z'));
  near(r.maturityValue, real.maturityValue, 0.001, 'maturity');
  near(r.interest, real.totalInterest, 0.001, 'interest');
  assert.equal(r.maturityDate, '2027-01-01');
  assert.ok(r.effectivePct > 7.5 && r.effectivePct < 7.8, 'quarterly compounding lifts the yield a little: ' + r.effectivePct);
  const p = fdCalc({ principal: 120000, ratePct: 8, months: 24, payout: true, today: '2026-01-01' });
  near(p.monthlyIncome, 800, 0.001, 'interest paid out monthly');
  assert.equal(fdCalc({ principal: 0, ratePct: 7, months: 12 }), null, 'nothing to work out');
  assert.equal(fdCalc({ principal: 1000, ratePct: 7, months: 0 }), null);
});

test('Compound: a lump sum gives exactly P(1 + r/n)^(nt); monthly additions add up; the years are listed', () => {
  const lump = compoundGrowth({ principal: 10000, ratePct: 12, years: 5, perYear: 4 });
  near(lump.futureValue, 10000 * Math.pow(1 + 0.12 / 4, 20), 0.01);
  assert.equal(lump.byYear.length, 5);
  const sip = compoundGrowth({ monthly: 1000, ratePct: 0, years: 2, perYear: 12 });
  near(sip.futureValue, 24000, 1e-9, 'zero rate: just the additions');
  assert.equal(sip.invested, 24000);
  const both = compoundGrowth({ principal: 50000, monthly: 2000, ratePct: 8, years: 10, perYear: 12 });
  assert.ok(both.futureValue > both.invested && both.interest > 0);
  assert.equal(compoundGrowth({ ratePct: 8, years: 10 }), null, 'no money: nothing to work out');
  assert.equal(compoundGrowth({ principal: 1, ratePct: 8, years: 500 }).years, 60, 'capped so a typo cannot hang the phone');
});

test('Inflation: the old calculator\'s answer, unchanged, plus the same figure read the other way round', () => {
  assert.equal(DEFAULT_INFLATION_PCT, 4.82, 'the old default, so nobody\'s starting point moved');
  near(presentValue(100000, 6, 10), 100000 / Math.pow(1.06, 10), 0.001);
  near(futureCost(100000, 6, 10), 100000 * Math.pow(1.06, 10), 0.001);
  assert.equal(presentValue(100000, 6, 0), null, 'a year in the past or now is refused');
  const ui = readFileSync(new URL('../../calc-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /DB\.get\('meta', 'inflationRatePct'\)/, 'the rate saved by the old calculator is still the one used');
  assert.match(ui, /DB\.put\('meta', \{ key: 'inflationRatePct', value: r \}\)/);
});

test('Decide: a short, low-risk need puts capital-preserving options first and says why the rest fit less', () => {
  const r = moneyOptions({ amount: 200000, months: 36, risk: 'low' });
  assert.equal(r.rows[0].fit, 'closer');
  const fit = Object.fromEntries(r.rows.map((o) => [o.id, o.fit]));
  assert.equal(fit.banksav, 'closer'); assert.equal(fit.fd, 'closer');
  assert.equal(fit.stocks, 'looser'); assert.equal(fit.mfequity, 'looser');
  assert.match(r.framing, /capital preservation/);
  for (const o of r.rows) assert.ok(o.reasons.length >= 1, o.id + ' says why');
  // A long time frame with a high tolerance brings growth options in.
  const long = Object.fromEntries(moneyOptions({ months: 120, risk: 'high', goal: 'growth' }).rows.map((o) => [o.id, o.fit]));
  assert.equal(long.mfequity, 'closer'); assert.equal(long.stocks, 'closer');
  // An emergency reserve must stay reachable.
  assert.equal(Object.fromEntries(moneyOptions({ months: 60, risk: 'high', goal: 'emergency' }).rows.map((o) => [o.id, o.fit])).bond, 'looser');
  assert.equal(moneyOptions({ months: 0 }), null);
});

test('Decide never gives advice: no "invest in", no "you should", no promised returns, always the disclaimer', () => {
  const texts = [];
  for (const risk of ['low', 'medium', 'high']) for (const months of [3, 18, 48, 120]) for (const goal of ['', 'emergency', 'purchase', 'growth']) {
    const r = moneyOptions({ amount: 100000, months, risk, goal });
    texts.push(r.framing, ...r.rows.flatMap((o) => o.reasons));
  }
  texts.push(...MONEY_OPTIONS.flatMap((o) => [o.note, o.growth, o.preservation]));
  const all = texts.join('\n');
  assert.doesNotMatch(all, /\binvest in\b|\byou should\b|\bbuy\b|\bguarantee/i);
  assert.doesNotMatch(all, /\d+(\.\d+)?\s*% (return|a year|p\.a\.)/i, 'no promised rate of return');
  assert.match(DECISION_DISCLAIMER, /not financial advice/);
  assert.match(readFileSync(new URL('../../calc-ui.js', import.meta.url), 'utf8'), /DECISION_DISCLAIMER/, 'shown on the page');
});

test('Financial Calculators is a screen of its own, reached where the Inflation Calculator was, and works offline', () => {
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  assert.match(app, /savings: \['ef', 'div', 'banksav', 'calc'\]/);
  assert.match(app, /modOn\(_sm, 'calc'\) \? calcCard : null/, 'the Savings card slot the Inflation Calculator had');
  assert.equal(/openInflationCalculator/.test(app), false, 'the old one-screen calculator is gone');
  assert.match(app, /import\('\.\/calc-ui\.js'\)/, 'loaded only when opened');
  const sw = readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./calc-core.js'") && sw.includes("'./calc-ui.js'"), 'precached for offline use');
});
