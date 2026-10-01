import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDENTITY_KEY, isInstallId, isAliasName, validIdentity, identityRow, chooseIdentity } from '../../identity.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
const P1 = '4dcd6fca-1234-4abc-9def-0123456789ab';      // the install the backup was made on
const P2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';      // the phone it is restored onto
const A = 'Meharika';

test('an identity is a real install id plus, optionally, a one-word name; the backup row is only made when there is an id', () => {
  assert.equal(IDENTITY_KEY, 'identity');
  assert.ok(isInstallId(P1) && !isInstallId('abcd1234') && !isInstallId('') && !isInstallId(null), 'the same shape the server accepts');
  assert.ok(isAliasName('Meharika') && !isAliasName('ab') && !isAliasName('Two Words') && !isAliasName(null));
  assert.ok(validIdentity({ installId: P1, alias: A }) && validIdentity({ installId: P1, alias: '' }) && validIdentity({ installId: P1 }));
  assert.equal(validIdentity({ installId: 'nope', alias: A }), false);
  assert.equal(validIdentity({ installId: P1, alias: 'x y z' }), false, 'a malformed name makes the whole identity unusable');
  assert.equal(validIdentity(null), false);
  assert.deepEqual(identityRow(P1, A), { key: 'identity', value: { installId: P1, alias: A } });
  assert.deepEqual(identityRow(P1, 'bad name'), { key: 'identity', value: { installId: P1, alias: '' } }, 'a bad name is left out, the id still travels');
  assert.equal(identityRow('', A), null, 'an install that has never reported has nothing to carry');
});

test('restoring onto another phone (or this one after its site data was cleared) continues as the backup\'s install: same id, same name', () => {
  // A blank phone: no id, no name.
  const blank = chooseIdentity({ backup: { installId: P1, alias: A }, ownInstallId: '', ownAlias: '', ownHasPlan: false });
  assert.deepEqual(blank, { use: 'backup', installId: P1, dropPlan: false, alias: A, lockAlias: false });
  // The same install restored over itself: nothing moves, and its plan cache is kept.
  const same = chooseIdentity({ backup: { installId: P1, alias: A }, ownInstallId: P1, ownAlias: A, ownHasPlan: true });
  assert.deepEqual(same, { use: 'backup', installId: P1, dropPlan: false, alias: A, lockAlias: false });
  // A phone that had set itself up as a fresh install first: it takes the backup's identity, and its cached plan
  // belonged to the install it leaves.
  const fresh = chooseIdentity({ backup: { installId: P1, alias: A }, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false });
  assert.deepEqual(fresh, { use: 'backup', installId: P1, dropPlan: true, alias: A, lockAlias: false });
});

test('a restore never swaps a Pro or Beta install for another', () => {
  const paid = chooseIdentity({ backup: { installId: P1, alias: A }, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: true });
  assert.deepEqual(paid, { use: 'own', installId: P2, alias: 'Zanora', lockAlias: false }, 'a paid install is never silently downgraded');
  const junk = chooseIdentity({ backup: { installId: 'not-an-id', alias: A }, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false });
  assert.equal(junk.use, 'own', 'an unusable identity in a backup is ignored');
  // A backup identity with no name yet falls back to the device\'s name only when it is the same install.
  assert.equal(chooseIdentity({ backup: { installId: P1, alias: '' }, ownInstallId: P1, ownAlias: A, ownHasPlan: false }).alias, A);
  assert.equal(chooseIdentity({ backup: { installId: P1, alias: '' }, ownInstallId: P2, ownAlias: A, ownHasPlan: false }).alias, '', 'another install\'s name is not borrowed');
});

test('a backup made before identities travelled still keeps the person\'s name: it replaces the device\'s and is locked against the server renaming it', () => {
  // A phone that set itself up first (id P2, name Zanora), then restored an older backup that holds the name Meharika.
  const established = chooseIdentity({ backup: undefined, backupAlias: A, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false });
  assert.deepEqual(established, { use: 'own', installId: P2, alias: A, lockAlias: true }, 'the device stays the install it is; the person keeps their name');
  // A blank phone: no id yet, so the server will meet a new id proposing a name it gave to an older install.
  const blank = chooseIdentity({ backup: undefined, backupAlias: A, ownInstallId: '', ownAlias: '', ownHasPlan: false });
  assert.deepEqual(blank, { use: 'own', installId: '', alias: A, lockAlias: true });
  // Nothing to change when the names already agree.
  const same = chooseIdentity({ backup: undefined, backupAlias: A, ownInstallId: P2, ownAlias: A, ownHasPlan: false });
  assert.deepEqual(same, { use: 'own', installId: P2, alias: A, lockAlias: false });
  // A Pro / Beta install keeps the name its server and support records know it by.
  const paid = chooseIdentity({ backup: undefined, backupAlias: A, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: true });
  assert.deepEqual(paid, { use: 'own', installId: P2, alias: 'Zanora', lockAlias: false });
  // No name anywhere in the backup: the device\'s own stands.
  assert.deepEqual(chooseIdentity({ backup: undefined, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false }), { use: 'own', installId: P2, alias: 'Zanora', lockAlias: false });
  assert.deepEqual(chooseIdentity({ backup: undefined, ownInstallId: '', ownAlias: '', ownHasPlan: false }), { use: 'own', installId: '', alias: '', lockAlias: false });
  assert.equal(chooseIdentity({ backup: undefined, backupAlias: 'x y', ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false }).alias, 'Zanora', 'a malformed name is ignored');
  const junk = chooseIdentity({ backup: { installId: 'not-an-id', alias: A }, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false });
  assert.equal(junk.use, 'own', 'an unusable identity in a backup is ignored');
  // A backup identity with no name yet falls back to the device\'s name only when it is the same install.
  assert.equal(chooseIdentity({ backup: { installId: P1, alias: '' }, ownInstallId: P1, ownAlias: A, ownHasPlan: false }).alias, A);
  assert.equal(chooseIdentity({ backup: { installId: P1, alias: '' }, ownInstallId: P2, ownAlias: A, ownHasPlan: false }).alias, '', 'another install\'s name is not borrowed');
});

test('db.js: a backup carries the identity, a restore applies it, and the raw install id still never travels as its own row', () => {
  const db = read('db.js');
  assert.match(db, /import \{ IDENTITY_KEY, identityRow, chooseIdentity, isAliasName \} from '\.\/identity\.js';/);
  assert.match(db, /const DEVICE_ONLY_META = \[[^\]]*'installId'[^\]]*\]/, 'installId is still device-only as a meta row');
  assert.match(db, /meta: \(\(\) => \{[\s\S]{0,700}identityRow\(own && own\.value, al && al\.value\);[\s\S]{0,120}\}\)\(\),/);
  assert.match(db, /const ownAliasRow = await this\.get\('meta', 'alias'\)/, 'the device\'s own name is read before the meta store is cleared');
  assert.match(db, /const pick = chooseIdentity\(\{/);
  assert.match(db, /m\.key === IDENTITY_KEY \|\| m\.key === 'alias'\) return;/, 'the identity row and the raw name row are applied through the choice, not copied blindly');
  assert.match(db, /if \(pick\.use === 'backup' && \(r\.key === 'installId' \|\| \(pick\.dropPlan && r\.key === 'plan'\)\)\) return;/, 'the old id and its cached plan are left behind');
  assert.match(db, /if \(pick\.use === 'backup'\) tasks\.push\(this\.put\('meta', \{ key: 'installId', value: pick\.installId \}\)\);/);
  assert.match(db, /if \(nameOut\) tasks\.push\(this\.put\('meta', \{ key: 'alias', value: nameOut \}\)\);/);
});

test('the app: the confirmation says the backup carries the name, the name\'s own explanation says it is saved in backups, identity.js is cached', () => {
  const app = read('app.js'), sw = read('service-worker.js');
  assert.match(app, /export function restoreIdentityNote\(data\)/);
  assert.equal((app.match(/restoreIdentityNote\(data\)/g) || []).length, 4, 'defined once and used by all three restore confirmations');
  assert.match(app, /so this phone keeps it\./);
  assert.match(app, /It is saved in your backups, so a new phone you restore a backup onto keeps this name\./);
  assert.match(sw, /'\.\/identity\.js',/);
  // The wipe still keeps the install's own identity.
  assert.match(read('lock.js'), /DB\.get\('meta', 'installId'\)/);
});

test('the name does not change by itself: the lock, a safe ensureAlias, and a restore option on the welcome screen', () => {
  const app = read('app.js'), db = read('db.js'), lock = read('lock.js'), fp = read('feature-picker.js');
  // The server\'s answer cannot rename a locked name.
  const setAlias = app.slice(app.indexOf('export async function setAlias'), app.indexOf('export async function ensureAlias'));
  assert.match(setAlias, /DB\.get\('meta', 'aliasLocked'\)/);
  assert.match(setAlias, /if \(lock && lock\.value === true\) return;/);
  assert.ok(setAlias.indexOf('aliasLocked') < setAlias.indexOf("DB.put('meta', { key: 'alias'"), 'checked before anything is written');
  // A failed read never becomes a brand-new name.
  const ensure = app.slice(app.indexOf('export async function ensureAlias'), app.indexOf('export async function getInstallId'));
  assert.match(ensure, /try \{ rec = await DB\.get\('meta', 'alias'\); \} catch \(_\) \{ return ''; \}/);
  assert.ok(ensure.indexOf("return '';") < ensure.indexOf('makeAlias('), 'the read is settled before a name is made');
  // An older backup\'s name is locked in, and erasing the data keeps the lock.
  assert.match(db, /backupAlias: backupAliasRow && backupAliasRow\.value,/);
  assert.match(db, /if \(pick\.lockAlias\) tasks\.push\(this\.put\('meta', \{ key: 'aliasLocked', value: true \}\)\);/);
  assert.match(lock, /DB\.get\('meta', 'aliasLocked'\)/);
  assert.match(lock, /if \(aliasLocked\) keep\.push\(aliasLocked\);/);
  // The welcome screen offers the restore, so a new phone brings its data and name back BEFORE it registers an identity.
  assert.match(app, /export async function restoreFromOutsideFile\(\)/);
  assert.match(fp, /import \{ restoreFromOutsideFile, /);
  assert.match(fp, /text: 'Already have a MyNotes backup\? Restore it', onclick: \(\) => restoreFromOutsideFile\(\)/);
  const welcome = fp.slice(fp.indexOf("el('button', { class: 'btn primary', type: 'button', text: 'Get started'"));
  assert.ok(welcome.indexOf("text: 'Already have a MyNotes backup?") > 0 && welcome.indexOf("text: 'Already have a MyNotes backup?") < welcome.indexOf("class: 'legal-consent'"), 'right under Get started');
});

// ---------- the phone's own memory: the identity in a passkey ----------
import { encodeIdentityHandle, decodeIdentityHandle, passkeyCreateOptions, passkeyGetOptions, asVaultError, vaultError, vaultMessage, identityFromPasskey } from '../../identity.js';

test('the passkey\'s user handle carries the identity and nothing else, and only our own handles are read back', () => {
  const bytes = encodeIdentityHandle(P1, A);
  assert.ok(bytes instanceof Uint8Array && bytes.length <= 64, 'within the 64 bytes a passkey allows: ' + bytes.length);
  assert.equal(new TextDecoder().decode(bytes), 'MN1|' + P1 + '|' + A);
  assert.deepEqual(decodeIdentityHandle(bytes), { installId: P1, alias: A });
  assert.deepEqual(decodeIdentityHandle(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), { installId: P1, alias: A }, 'as the ArrayBuffer a browser returns');
  assert.deepEqual(decodeIdentityHandle(encodeIdentityHandle(P1, '')), { installId: P1, alias: '' }, 'the name is optional');
  assert.equal(encodeIdentityHandle('nope', A), null, 'no real install id, nothing to save');
  // The longest identity still fits: a 36-character id and a 12-letter name.
  assert.ok(encodeIdentityHandle(P1, 'Abcdefghijkl').length <= 64);
  // Anything that is not one of ours (the app-lock passkey has a random handle, other sites have their own) is refused.
  assert.equal(decodeIdentityHandle(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])), null);
  assert.equal(decodeIdentityHandle(new TextEncoder().encode('MN2|' + P1 + '|' + A)), null, 'another version of the format');
  assert.equal(decodeIdentityHandle(new TextEncoder().encode('MN1|not-an-id|' + A)), null);
  assert.equal(decodeIdentityHandle(new TextEncoder().encode('MN1|' + P1 + '|two words')), null);
  assert.equal(decodeIdentityHandle(null), null); assert.equal(decodeIdentityHandle(undefined), null);
});

test('what the phone is asked to create: a discoverable passkey named with the @name, whose handle is the identity', () => {
  const challenge = new Uint8Array(32);
  const o = passkeyCreateOptions({ installId: P1, alias: A, challenge });
  assert.equal(o.authenticatorSelection.residentKey, 'required', 'discoverable: it can be found again with no credential id');
  assert.equal(o.authenticatorSelection.requireResidentKey, true);
  assert.equal(o.attestation, 'none');
  assert.equal(o.rp.name, 'MyNotes'); assert.equal('id' in o.rp, false, 'the rp id is the page\'s own host: staging and production keep separate passkeys');
  assert.equal(o.user.name, '@' + A, 'the one to pick in the phone\'s list');
  assert.equal(o.user.displayName, 'MyNotes @' + A);
  assert.deepEqual(decodeIdentityHandle(o.user.id), { installId: P1, alias: A }, 'the handle is the identity');
  assert.ok(o.pubKeyCredParams.some((p) => p.alg === -7) && o.pubKeyCredParams.some((p) => p.alg === -257));
  assert.equal(passkeyCreateOptions({ installId: P1, alias: '', challenge }).user.name, 'MyNotes', 'with no name yet');
  assert.throws(() => passkeyCreateOptions({ installId: '', alias: A, challenge }));
  const g = passkeyGetOptions({ challenge });
  assert.equal('allowCredentials' in g, false, 'no credential id to give after a wipe: the phone lists its MyNotes passkeys');
});

test('passkey failures are named in terms the person can act on', () => {
  assert.equal(asVaultError({ name: 'NotAllowedError' }).code, 'cancelled', 'dismissed, or none held (a browser does not say which)');
  assert.equal(asVaultError({ name: 'AbortError' }).code, 'cancelled');
  assert.equal(asVaultError({ name: 'NotSupportedError' }).code, 'unsupported');
  assert.equal(asVaultError({ name: 'SecurityError' }).code, 'unsupported');
  assert.equal(asVaultError(new Error('boom')).code, 'failed');
  const already = vaultError('foreign'); assert.equal(asVaultError(already), already, 'a vault error passes through');
  assert.throws(() => identityFromPasskey({ response: { userHandle: new Uint8Array([9, 9, 9]).buffer } }), (e) => e.code === 'foreign');
  assert.deepEqual(identityFromPasskey({ response: { userHandle: encodeIdentityHandle(P1, A).buffer } }), { installId: P1, alias: A });
  for (const code of ['unsupported', 'cancelled', 'foreign', 'failed']) assert.ok(vaultMessage({ code }).length > 20, code + ' has words');
});

test('wiring: Remember this phone in the Menu and on the name step, Recover on the welcome screen, nothing sent anywhere', () => {
  const app = read('app.js'), fp = read('feature-picker.js'), db = read('db.js'), lock = read('lock.js'), sw = read('service-worker.js'), vault = read('identity-vault.js');
  // Menu
  assert.match(app, /items\.push\(menuItem\('🔑', passkeySaved \? 'Remembered on this phone' : 'Remember this phone',/);
  assert.match(app, /async \(\) => \{ closeModal\(\); await rememberThisPhone\(\); \}\)\);/);
  // The name step of setup, and the welcome screen
  assert.ok(fp.includes("text: '\\u{1F511} Remember this phone', onclick: async () => {"), 'the name step offers it');
  assert.match(fp, /text: 'Used MyNotes on this phone before\? Recover my name and plan', onclick: \(\) => recoverFromThisPhone\(\)/);
  // Remember asks first (the phone then asks too), and recovering follows the same never-swap-a-plan rule as a restore.
  const remember = app.slice(app.indexOf('export async function rememberThisPhone'), app.indexOf('export async function recoverFromThisPhone'));
  assert.match(remember, /appConfirm\('Your phone will ask you to save a passkey for MyNotes\./);
  assert.match(remember, /It holds only your anonymous name and install code - no money data, and nothing is sent anywhere\./);
  const recover = app.slice(app.indexOf('export async function recoverFromThisPhone'), app.indexOf('export async function getInstallId'));
  assert.match(recover, /ident\.chooseIdentity\(\{/);
  assert.match(recover, /if \(pick\.use !== 'backup'\) \{ toast\('This phone already has a Pro or Beta plan of its own, so it keeps it\.'\); return false; \}/);
  assert.match(recover, /checkPlan\(\)/, 'the plan comes back from the server, keyed on the recovered install id');
  assert.match(recover, /DB\.del\('meta', 'aliasLocked'\)/);
  // The flag is about THIS phone, so it never travels in a backup and survives an erase.
  assert.match(db, /const DEVICE_ONLY_META = \[[^\]]*'identityPasskey'[^\]]*\]/);
  assert.match(lock, /DB\.get\('meta', 'identityPasskey'\)/);
  assert.match(lock, /if \(passkeyFlag\) keep\.push\(passkeyFlag\);/);
  assert.match(sw, /'\.\/identity\.js',\s*'\.\/identity-vault\.js',/);
  // Only the browser's passkey calls: no network, no storage of its own.
  assert.equal(/\bfetch\(|XMLHttpRequest|sendBeacon|localStorage|indexedDB|DB\./.test(vault), false, 'identity-vault.js touches neither the network nor storage');
  assert.match(vault, /navigator\.credentials\.create\(\{ publicKey: passkeyCreateOptions\(/);
  assert.match(vault, /navigator\.credentials\.get\(\{ publicKey: passkeyGetOptions\(/);
});
