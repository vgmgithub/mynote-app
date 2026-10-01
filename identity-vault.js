// Saving the identity into a passkey on this phone, and getting it back after the browser's data was cleared or the
// app was reinstalled. The rules and shapes live in identity.js (pure, tested); this is only the call to the browser.
// Loaded on demand - nothing pays for it until somebody taps "Remember this phone" or "Recover".
import { passkeyCreateOptions, passkeyGetOptions, identityFromPasskey, vaultError, asVaultError } from './identity.js';

export function vaultSupported() {
  return !!(typeof window !== 'undefined' && window.isSecureContext && window.PublicKeyCredential
    && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
}

const randomChallenge = () => crypto.getRandomValues(new Uint8Array(32));

// Ask the phone to keep a passkey whose user handle is the identity. Needs a tap (a user gesture) and the phone's
// own prompt; saving again for the same install replaces the earlier passkey rather than adding a second.
export async function saveIdentity(installId, alias) {
  if (!vaultSupported()) throw vaultError('unsupported');
  try {
    const cred = await navigator.credentials.create({ publicKey: passkeyCreateOptions({ installId, alias, challenge: randomChallenge() }) });
    if (!cred) throw vaultError('cancelled');
    return true;
  } catch (e) { throw asVaultError(e); }
}

// Ask the phone for its MyNotes passkeys; the person picks one and its handle comes back as { installId, alias }.
export async function recoverIdentity() {
  if (!vaultSupported()) throw vaultError('unsupported');
  let cred;
  try { cred = await navigator.credentials.get({ publicKey: passkeyGetOptions({ challenge: randomChallenge() }) }); }
  catch (e) { throw asVaultError(e); }
  if (!cred) throw vaultError('cancelled');
  return identityFromPasskey(cred);
}
