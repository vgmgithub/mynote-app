// The identity a backup carries: the random install id and the anonymous name the server holds for it.
//
// Why: the server keys everything about an install on its id - the anonymous name, the plan, Beta membership,
// payments - so "the same user" on a second phone means "the same install id". Until now the id stayed on the phone
// it was made on (a backup left it behind), so a backup restored onto another phone, or onto the same phone after
// its browser data was cleared, started a NEW install with a NEW name. Now the backup carries the id and the name,
// and a restore continues as the same install: same name, same plan, one record to look at.
//
// Pure: no storage, no DOM. db.js reads and writes the meta rows; this file only decides.

// The meta row a backup carries it in: { key: 'identity', value: { installId, alias } }. Older apps simply keep an
// unknown meta row, and a backup without one (made before this) is handled below.
export const IDENTITY_KEY = 'identity';

const INSTALL_ID_RE = /^[0-9a-f-]{32,36}$/;       // what the server accepts as an install id
const ALIAS_RE = /^[A-Za-z]{4,12}$/;              // as alias.js builds a name

export const isInstallId = (s) => typeof s === 'string' && INSTALL_ID_RE.test(s);
export const isAliasName = (s) => typeof s === 'string' && ALIAS_RE.test(s);

// A usable identity needs a real install id; the name may be missing (it is settled on the first send).
export function validIdentity(v) {
  return !!v && typeof v === 'object' && isInstallId(v.installId) && (v.alias == null || v.alias === '' || isAliasName(v.alias));
}

// The meta row to put in a backup, or null while this install has no id yet (it has never reported anything).
export function identityRow(installId, alias) {
  if (!isInstallId(installId)) return null;
  return { key: IDENTITY_KEY, value: { installId, alias: isAliasName(alias) ? alias : '' } };
}

// Which identity the device carries once a backup has been restored onto it.
//   - The backup carries one and the device has none, or the same one: take the backup's. This is the case the
//     feature is for - a new phone, or the same phone after its site data was cleared.
//   - The backup carries a different one and the device already has its own: take the backup's too, because the
//     person chose to continue as the backup's owner - unless the device's holds a Pro or Beta plan, which a restore
//     must never swap for another install's (and so quietly downgrade).
//   - The backup carries none (an older backup, which holds a name but no id to take): the device stays the install it
//     is, but the person keeps THEIR name - the backup's name replaces the device's, and `lockAlias` stops the
//     server's answer (it knows this id under another name) from renaming it again. Not for a device holding a plan:
//     that install's name is the one the server and its support records know it by.
// `ownHasPlan`: the device's cached plan is paid or beta. `backupAlias`: the name row an older backup carries.
export function chooseIdentity({ backup, backupAlias, ownInstallId, ownAlias, ownHasPlan }) {
  const own = isInstallId(ownInstallId) ? ownInstallId : '';
  const ownName = isAliasName(ownAlias) ? ownAlias : '';
  const oldName = isAliasName(backupAlias) ? backupAlias : '';
  if (!validIdentity(backup)) {
    if (oldName && !ownHasPlan) return { use: 'own', installId: own, alias: oldName, lockAlias: oldName !== ownName || !own };
    return { use: 'own', installId: own, alias: ownName || oldName, lockAlias: false };
  }
  if (own && own !== backup.installId && ownHasPlan) return { use: 'own', installId: own, alias: ownName, lockAlias: false };
  return {
    use: 'backup',
    installId: backup.installId,
    // The id moves, so the cached plan of whatever id was here belongs to the wrong install now.
    dropPlan: !!own && own !== backup.installId,
    alias: isAliasName(backup.alias) ? backup.alias : (own === backup.installId ? ownName : ''),
    lockAlias: false,
  };
}

// ---------- The phone's own memory: a passkey that holds the identity ----------
// Clearing a browser's site data, or reinstalling the app, wipes everything the page stored - there is nothing left
// for a page to recognise a phone by (browsers withhold any device id on purpose). What a phone does keep is its
// passkeys, held by the OS / Google Password Manager / iCloud Keychain, outside the page's storage. So the identity
// can be saved INTO a passkey: a "discoverable credential" whose user handle IS the identity. After a wipe the
// welcome screen asks the phone for its MyNotes passkey and gets the install id (and the name) straight back; the
// server then supplies the plan, as it does for any install id. Nothing is sent anywhere; the passkey is never
// registered with a server (its signature is never checked) - it is used purely as a safe place the OS keeps.
//
// The user handle, at most 64 bytes: 'MN1|' + install id + '|' + name, e.g. "MN1|4dcd6fca-...-ab|Meharika".
const HANDLE_RE = /^MN1\|([0-9a-f-]{32,36})\|([A-Za-z]{0,12})$/;

export function encodeIdentityHandle(installId, alias) {
  if (!isInstallId(installId)) return null;
  return new TextEncoder().encode('MN1|' + installId + '|' + (isAliasName(alias) ? alias : ''));
}

// bytes: an ArrayBuffer or typed array, as a passkey returns it. null for anything that is not ours.
export function decodeIdentityHandle(bytes) {
  try {
    if (!bytes) return null;
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
    const m = HANDLE_RE.exec(new TextDecoder().decode(view));
    if (!m || !isInstallId(m[1])) return null;
    return { installId: m[1], alias: isAliasName(m[2]) ? m[2] : '' };
  } catch (_) { return null; }
}

// What to ask the phone to create. `residentKey: required` makes it discoverable (it can be found again with no
// credential id, which is exactly what is lost in a wipe). The name on the passkey is the @name, so it is the one to pick.
export function passkeyCreateOptions({ installId, alias, challenge }) {
  const handle = encodeIdentityHandle(installId, alias);
  if (!handle) throw new Error('no identity to save');
  const label = isAliasName(alias) ? '@' + alias : 'MyNotes';
  return {
    challenge,
    rp: { name: 'MyNotes' },
    user: { id: handle, name: label, displayName: 'MyNotes ' + label },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    attestation: 'none',
    timeout: 60000,
  };
}

// No allowCredentials: the phone lists whichever MyNotes passkeys it holds and the person picks one.
export function passkeyGetOptions({ challenge }) {
  return { challenge, userVerification: 'preferred', timeout: 60000 };
}

// A passkey operation fails for a handful of reasons the person can act on.
//   unsupported  this browser / device cannot do it
//   cancelled    they dismissed it - or the phone holds no MyNotes passkey (browsers do not say which)
//   foreign      they picked a passkey that is not a MyNotes identity
//   failed       anything else
export function vaultError(code, detail) {
  return Object.assign(new Error(detail || code), { code });
}
export function asVaultError(e) {
  if (e && e.code && ['unsupported', 'cancelled', 'foreign', 'failed'].includes(e.code)) return e;
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'AbortError') return vaultError('cancelled', n);
  if (n === 'NotSupportedError' || n === 'SecurityError') return vaultError('unsupported', n);
  return vaultError('failed', (e && e.message) || String(e));
}
export function vaultMessage(e) {
  switch (e && e.code) {
    case 'unsupported': return 'This browser cannot save or read a passkey. Use a backup instead (Menu → Backup & Restore).';
    case 'cancelled': return 'Nothing was recovered. You cancelled, or this phone has no MyNotes passkey yet.';
    case 'foreign': return 'That passkey is not a MyNotes name. Choose the one that shows your @name.';
    default: return 'Could not use the passkey' + (e && e.message ? ': ' + e.message : '.');
  }
}

// The identity a passkey returned, or a 'foreign' error.
export function identityFromPasskey(credential) {
  const handle = credential && credential.response && credential.response.userHandle;
  const id = decodeIdentityHandle(handle);
  if (!id) throw vaultError('foreign');
  return id;
}
