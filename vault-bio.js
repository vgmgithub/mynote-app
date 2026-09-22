// vault-bio.js — opening the vault with the phone's own fingerprint sensor.
//
// WHY THIS IS NOT THE OBVIOUS THING.
//
// WebAuthn on its own only answers "is this the right person?", and the answer
// is a yes. A yes cannot decrypt anything. Gating a saved key behind one would
// mean writing the vault key to disk beside the ciphertext and guarding it
// with a boolean that any script could step over — which is not a lock, and
// would quietly undo the one promise vault.js makes.
//
// So this uses the PRF extension instead. The authenticator turns a stored
// salt into the same 32 secret bytes every time, and only ever after the
// sensor has verified the person. Those bytes wrap the vault key. What sits on
// the device is the wrapped copy: without a finger there is no secret, and
// without the secret the copy is noise. The key still is not stored.
//
// WHAT THIS DOES NOT DO.
//
// It does not recover a forgotten master password, and it is not a second way
// in that survives anything. Enrolling needs the vault already open, and the
// wrapped copy dies with the credential — a reset phone, cleared site data, a
// different device. The master password stays the only thing that always
// works, which is why the UI never offers this as a replacement for it.
//
// Not every browser has PRF (Android Chrome and iOS 18+ do; plenty do not).
// Where it is missing, enrolment refuses and the vault behaves as before.

import { DB } from './db.js';
import { encryptJson, decryptJson, keyFromSecretBytes, importRawKeyB64 } from './vault.js';

const BIO_KEY = 'vaultBio';
const TIMEOUT = 60000;

const toB64url = (b) => btoa(String.fromCharCode.apply(null, new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(s) {
  let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bioSupported() {
  return !!(typeof window !== 'undefined' && window.PublicKeyCredential
    && navigator.credentials && navigator.credentials.create);
}

// A platform authenticator exists and the browser will use it. The vault hides
// every fingerprint control when this is false rather than offering a button
// that can only fail.
export async function bioAvailable() {
  if (!bioSupported()) return false;
  try { return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
  catch (_) { return false; }
}

export async function getBioConfig() {
  const r = await DB.get('meta', BIO_KEY).catch(() => null);
  return (r && r.value) || null;
}

export async function isBioEnrolled() {
  const c = await getBioConfig();
  return !!(c && c.credentialId && c.wrapped);
}

export async function disableBio() {
  await DB.del('meta', BIO_KEY).catch(() => {});
}

// Ask the sensor for this credential's secret. Same salt, same credential,
// same 32 bytes — that stability is the whole basis of the wrap.
async function evalPrf(credentialId, saltBytes) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: saltBytes } } },
      timeout: TIMEOUT,
    },
  });
  if (!assertion) return null;
  const ext = assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
  return (ext.prf && ext.prf.results && ext.prf.results.first) || null;
}

// Bind this device's sensor to the vault key. `rawKeyB64` is an extractable
// copy derived from the master password moments earlier; the caller throws it
// away as soon as this returns.
//
// `residentKey: 'required'` is load-bearing, not tidiness. On Android the PRF
// secret comes from Google Password Manager, which only holds discoverable
// credentials — ask for a non-discoverable one and the phone hands back a
// keystore credential with no PRF at all, which is exactly how this failed the
// first time. The cost is a passkey visible in the person's list, so it is
// named for what it is.
export async function enrollBio(rawKeyB64) {
  if (!bioSupported()) throw new Error('This browser cannot use the fingerprint sensor.');
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'MyNotes' },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'My Passwords vault',
        displayName: 'My Passwords vault',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
      },
      extensions: { prf: { eval: { first: prfSalt } } },
      timeout: TIMEOUT,
    },
  });
  if (!cred) throw new Error('Setup was cancelled.');

  const credentialId = toB64url(cred.rawId);
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  // Whether PRF is reported HERE says little: plenty of browsers that support
  // it perfectly well report nothing at creation. Only asking settles it, so
  // the absence of a result is never itself the refusal.
  let secret = ext.prf && ext.prf.results && ext.prf.results.first;
  if (!secret) {
    try { secret = await evalPrf(credentialId, prfSalt); }
    catch (_) { throw new Error('The sensor was not confirmed, so nothing was turned on. Try again.'); }
  }
  if (!secret) throw new Error('This device would not give a key to lock the vault with, so fingerprint unlock cannot be turned on here. Your master password still works.');

  const wrapped = await encryptJson(await keyFromSecretBytes(secret), rawKeyB64);
  await DB.put('meta', {
    key: BIO_KEY,
    value: { credentialId, prfSalt: toB64url(prfSalt), wrapped, at: new Date().toISOString() },
  });
}

// The vault key, or null. A refusal is not an error worth throwing: the
// password field is right there, and a thrown one would only get in its way.
export async function unlockWithBio() {
  const cfg = await getBioConfig();
  if (!cfg || !cfg.credentialId || !cfg.wrapped) return null;
  let secret = null;
  try { secret = await evalPrf(cfg.credentialId, fromB64url(cfg.prfSalt)); } catch (_) { return null; }
  if (!secret) return null;
  const rawB64 = await decryptJson(await keyFromSecretBytes(secret), cfg.wrapped);
  if (typeof rawB64 !== 'string' || !rawB64) return null;
  try { return await importRawKeyB64(rawB64); } catch (_) { return null; }
}
