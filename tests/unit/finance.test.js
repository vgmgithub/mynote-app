import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFd, addMonths } from '../../fd.js';
import { xirr, investedOf, computeFund, nextSip, sipReminder, validSipDay } from '../../mf.js';
import { computeBond } from '../../bonds.js';
import { summary } from '../../metal.js';
import { computeCredit } from '../../credit.js';
import { ymToLabel, labelToYm } from '../../core.js';
import { yearTotal, yearsOf, parseMonths, monthsToStr } from '../../dividend.js';

const NOW = Date.parse('2026-09-19');

// ---- Fixed deposits ----
const fd = { principal: 100000, rate: 8, startDate: '2026-01-01', maturityDate: '2027-01-01', compounding: 'quarterly', payout: 'cumulative' };
test('FD: quarterly compounding matures near principal x (1+r/4)^4', () => {
  const c = computeFd(fd, NOW);
  assert.ok(Math.abs(c.maturityValue - 108243) < 30, 'got ' + c.maturityValue);
  assert.equal(c.effectiveStatus, 'active');
  assert.equal(c.daysToMaturity, 104);
});
test('FD: status comes only from the date', () => {
  assert.equal(computeFd(fd, Date.parse('2027-06-01')).effectiveStatus, 'matured');
});
test('FD: addMonths keeps the day, and clamps in a short month', () => {
  assert.equal(addMonths('2026-03-15', 12), '2027-03-15');
  assert.match(addMonths('2026-01-31', 1), /^2026-0[23]-/);
});

// ---- Mutual funds ----
test('MF: a single lump sum held one year has XIRR equal to its simple return', () => {
  const r = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]);
  assert.ok(Math.abs(r - 0.1) < 1e-6, 'got ' + r);
});
test('MF: a partial sell removes cost basis in proportion (average cost)', () => {
  assert.equal(investedOf({ contributions: [
    { date: '2025-01-01', amount: 1000, units: 10, nav: 100 },
    { date: '2025-06-01', amount: 1200, units: 10, nav: 120 },
    { date: '2025-09-01', amount: 1100, units: 5, nav: 220, type: 'sell' },
  ] }), 1650);
});
test('MF: current value is units x latest NAV', () => {
  const c = computeFund({ contributions: [{ date: '2025-01-01', amount: 1000, units: 10, nav: 100 }], latestNav: 120, navAsOf: '2026-01-01', status: 'Investing' }, Date.parse('2026-01-01'));
  assert.equal(c.invested, 1000);
  assert.equal(c.value, 1200);
  assert.ok(Math.abs(c.absReturnPct - 20) < 1e-9);
});

// ---- Bonds, metals, credit cards ----
test('Bond: a payout bond keeps principal flat and earns simple interest', () => {
  const b = computeBond({ investAmount: 10000, rate: 12, startDate: '2026-01-01', maturityDate: '2027-01-01', payout: 'payout', payouts: [] }, NOW);
  assert.equal(b.effectiveStatus, 'active');
  assert.equal(b.outstandingPrincipal, 10000);
  assert.ok(Math.abs(b.totalInterest - 1200) < 5, 'got ' + b.totalInterest);
});
test('Metals: selling half the grams removes half the cost, not the sale price', () => {
  const s = summary([
    { metal: 'gold', date: '2025-01-01', grams: 10, amount: 60000, type: 'buy' },
    { metal: 'gold', date: '2025-06-01', grams: -5, amount: 35000, type: 'sell' },
  ], 'gold', 8000);
  assert.equal(s.grams, 5);
  assert.equal(s.invested, 30000);
  assert.equal(s.value, 40000);
  assert.equal(s.realized, 5000);
});
test('Credit: to-be-paid is billed minus reimbursement, never negative', () => {
  const g = computeCredit([{ id: 1, name: 'C', months: [{ ym: '2026-08', billed: 5000, status: 'Ontime' }] }], { '2026-08': 1200, '2026-09': 300 });
  assert.equal(g.monthly.find((m) => m.ym === '2026-08').toBePaid, 3800);
  assert.equal(g.monthly.find((m) => m.ym === '2026-09').toBePaid, 0);
});

// ---- Small shared helpers ----
test('Month labels round-trip between the two storage forms', () => {
  assert.equal(ymToLabel('2026-06'), 'Jun 2026');
  assert.equal(labelToYm('Jun 2026'), '2026-06');
});
test('Dividends: yearly totals, newest-first years, payout months', () => {
  const rec = { market: 'in', months: ['Mar', 'Sep'], years: [{ year: 2025, units: 100, perUnit: 5 }, { year: 2026, units: 100, perUnit: 6 }] };
  assert.equal(yearTotal(rec, 2025), 500);
  assert.equal(yearTotal(rec, 2026), 600);
  assert.deepEqual(yearsOf(rec), [2026, 2025]);
  assert.deepEqual(parseMonths('Mar, Sep'), ['Mar', 'Sep']);
  assert.equal(monthsToStr(['Mar', 'Sep']), 'Mar, Sep');
});

test('SIP date: next occurrence, month-end clamping, and the two-day reminder window', () => {
  const d = (x) => new Date(x + 'T09:00:00');
  assert.deepEqual(nextSip(10, d('2026-09-08')), { days: 2, date: '2026-09-10' });
  assert.deepEqual(nextSip(10, d('2026-09-10')), { days: 0, date: '2026-09-10' }, 'today counts as 0');
  assert.deepEqual(nextSip(10, d('2026-09-11')), { days: 29, date: '2026-10-10' }, 'rolls to next month');
  assert.deepEqual(nextSip(31, d('2026-09-28')), { days: 2, date: '2026-09-30' }, '31 falls on the 30th in a 30-day month');
  assert.deepEqual(nextSip(31, d('2026-02-27')), { days: 1, date: '2026-02-28' });
  assert.equal(nextSip(0, d('2026-09-08')), null); assert.equal(nextSip(32, d('2026-09-08')), null); assert.equal(nextSip('', d('2026-09-08')), null);
  assert.equal(validSipDay('15'), 15); assert.equal(validSipDay(null), null);
  const fund = { name: 'Quant Small Cap', sip: 1000, sipDay: 10, status: 'Investing' };
  assert.equal(sipReminder(fund, d('2026-09-07')), null, 'three days ahead: too early');
  assert.deepEqual(sipReminder(fund, d('2026-09-08')), { name: 'Quant Small Cap', amount: 1000, days: 2, date: '2026-09-10' });
  assert.equal(sipReminder(fund, d('2026-09-10')).days, 0);
  assert.equal(sipReminder({ ...fund, sipDay: null }, d('2026-09-08')), null, 'no date given, no reminder');
  assert.equal(sipReminder({ ...fund, sip: 0 }, d('2026-09-08')), null, 'no SIP amount, no reminder');
  assert.equal(sipReminder({ ...fund, status: 'Stopped' }, d('2026-09-08')), null);
  assert.equal(sipReminder({ ...fund, soldDate: '2026-01-01' }, d('2026-09-08')), null);
  assert.ok(sipReminder({ ...fund, status: 'Investing On/Off' }, d('2026-09-08')), 'an on/off SIP still reminds');
});
