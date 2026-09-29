import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLoan, ladderTargets, computeEmergencyFund, lastTargetAchieved, addMonths } from '../../emergency.js';

const NOW = Date.parse('2026-09-19');
const loan = (amount, months, kind) => ({ amount, takenDate: '2026-01-10', closedDate: addMonths('2026-01-10', months), loanKind: kind, repayments: [] });
const interest = (a, m, k) => computeLoan(loan(a, m, k), NOW, 2).interest;

test('loan interest follows the written rulebook (2% x band, rounded up to 100)', () => {
  assert.equal(interest(20000, 6, 'self'), 800);
  assert.equal(interest(20000, 3, 'self'), 400);
  assert.equal(interest(15000, 3, 'self'), 300);
  assert.equal(interest(15000, 4, 'self'), 600);
  assert.equal(interest(12500, 3, 'self'), 300);   // 250 rounds UP to the next 100
  assert.equal(interest(20000, 12, 'self'), 1600); // 4x band
});

test('emergency (3 months) and gift (5 months) loans are free inside their grace window', () => {
  assert.equal(interest(10000, 2, 'emergency'), 0);
  assert.equal(interest(15000, 4, 'gift'), 0);
});

test('an absorbing target replaces the running total instead of stacking', () => {
  const r = ladderTargets([
    { amount: 10000, ladder: 'add', order: 1 },
    { amount: 20000, ladder: 'absorb', order: 2 },
    { amount: 5000, ladder: 'add', order: 3 },
  ], 22000);
  assert.deepEqual(r.map((t) => t.cumulative), [10000, 20000, 25000]);
  assert.deepEqual(r.map((t) => t.isMet), [true, true, false]);
});

const contributions = [1, 2, 3, 4].map((m) => ({ date: `2026-0${m}-05`, mine: 5000, spouse: 5000 }));
const targets = [
  { name: 'Starter', amount: 15000, ladder: 'add', order: 1 },
  { name: 'Joint', amount: 30000, ladder: 'absorb', order: 2 },
  { name: 'Big', amount: 100000, ladder: 'add', order: 3 },
];

test('last target achieved is dated by when the running total crossed it', () => {
  const c = computeEmergencyFund({ contributions, targets, loans: [] }, NOW);
  const r = lastTargetAchieved(c, NOW);
  assert.equal(r.target.name, 'Joint');
  assert.equal(r.date, '2026-03-05');
  assert.equal(r.days, 198);
});

test('nothing achieved gives null', () => {
  const c = computeEmergencyFund({ contributions: [{ date: '2026-01-05', mine: 100, spouse: 100 }], targets, loans: [] }, NOW);
  assert.equal(lastTargetAchieved(c, NOW), null);
});

test('interest from a closed loan can be what tips a target over', () => {
  const c = computeEmergencyFund({
    contributions: [{ date: '2026-05', mine: 5000, spouse: 4950 }],
    targets: [{ name: 'T', amount: 10000, ladder: 'add', order: 1 }],
    loans: [{ amount: 1000, takenDate: '2026-05-10', closedDate: '2026-08-10', loanKind: 'self', repayments: [] }],
  }, NOW);
  const r = lastTargetAchieved(c, NOW);
  assert.equal(r.date, '2026-08-10');
  assert.equal(r.days, 40);
});

test('the fund charges its default 2% rate when a loan carries none', () => {
  const c = computeEmergencyFund({ contributions: [], targets: [], loans: [{ amount: 20000, takenDate: '2026-01-10', closedDate: addMonths('2026-01-10', 6), loanKind: 'self', repayments: [] }] }, NOW);
  assert.equal(c.loanInterestRealised, 800);
});

test('repayment schedule: the 1st of each month after the draw month through the expected month', async () => {
  const m = await import('../../emergency.js');
  // The owner's own example: taken 2 Jan 2027, back 1 Jun 2027.
  assert.deepEqual(m.repayMonths('2027-01-02', '2027-06-01'), ['2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01']);
  assert.deepEqual(m.repayMonths('2027-11-15', '2028-02-10'), ['2027-12-01', '2028-01-01', '2028-02-01'], 'crosses the year');
  assert.deepEqual(m.repayMonths('2027-01-02', ''), [], 'no expected date, no schedule');
  assert.equal(m.repayMonths('2027-01-01', '2099-01-01').length, 24, 'capped');
});

test('repayment schedule: even split with the interest in it, paid months locked, an edit re-splits only the months after it', async () => {
  const m = await import('../../emergency.js');
  const d = m.repayMonths('2027-01-02', '2027-06-01');
  let s = m.buildRepaySchedule([], d, 50000, 2000);
  assert.deepEqual(s.map((r) => [r.amount, r.principal, r.interest]), Array(5).fill([10400, 10000, 400]));
  s[0].paid = true; s[1].paid = true;
  const a = m.adjustSchedule(s, 2, 15000, 50000, 2000);
  assert.deepEqual(a.rows.map((r) => r.amount), [10400, 10400, 15000, 8100, 8100]);
  assert.equal(a.over, 0);
  assert.deepEqual(m.adjustSchedule(s, 0, 1, 50000, 2000).rows[0].amount, 10400, 'a paid month cannot be changed');
  // Too much in one month: the months after go to 0, and it says by how much.
  const big = m.adjustSchedule(s, 2, 40000, 50000, 2000);
  assert.deepEqual(big.rows.slice(3).map((r) => r.amount), [0, 0]);
  assert.equal(big.over, 8800);
  // The last month edited down: nothing after it to carry the rest.
  assert.equal(m.adjustSchedule(s, 4, 100, 50000, 2000).short, 10300);
  const sum = m.scheduleSummary(a.rows);
  assert.equal(sum.paidInterest, 800, 'interest collected = what the paid months carried');
  assert.equal(sum.dueInterest, 1200, 'interest still to come');
  assert.equal(sum.paidPrincipal, 20000);
});

test('repayment schedule: turning interest off after paying months that carried it never leaves principal unscheduled', async () => {
  const m = await import('../../emergency.js');
  const d = m.repayMonths('2027-01-02', '2027-06-01');
  const s = m.buildRepaySchedule([], d, 50000, 2000);
  s[0].paid = true; s[1].paid = true;
  const off = m.buildRepaySchedule(s, d, 50000, 0);
  assert.deepEqual(off.map((r) => r.amount), [10400, 10400, 10000, 10000, 10000]);
  assert.equal(off.reduce((t, r) => t + r.principal, 0), 50000);
});

test('the loan form: amount capped at what is available, no Settlement on a new loan, schedule written back as repayments', () => {
  const src = readFileSync(new URL('../../ef.js', import.meta.url), 'utf8');
  const form = src.slice(src.indexOf('async function openEfLoanForm'), src.indexOf('async function openEfContribForm'));
  assert.match(form, /if \(overAvailable\(\)\) \{ syncAmountErr\(\); toast\('More than the '/);
  assert.match(form, /isEdit \? formSection\('✅', 'Settlement'/, 'Settlement only on a saved loan');
  assert.ok(form.indexOf("'Notes', [noteBox.node]") > 0 && form.indexOf("'Notes', [noteBox.node]") < form.indexOf("formSection('✅', 'Settlement'"), 'Settlement below the notes');
  assert.match(form, /repayments: legacy \? repayEditor\.collect\(\) : schedPaidRepayments\(\),/);
  assert.match(form, /const legacy = !Array\.isArray\(r\.schedule\) && \(r\.repayments \|\| \[\]\)\.length > 0;/, 'an older loan keeps its own ledger');
  // Loan Rules: (fund value - loans out) / 4.
  assert.match(src, /const helpBase = Math\.max\(0, round2\(fundTotal - lentOutNow\)\);/);
  assert.match(src, /const helpCap = round2\(helpBase \* \(mod\.EF_HELP_SHARE \/ 100\)\);/);
});
