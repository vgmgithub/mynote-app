import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { returnMoM } from '../../core.js';

test('returnMoM: the change in RETURN month over month, with its % against last month\'s return', () => {
  // The owner's own example: last month's return 10,000, this month's 11,000 -> +1,000 and +10%.
  assert.deepEqual(returnMoM({ profitLoss: 11000 }, { profitLoss: 10000 }), { diff: 1000, pct: 10 });
  assert.deepEqual(returnMoM({ profitLoss: 9000 }, { profitLoss: 10000 }), { diff: -1000, pct: -10 });
  // A loss shrinking is a positive move, measured against the size of last month's loss.
  assert.deepEqual(returnMoM({ profitLoss: -500 }, { profitLoss: -1000 }), { diff: 500, pct: 50 });
  // Last month's return was 0: the change is real, but there is nothing to take a % of.
  assert.deepEqual(returnMoM({ profitLoss: 200 }, { profitLoss: 0 }), { diff: 200, pct: null });
  // Money newly invested is not a return: value may jump, but with the same return the MoM is 0.
  assert.deepEqual(returnMoM({ value: 150000, invested: 140000, profitLoss: 10000 }, { value: 110000, invested: 100000, profitLoss: 10000 }), { diff: 0, pct: 0 });
  assert.equal(returnMoM({ profitLoss: 100 }, null), null, 'first month: nothing to compare with');
  assert.equal(returnMoM({ profitLoss: null }, { profitLoss: 100 }), null);
  assert.equal(returnMoM({ profitLoss: 100 }, { profitLoss: 'x' }), null);
});

test('the Months list and the insights both use returnMoM, and Add month sits on the title line', () => {
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  assert.match(app, /const r = returnMoM\(months\[i\], months\[i - 1\]\);/, 'insights (best / toughest / win rate / latest)');
  assert.match(app, /const r = prev \? returnMoM\(m, prev\) : null;/, 'each month card');
  assert.match(app, /el\('div', \{ class: 'snap-list-head' \}, \[\s*el\('h3', \{ text: 'Months' \}\),\s*el\('button', \{ class: 'btn ghost small', text: '\+ Add month'/);
  const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.snap-list-head \{ display: flex; align-items: center; justify-content: space-between;/);
});
