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
  assert.match(db, /import \{ IDENTITY_KEY, identityRow, chooseIdentity, isAliasName, forgetList \} from '\.\/identity\.js';/);
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

// ---------- the install a restore leaves behind is forgotten, so its reserved name is freed ----------
import { forgetList } from '../../identity.js';

test('the abandoned install ids to forget: valid, unique, never the one in use, a handful at most', () => {
  const OLD = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(forgetList([], OLD, P1), [OLD]);
  assert.deepEqual(forgetList([OLD], OLD, P1), [OLD], 'once');
  assert.deepEqual(forgetList([OLD, P1], '', P1), [OLD], 'the install in use is never forgotten');
  assert.deepEqual(forgetList(['junk', null, OLD], '', P1), [OLD], 'malformed ids are dropped');
  assert.deepEqual(forgetList(undefined, '', P1), []);
  const many = Array.from({ length: 9 }, (_, i) => '0000000' + i + '-2222-4333-8444-555555555555');
  assert.equal(forgetList(many, '', P1).length, 5, 'a handful at most');
});

test('a restore that switches the device to the backup\'s identity notes the install it leaves; the app tells the server to forget it', () => {
  const db = read('db.js'), sender = read('sender.js');
  assert.match(db, /const DEVICE_ONLY_META = \[[^\]]*'forgetInstalls'[^\]]*\]/, 'about this device, so never carried by a backup');
  assert.match(db, /const abandoned = pick\.use === 'backup' && ownInstall && ownInstall\.value !== pick\.installId \? ownInstall\.value : '';/, 'only when the id actually changes');
  assert.match(db, /if \(toForget\.length\) tasks\.push\(this\.put\('meta', \{ key: 'forgetInstalls', value: toForget \}\)\);/);
  assert.match(db, /if \(r\.key === 'forgetInstalls'\) return;/, 'the old list is merged, not copied over it');
  const f = sender.slice(sender.indexOf('async function forgetAbandoned'), sender.indexOf('async function forgetIfPending'));
  assert.match(f, /forgetNow\(id\)/, 'the same erasure call the app already uses (deletes the install\'s row, which frees its name)');
  assert.match(f, /forgetList\(ids, '', current\)/, 'never the install in use');
  assert.match(f, /if \(left\.length\) await DB\.put\('meta', \{ key: 'forgetInstalls', value: left \}\);\s*\n\s*else await DB\.del\('meta', 'forgetInstalls'\);/, 'kept and retried until it works');
  assert.ok(sender.indexOf('await forgetAbandoned();') > sender.indexOf("return 'offline'") && sender.indexOf('await forgetAbandoned();') < sender.indexOf("return 'not-set-up'"), 'runs on a normal open, online, before anything else is sent');
  assert.match(sender, /import \{ forgetList \} from '\.\/identity\.js';/);
  // The passkey idea was dropped: none of it is left.
  for (const f2 of ['app.js', 'feature-picker.js', 'identity.js', 'db.js', 'lock.js', 'service-worker.js']) assert.equal(/passkey|identity-vault|rememberThisPhone|recoverFromThisPhone/i.test(read(f2)), false, f2 + ' has no passkey code');
  assert.match(read('feature-picker.js'), /Already have a MyNotes backup\? Restore it/, 'the restore link stays on the welcome screen');
});
