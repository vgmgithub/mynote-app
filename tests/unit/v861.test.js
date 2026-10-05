import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { read } from './src.js';

test('house form: milk and fruits are both offered for the five shops', () => {
  const s = read('expense-ui.js');
  assert.match(s, /MILK_SPLIT_FROM = \['Online Grocery', 'Flipkart Grocery', 'Amazon Grocery', 'Local Shop', 'Brigade'\]/);
  assert.match(s, /SPLIT_PARTS = \['Milk', 'Fruits'\]/);
  assert.match(s, /rec\.amount = round2\(amt - splitSum\)/);
});

test('spend form: the For others explanation sits behind an i button', () => {
  const s = read('personal-ui.js');
  assert.match(s, /openInfoSheet\('For others'/);
  assert.ok(!/class: 'hint', style: 'margin:6px 0 0',\s*text: 'Money spent for somebody/.test(s));
});

test('medicines: one When badge, no Household tag, captions under the form icons', () => {
  const s = read('medicine-ui.js'), c = read('styles.css');
  assert.match(s, /const whenBadge = /);
  assert.match(s, /who \? el\('span', \{ class: 'med-tag is-who', text: who \}\) : null/);
  assert.match(s, /medf-ib-cap/);
  assert.match(c, /html\[data-theme="light"\] \.med-when-badge \{ background: #dbeafe/);
});

test('emergency loans: type fixed after creation, confirm on create, tabs below Type, due-by-month popup', async () => {
  const s = read('ef.js');
  assert.match(s, /typeBlock,\s*\n\s*el\('div', \{ class: 'seg' \}, \[detailsTabBtn, repayTabBtn\]\)/);
  assert.match(s, /const typeBlock = isEdit/);
  assert.match(s, /if \(!isEdit\) \{\s*\n\s*const kindName/);
  assert.match(s, /onclick: \(\) => openEfDueSheet\(c, mod\)/);
  const a = s.indexOf('export function efDueByMonth'), b = s.indexOf('function openEfDueSheet');
  const efDueByMonth = new Function('round2', s.slice(a, b).replace('export ', '') + '; return efDueByMonth;')((x) => Math.round(x * 100) / 100);
  {
    const loans = [
      { isClosed: false, rec: { who: 'A', purpose: 'x', schedule: [{ date: '2026-10-01', amount: 500, paid: false }, { date: '2026-11-01', amount: 500, paid: false }, { date: '2026-09-01', amount: 9, paid: true }] } },
      { isClosed: false, rec: { who: 'B', purpose: 'y', plan: [{ ym: '2026-10', amount: 300 }], repayments: [{ date: '2026-10-05', amount: 100 }] } },
      { isClosed: false, rec: { who: 'E', loanKind: 'emergency', schedule: [{ date: '2026-10-01', amount: 77, paid: false }] } },
      { isClosed: true, rec: { who: 'C', schedule: [{ date: '2026-10-01', amount: 999, paid: false }] } },
    ];
    const out = efDueByMonth(loans, '2026-10');
    assert.deepEqual(out.map((m) => [m.ym, m.total]), [['2026-10', 700], ['2026-11', 500]]);
    assert.equal(out[0].loans.length, 2);
  }
});
