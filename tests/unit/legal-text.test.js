import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRIVACY, TERMS, LEGAL_UPDATED, LEGAL_CONTACT, renderLegal } from '../../legal-text.js';

const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const titles = (doc) => doc.map((s) => s[0]);
const allText = (doc) => doc.flatMap((s) => s[1]);

test('both documents exist and keep every required section (guards against a bad edit deleting one)', () => {
  assert.ok(Array.isArray(PRIVACY) && Array.isArray(TERMS), 'PRIVACY and TERMS are exported arrays');
  for (const t of ['The short version', 'What is stored, and where', 'What leaves your device (only when you use these features)',
    'Usage information', 'What we do not do', 'Your control', 'Age', 'Changes and contact']) {
    assert.ok(titles(PRIVACY).includes(t), 'Privacy is missing: ' + t);
  }
  for (const t of ['Not financial advice', 'Accuracy of numbers', 'Your data and backups', 'Acceptable use', 'Plans and pricing',
    'Usage information', 'Third-party services and changes', 'Governing law']) {
    assert.ok(titles(TERMS).includes(t), 'Terms is missing: ' + t);
  }
});

test('no duplicate section titles and no empty or non-string items', () => {
  for (const doc of [PRIVACY, TERMS]) {
    assert.equal(new Set(titles(doc)).size, doc.length, 'duplicate section title');
    for (const [h, items] of doc) {
      assert.ok(typeof h === 'string' && h.length > 0);
      assert.ok(Array.isArray(items) && items.length > 0, h + ' has no items');
      for (const it of items) assert.ok(typeof it === 'string' && it.trim().length > 20, 'bad item in ' + h);
    }
  }
});

test('the version date and contact are present', () => {
  assert.match(LEGAL_UPDATED, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  assert.match(LEGAL_CONTACT, /@/);
});

test('renderLegal produces content for both documents through the app element helper', () => {
  const el = (tag, attrs = {}, kids = []) => ({ tag, attrs, kids });
  for (const which of ['privacy', 'terms']) {
    const nodes = renderLegal(el, which);
    assert.ok(nodes.length > 10, which + ' rendered too little');
    assert.equal(nodes[0].tag, 'h2');
    assert.equal(nodes[0].attrs.text, which === 'terms' ? 'Terms of Use' : 'Privacy Policy');
  }
});

test('key promises stay in the text', () => {
  const priv = allText(PRIVACY).join('\n');
  const terms = allText(TERMS).join('\n');
  assert.match(priv, /Not active yet/);
  assert.match(priv, /never uploaded/);
  assert.match(priv, /We will not store your IP address/);
  assert.match(priv, /18 and over/);
  assert.match(terms, /You must be 18 or over/);
  assert.match(terms, /not registered with SEBI/);
});

test('every menu item or button the text tells the user to use exists in the app', () => {
  const text = [...allText(PRIVACY), ...allText(TERMS)].join('\n');
  const mustExist = [
    ['Turn off anonymous usage counts', /Turn off anonymous usage counts/],
    ['Remove my age group and gender', /Remove my age group and gender/],
    ['Help improve MyNotes', /Help improve MyNotes/],
    ['Privacy & Terms', /Privacy & Terms/],
    ['Clear all data', /Clear all data/],
    ['Backup & Restore', /Backup & Restore/],
  ];
  for (const [label, re] of mustExist) {
    if (text.includes(label)) assert.ok(re.test(app), '"' + label + '" is in the legal text but not in app.js');
  }
  assert.ok(text.includes('Turn off anonymous usage counts') && text.includes('Remove my age group and gender'), 'text must still mention both controls');
});
