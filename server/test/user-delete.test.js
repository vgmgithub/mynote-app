import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deleteInstall } from '../lib/installs.js';
import { cancelBetaRequest } from '../lib/beta.js';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const ID = '4dcd6fca-1234-4abc-9def-0123456789ab';

// A pool that records every statement, with optional per-statement behaviour.
function fake({ live = false, missing = [] } = {}) {
  const log = [];
  const conn = {
    beginTransaction: async () => log.push('BEGIN'), commit: async () => log.push('COMMIT'), rollback: async () => log.push('ROLLBACK'), release: () => {},
    query: async (sql, p) => {
      log.push(sql.replace(/\s+/g, ' ').trim());
      if (missing.some((m) => sql.includes(m))) { const e = new Error("Table doesn't exist"); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
      return [{ affectedRows: 1 }];
    },
  };
  return { log, query: async (sql) => { log.push(sql.replace(/\s+/g, ' ').trim()); return [live ? [{ 1: 1 }] : []]; }, getConnection: async () => conn };
}

test('deleting a user removes every row held for them, in one transaction, the install itself last', async () => {
  const p = fake();
  const out = await deleteInstall(p, ID);
  assert.deepEqual(out, { ok: true, deleted: 1 });
  const stmts = p.log.filter((l) => l.startsWith('DELETE'));
  for (const t of ['beta_feedback_answers', 'beta_feedback', 'beta_offers', 'beta_requests', 'subscriptions', 'news_quota', 'install_days', 'install_features', 'installs']) {
    assert.ok(stmts.some((s) => new RegExp('DELETE FROM ' + t + ' WHERE').test(s)), t + ' is cleared');
  }
  assert.match(stmts[stmts.length - 1], /DELETE FROM installs WHERE install_id = \?/, 'the install row goes last');
  assert.deepEqual([p.log[1], p.log[p.log.length - 1]], ['BEGIN', 'COMMIT']);
});

test('a user with a live subscription is not deleted (it would keep billing), and an older database without some tables still works', async () => {
  const live = fake({ live: true });
  assert.deepEqual(await deleteInstall(live, ID), { ok: false, reason: 'live subscription' });
  assert.equal(live.log.some((l) => l.startsWith('DELETE')), false, 'nothing was touched');
  const old = fake({ missing: ['beta_offers', 'news_quota'] });
  assert.equal((await deleteInstall(old, ID)).ok, true, 'a missing table is skipped');
  assert.ok(old.log.includes('COMMIT'));
});

test('a Beta request still waiting can be withdrawn: it becomes cancelled, never deleted, and only if pending', async () => {
  const seen = [];
  const pool = { query: async (sql, p) => { seen.push([sql.replace(/\s+/g, ' '), p]); return [{ affectedRows: 1 }]; } };
  assert.deepEqual(await cancelBetaRequest(pool, ID), { ok: true, cancelled: 1 });
  assert.match(seen[0][0], /UPDATE beta_requests SET status = 'cancelled', reviewed_at = \? WHERE install_id = \? AND status = 'pending'/);
  assert.equal(seen[0][1][1], ID);
});

test('wiring: the delete is admin-only POST on the installs endpoint, Beta is in the plan list, the app can cancel and re-apply', () => {
  const api = read('api/admin/installs.js'), html = read('public/admin.html'), plan = read('api/plan.js');
  const h = api.slice(api.indexOf('export default async function handler'));
  assert.ok(h.indexOf('requireAdmin(req)') < h.indexOf('handleUserDelete(req'), 'admin is checked before the delete');
  assert.match(api, /view === 'user' \? handleUserDelete\(req, res, pool\)/);
  assert.match(api, /res\.statusCode = 409/, 'a live subscription is refused');
  assert.match(html, /\['free', 'paid', 'beta'\]\.map/, 'Beta is in the plan dropdown');
  assert.match(html, /PLAN_ICON = \{[^}]*beta: 'icons\/icon-beta\.png'/);
  assert.match(html, /el\('div', \{ class: 'ufoot' \}, \[delBtn\]\)/, 'a delete at the bottom of each user card');
  assert.match(html, /\.ufoot \{ display: flex; justify-content: flex-end;/, 'at the right');
  assert.match(html, /if \(!confirm\('Delete ' \+ who \+ ' and everything the server holds for them\?/, 'confirmed first');
  assert.match(html, /\/api\/admin\/installs\?view=user/);
  assert.match(plan, /req\.query\.beta_cancel === '1'/);
  const sw = read('public/admin-sw.js');
  assert.equal(/ADMIN_VERSION = (\d+)/.exec(html)[1], /mynotes-admin-v(\d+)/.exec(sw)[1], 'admin page and its cache version move together');
  assert.ok(readFileSync(new URL('../public/icons/icon-beta.png', import.meta.url)).length > 0);
  const ui = readFileSync(new URL('../../beta-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /text: 'Cancel request'/); assert.match(ui, /text: 'Cancel & re-apply'/);
  assert.match(ui, /DB\.del\('meta', 'betaRequestPending'\)/, 'the waiting flag is cleared, so the Menu offers Join again');
});

test('tags: reading them while typing never commits the half-typed word (each letter used to become a tag)', () => {
  const pf = readFileSync(new URL('../../personal-ui.js', import.meta.url), 'utf8'), ex = readFileSync(new URL('../../expense-ui.js', import.meta.url), 'utf8');
  assert.match(pf, /peek: \(\) => tags\.slice\(\),/);
  assert.match(pf, /summary: \(\) => \[\(tagBox\.peek\(\) \|\| \[\]\)/); assert.match(ex, /summary: \(\) => \(tagBox\.peek\(\) \|\| \[\]\)/);
  assert.match(pf, /cardId: chosenCardId, tags: tagBox\.peek\(\)/); assert.match(ex, /cardId: chosenCardId, tags: tagBox\.peek\(\) \}\)/);
  assert.equal((pf + ex).match(/tags: tagBox\.get\(\),/g).length, 2, 'only the two save paths commit what is typed');
});
