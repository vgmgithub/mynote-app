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
