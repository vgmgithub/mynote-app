import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortCardsByCycle } from '../../credit.js';
import { read } from './src.js';

test('cards are ordered by the day their billing cycle opens; no cycle last, then by name', () => {
  const names = sortCardsByCycle([{ name: 'Z', cycleStartDay: 20 }, { name: 'None' }, { name: 'B', cycleStartDay: 5 }, { name: 'A', cycleStartDay: 5 }, { name: 'M', cycleStartDay: 12 }]).map((c) => c.name);
  assert.deepEqual(names, ['A', 'B', 'M', 'Z', 'None']);
});

test('card form: Months tab comes first, Details second; a new card still opens on Details', () => {
  const s = read('cards-ui.js');
  assert.match(s, /const tabs = \[\{ btn: monthsTabBtn, content: monthsContent \}, \{ btn: detailsTabBtn, content: detailsContent \}\]/);
  assert.match(s, /el\('div', \{ class: 'seg' \}, \[monthsTabBtn, detailsTabBtn\]\)/);
  assert.match(s, /class: isEdit \? 'active' : '', type: 'button', text: 'Months'/);
});

test('Card Check: a card opens its bill entries, house and personal marked, each editable and refreshed on save', () => {
  const s = read('personal-review.js');
  assert.match(s, /onclick: \(\) => openCardEntries\(c, ym, mod, houseRows, pRows, rerender\)/);
  assert.match(s, /x\.kind === 'house' \? 'House' : 'Personal'/);
  assert.match(s, /openSpendForm\(0, x\.r, null, opts\); else openPfSpendForm\(x\.r, null, opts\)/);
  assert.match(read('spend-form.js'), /if \(opts\.onSaved\) opts\.onSaved\(\);/);
  assert.match(read('personal-ui.js'), /if \(opts\.onSaved\) opts\.onSaved\(\);/);
});
