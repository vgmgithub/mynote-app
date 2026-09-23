import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteText, whatsappUrl, INVITE_URL } from '../../share.js';
import { PRODUCTION_HOSTS } from '../../config.js';

test('the invite always links to the live app, never a test copy', () => {
  assert.equal(INVITE_URL, 'https://' + PRODUCTION_HOSTS[0]);
  assert.doesNotMatch(inviteText(), /vercel\.app|localhost/);
  assert.ok(inviteText().includes(INVITE_URL));
});

test('the invite says only what is true today', () => {
  const t = inviteText();
  // Things the app really does: records on the phone, no account, no ads, offline, five features free.
  for (const claim of [/stay on your phone/, /No account/, /no ads/, /works offline/, /5 features are free/]) assert.match(t, claim);
  // Things it must not claim: "nothing is ever sent" (usage counts are), any price, or that Pro can be bought.
  assert.doesNotMatch(t, /never sent|nothing (is )?sent|\u20b9|\bPro\b|subscription|guarantee|advice/i);
});

test('the WhatsApp link carries the whole message, encoded, and no phone number', () => {
  const u = whatsappUrl();
  assert.ok(u.startsWith('https://wa.me/?text='), 'no number: the person chooses who to send it to');
  assert.equal(decodeURIComponent(u.slice('https://wa.me/?text='.length)), inviteText());
  assert.ok(!/wa\.me\/\d/.test(u));
});

test('the menu offers it, with the icon file in the offline cache', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8');
  assert.match(app, /Invite friends on WhatsApp/);
  assert.match(sw, /icons\/whatsapp\.svg/);
  assert.match(sw, /\.\/share\.js/);
});

test('the picture is shared with the message as its caption, and falls back to the WhatsApp link', async () => {
  const { shareInvite, INVITE_IMAGE } = await import('../../share.js');
  const { existsSync, readFileSync } = await import('node:fs');
  assert.ok(existsSync(new URL('../../' + INVITE_IMAGE, import.meta.url)), 'the picture ships with the app');
  assert.match(readFileSync(new URL('../../service-worker.js', import.meta.url), 'utf8'), /icons\/invite-card\.jpg/, 'and is cached for offline');
  const file = { name: 'x.jpg' };
  let sent = null, opened = null;
  const nav = { canShare: () => true, share: async (d) => { sent = d; } };
  assert.equal(await shareInvite({ nav, getFile: async () => file, open: (u) => { opened = u; } }), 'shared');
  assert.deepEqual(sent.files, [file]);
  assert.equal(sent.text, inviteText(), 'the link travels in the text');
  assert.equal(sent.url, undefined, 'no separate url: WhatsApp drops it when a file is attached');
  assert.equal(opened, null);
  const noFiles = { canShare: () => false, share: async () => {} };
  assert.equal(await shareInvite({ nav: noFiles, getFile: async () => file, open: (u) => { opened = u; } }), 'whatsapp');
  assert.equal(opened, whatsappUrl());
  const cancel = { canShare: () => true, share: async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; } };
  opened = null;
  assert.equal(await shareInvite({ nav: cancel, getFile: async () => file, open: (u) => { opened = u; } }), 'cancelled');
  assert.equal(opened, null, 'closing the sheet opens nothing else');
});
