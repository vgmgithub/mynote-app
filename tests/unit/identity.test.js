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
  assert.deepEqual(blank, { use: 'backup', installId: P1, dropPlan: false, alias: A });
  // The same install restored over itself: nothing moves, and its plan cache is kept.
  const same = chooseIdentity({ backup: { installId: P1, alias: A }, ownInstallId: P1, ownAlias: A, ownHasPlan: true });
  assert.deepEqual(same, { use: 'backup', installId: P1, dropPlan: false, alias: A });
  // A phone that had set itself up as a fresh install first: it takes the backup's identity, and its cached plan
  // belonged to the install it leaves.
  const fresh = chooseIdentity({ backup: { installId: P1, alias: A }, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false });
  assert.deepEqual(fresh, { use: 'backup', installId: P1, dropPlan: true, alias: A });
});

test('a restore never swaps a Pro or Beta install for another, and an older backup (no identity) leaves the device\'s own alone', () => {
  const paid = chooseIdentity({ backup: { installId: P1, alias: A }, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: true });
  assert.deepEqual(paid, { use: 'own', installId: P2, alias: 'Zanora' }, 'a paid install is never silently downgraded');
  const legacy = chooseIdentity({ backup: undefined, ownInstallId: P2, ownAlias: 'Zanora', ownHasPlan: false });
  assert.deepEqual(legacy, { use: 'own', installId: P2, alias: 'Zanora' });
  const legacyBlank = chooseIdentity({ backup: undefined, ownInstallId: '', ownAlias: '', ownHasPlan: false });
  assert.deepEqual(legacyBlank, { use: 'own', installId: '', alias: '' }, 'nothing to keep: the old backup\'s name is used instead (db.js)');
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
