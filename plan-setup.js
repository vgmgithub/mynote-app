// Pure logic for the Pro yearly-plan setup flow. No DOM, no storage, so it can be unit tested.
// The values map onto the existing Yearly plan record (the `allocations` store), key for key.
//
// Line keys (all monthly amounts, in the order the flow asks for them):
//   salary (income), loan, emergency, home (shown as "Parents"), houseExp (+ sharedOn / sharedAmount),
//   mf, fd, indStock, usStock, metal, card (shown as "Personal spending"), savings.

export const EF_MIN_PCT = 5;
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const val = (n) => Math.max(0, Number(n) || 0);

// Every line that is money going out of the salary (salary itself is the income).
export const OUT_KEYS = ['loan', 'emergency', 'home', 'houseExp', 'mf', 'fd', 'indStock', 'usStock', 'metal', 'card', 'savings'];
export const LABELS = {
  salary: 'Salary', loan: 'Existing loans', emergency: 'Emergency fund', home: 'Parents', houseExp: 'House expense',
  sharedAmount: 'Shared by others', mf: 'Mutual Funds', fd: 'FD', indStock: 'Indian stocks', usStock: 'US stocks',
  metal: 'Metal', card: 'Personal spending', savings: 'Savings',
};

// The smallest emergency-fund amount the flow accepts: 5% of the monthly salary.
export const emergencyFloor = (salary) => round2(val(salary) * EF_MIN_PCT / 100);

// What is still unallocated: salary less every outgoing line (savings included).
export const balance = (v) => round2(val(v.salary) - OUT_KEYS.reduce((s, k) => s + val(v[k]), 0));

// What savings would be if it took everything left after the other lines (never negative).
export const remainderForSavings = (v) => Math.max(0, round2(val(v.salary) - OUT_KEYS.filter((k) => k !== 'savings').reduce((s, k) => s + val(v[k]), 0)));

// The two mandatory lines. Returns null when fine, otherwise the reason.
export function problemWith(v) {
  if (!(val(v.salary) > 0)) return 'Enter your monthly in-hand salary.';
  if (val(v.emergency) + 1e-9 < emergencyFloor(v.salary)) return 'Emergency fund must be at least ' + EF_MIN_PCT + '% of your salary.';
  return null;
}

// Starting values: an existing yearly plan (an imported or earlier one) wins, else empty.
export function startValues(existing) {
  const e = existing || {};
  const v = { salary: val(e.salary), sharedOn: !!e.sharedOn, sharedAmount: val(e.sharedAmount) };
  OUT_KEYS.forEach((k) => { v[k] = val(e[k]); });
  return v;
}

// Only the lines that differ between what is stored and what was entered. `existing` may be missing.
export function diffAgainst(existing, entered) {
  const e = startValues(existing);
  const n = startValues(entered);
  const rows = [];
  ['salary'].concat(OUT_KEYS).forEach((k) => { if (round2(e[k]) !== round2(n[k])) rows.push({ key: k, label: LABELS[k], old: round2(e[k]), now: round2(n[k]) }); });
  const oldShared = e.sharedOn ? e.sharedAmount : 0, newShared = n.sharedOn ? n.sharedAmount : 0;
  if (round2(oldShared) !== round2(newShared)) rows.push({ key: 'sharedAmount', label: LABELS.sharedAmount, old: round2(oldShared), now: round2(newShared) });
  return rows;
}

// The record to save for a year. Starts from the stored record so its id, createdAt and any field this flow
// does not know about survive; only the lines the flow owns are replaced.
export function toRecord(year, entered, existing, now = new Date().toISOString()) {
  const n = startValues(entered);
  const rec = Object.assign({}, existing || {});
  rec.year = year;
  rec.salary = n.salary;
  OUT_KEYS.forEach((k) => { rec[k] = n[k]; });
  rec.sharedOn = !!n.sharedOn;
  rec.sharedAmount = n.sharedOn ? n.sharedAmount : 0;
  rec.createdAt = (existing && existing.createdAt) || now;
  rec.updatedAt = now;
  return rec;
}

// Does this install still need to be walked through the setup?
//   done      meta.planSetupDone value ({ year, at }) or null
//   current   the stored plan for the current year, or null
export function needsSetup(done, current, year) {
  if (!done) return true;
  if (done.year !== year && !(current && val(current.salary) > 0)) return true;
  return false;
}
