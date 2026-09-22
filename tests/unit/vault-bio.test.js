import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  randomSaltB64, deriveKey, deriveKeyExtractable, exportRawKeyB64, importRawKeyB64,
  keyFromSecretBytes, encryptJson, decryptJson, makeVerifier, checkVerifier,
} from '../../vault.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const secret = () => crypto.getRandomValues(new Uint8Array(32));

test('a fingerprint-wrapped key opens exactly what the typed password opens', async () => {
  const salt = randomSaltB64();
  const typed = await deriveKey('correct horse battery', salt);
  const box = await encryptJson(typed, { pw: 'hunter2' });

  // Enrolment: an extractable copy, wrapped with the 32 bytes the sensor returns.
  const raw = await exportRawKeyB64(await deriveKeyExtractable('correct horse battery', salt));
  const s = secret();
  const wrapped = await encryptJson(await keyFromSecretBytes(s), raw);

  // Unlock: same secret back from the sensor, same key out.
  const back = await importRawKeyB64(await decryptJson(await keyFromSecretBytes(s), wrapped));
  assert.deepEqual(await decryptJson(back, box), { pw: 'hunter2' });
  assert.equal(await checkVerifier(back, await makeVerifier(typed)), true);
});

test('the wrapped copy is useless to anyone who does not have the sensor', async () => {
  const salt = randomSaltB64();
  const raw = await exportRawKeyB64(await deriveKeyExtractable('pw', salt));
  const wrapped = await encryptJson(await keyFromSecretBytes(secret()), raw);
  // A different finger, a different device, a guess: all the same answer.
  assert.equal(await decryptJson(await keyFromSecretBytes(secret()), wrapped), null);
  assert.equal(JSON.stringify(wrapped).includes(raw), false, 'the key is not sitting in the blob');
});

test('the key handed to the vault cannot be read back out, however it was obtained', async () => {
  const salt = randomSaltB64();
  const raw = await exportRawKeyB64(await deriveKeyExtractable('pw', salt));
  for (const k of [await deriveKey('pw', salt), await importRawKeyB64(raw)]) {
    assert.equal(k.extractable, false);
    await assert.rejects(() => crypto.subtle.exportKey('raw', k));
  }
  // The one extractable copy exists only to be wrapped, and only at enrolment.
  assert.equal((await deriveKeyExtractable('pw', salt)).extractable, true);
});

test('a wrong master password cannot enrol a sensor', async () => {
  const salt = randomSaltB64();
  const verify = await makeVerifier(await deriveKey('right', salt));
  assert.equal(await checkVerifier(await deriveKey('wrong', salt), verify), false);
});

test('fingerprint unlock is wired up without weakening the password path', () => {
  const bio = read('vault-bio.js'), ui = read('vault-ui.js'), sw = read('service-worker.js');
  // PRF is the whole point: a plain WebAuthn yes/no would mean storing the key.
  assert.match(bio, /prf: \{ eval: \{ first:/, 'the credential is asked for a PRF secret');
  assert.match(bio, /userVerification: 'required'/, 'the sensor must verify the person');
  assert.match(bio, /authenticatorAttachment: 'platform'/, 'this device only, no roaming key');
  assert.equal(/localStorage|sessionStorage/.test(bio), false, 'nothing key-shaped goes to web storage');
  // Android's PRF secret comes from Google Password Manager, which only holds
  // discoverable credentials; asking for a non-discoverable one gets a keystore
  // credential with no PRF, and enrolment fails on every Android phone.
  assert.match(bio, /residentKey: 'required'/, 'a discoverable credential, or Android has no PRF');
  // Enrolment refuses rather than falling back to something weaker, but it
  // decides that by asking the sensor, not by what creation happened to report.
  assert.match(bio, /if \(!secret\) throw/, 'no secret means no enrolment');
  assert.equal(/if \(!ext\.prf\) throw/.test(bio), false, 'a quiet creation is not a refusal');
  assert.match(bio, /if \(!secret\) return null/, 'no secret means no unlock');
  // The vault still checks the password the same way, and still offers the field.
  assert.match(ui, /checkVerifier\(check, meta\.verify\)/, 'enrolling re-checks the master password');
  assert.match(ui, /or type your master password/, 'the password is always still offered');
  assert.match(ui, /import\('\.\/vault-bio\.js'\)/);
  assert.match(sw, /'\.\/vault-bio\.js'/, 'the module is cached for offline use');
});

test('the device-bound key never travels: not in a backup, and gone on a wipe', () => {
  const app = read('app.js'), lock = read('lock.js');
  const backed = app.match(/const BACKED_UP_STORES = \[([\s\S]*?)\];/)[1];
  assert.equal(backed.includes("'meta'"), false, 'meta holds the wrapped key and is not backed up');
  assert.match(lock.match(/const stores = \[([\s\S]*?)\];/)[1], /'meta'/, 'a wipe clears meta');
});
