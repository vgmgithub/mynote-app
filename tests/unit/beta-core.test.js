import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentWindow, lastClosedWindow, validateFeedback, QUESTIONS, offerCopy } from '../../beta-core.js';

// Device-local instants (no timezone shifting - this module works on whatever clock the phone has).
const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0);

test('currentWindow: open Friday 00:00 through Sunday 23:59:59.999, closed Monday through Thursday', () => {
  // 2026-09-25 is a Friday (device-local, matching the server test fixture's own date).
  const fri = currentWindow(local(2026, 9, 25, 0, 0));
  assert.equal(fri.weekKey, '2026-09-25'); assert.equal(fri.isOpen, true);
  const sat = currentWindow(local(2026, 9, 26, 23, 0));
  assert.equal(sat.weekKey, '2026-09-25'); assert.equal(sat.isOpen, true);
  const sun = currentWindow(local(2026, 9, 27, 23, 59));
  assert.equal(sun.weekKey, '2026-09-25'); assert.equal(sun.isOpen, true);
  const mon = currentWindow(local(2026, 9, 28, 0, 0));
  assert.equal(mon.weekKey, '2026-09-25'); assert.equal(mon.isOpen, false);
  const thu = currentWindow(local(2026, 10, 1, 12, 0));
  assert.equal(thu.weekKey, '2026-09-25'); assert.equal(thu.isOpen, false);
  const nextFri = currentWindow(local(2026, 10, 2, 0, 0));
  assert.equal(nextFri.weekKey, '2026-10-02'); assert.equal(nextFri.isOpen, true);
});

test('lastClosedWindow: the week before this one, whenever asked mid-window; unchanged (still closed) otherwise', () => {
  assert.equal(lastClosedWindow(local(2026, 9, 26, 9, 0)).weekKey, '2026-09-18', 'Saturday, mid-window: the week before this one');
  const mon = lastClosedWindow(local(2026, 9, 28, 9, 0));
  assert.equal(mon.weekKey, '2026-09-25'); assert.equal(mon.isOpen, false, 'already closed: passed through as is');
});

test('validateFeedback: every question, a title and a body - or a specific missing field is named', () => {
  const good = {
    answers: QUESTIONS.map((q) => ({ key: q.key, value: q.options[0] })),
    commentTitle: 'Good week', commentBody: 'Logged expenses daily, no issues.',
  };
  assert.equal(validateFeedback(good).ok, true);
  assert.equal(validateFeedback(null).ok, false);
  assert.equal(validateFeedback({ ...good, answers: [] }).ok, false);
  assert.equal(validateFeedback({ ...good, answers: [{ key: QUESTIONS[0].key, value: '   ' }] }).ok, false, 'whitespace is not an answer');
  assert.equal(validateFeedback({ ...good, commentTitle: '' }).ok, false);
  assert.equal(validateFeedback({ ...good, commentBody: '' }).ok, false);
});

test('offerCopy: the two post-Beta prices, straight from the server\'s own plan code, never guessed', () => {
  assert.deepEqual(offerCopy('pro_beta_contributor'), { label: 'Beta Contributor price', price: '₹199/yr', note: 'locked for life, thank you for your contribution' });
  assert.deepEqual(offerCopy('pro_beta_member'), { label: 'Beta Member price', price: '₹299/yr', note: 'locked for your first year' });
  assert.equal(offerCopy('pro_annual'), null);
  assert.equal(offerCopy(undefined), null);
});
