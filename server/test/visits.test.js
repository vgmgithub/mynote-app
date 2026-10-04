import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { istDay, parseVisit, countVisit } from '../lib/visits.js';
import { shapeStats, STAT_QUERIES } from '../lib/stats.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('a website visit stores only the India day and two counts', async () => {
  assert.equal(istDay(Date.UTC(2026, 9, 3, 19, 0)), '2026-10-04', '00:30 IST is the next day');
  assert.deepEqual(parseVisit({ first: true, fresh: true, week: true, month: false, installId: 'x', ua: 'y' }), { first: true, fresh: true, week: true, month: false });
  assert.deepEqual(parseVisit({ first: false, fresh: true, week: true, month: true }), { first: false, fresh: false, week: false, month: false }, 'a period is new only on the first visit of a day');
  assert.deepEqual(parseVisit('junk'), { first: false, fresh: false, week: false, month: false });
  const seen = [];
  await countVisit({ query: async (sql, p) => { seen.push([sql, p]); return [{}]; } }, { first: true, fresh: false, week: true, month: false }, Date.UTC(2026, 9, 4, 6));
  assert.match(seen[0][0], /INSERT INTO site_visits \(day, visitors, views, new_visitors, week_visitors, month_visitors\) VALUES/);
  assert.deepEqual(seen[0][1], ['2026-10-04', 1, 0, 1, 0]);
  // an older database without the period columns still counts the visit
  const old = [];
  await countVisit({ query: async (sql, p) => { old.push(sql); if (/week_visitors/.test(sql)) { const e = new Error('x'); e.code = 'ER_BAD_FIELD_ERROR'; throw e; } return [{}]; } }, { first: true });
  assert.equal(old.length, 2); assert.match(old[1], /new_visitors\) VALUES/);
  const t = shapeStats({ siteTotals: [{ today: '2', week: '5', month: '9', allTime: '14' }] });
  assert.deepEqual(t.siteTotals, { today: 2, week: 5, month: 9, allTime: 14 });
  assert.deepEqual(shapeStats({}).siteTotals, { today: 0, week: 0, month: 0, allTime: 0 });
});

test('stats carry the daily website visits; the admin draws them; the landing page counts once per open', () => {
  assert.match(STAT_QUERIES.siteVisits, /FROM site_visits/);
  const s = shapeStats({ siteVisits: [{ k: new Date('2026-10-04T00:00:00Z'), visitors: '3', views: '5', fresh: '2' }] });
  assert.deepEqual(s.siteVisits, [{ day: '2026-10-04', visitors: 3, views: 5, fresh: 2 }]);
  assert.match(read('server/api/stats.js'), /'siteVisits', 'siteTotals']/, 'optional: a database without the table still serves the page');
  assert.match(read('server/api/collect.js'), /req\.query\.visit === '1'/);
  assert.match(read('server/public/admin.html'), /tile\(h\.shared, 'Shared profile'[^\n]*\n[^\n]*\n\s*siteVisitsCard\(d\.siteVisits \|\| \[\], d\.siteTotals\),/, 'the big card after the last small one');
  assert.match(read('server/public/admin.html'), /stat\(v\('today'\), 'Today'\), stat\(v\('week'\), 'This week'\), stat\(v\('month'\), 'This month'\), stat\(v\('allTime'\), 'All time'\)/);
  assert.match(read('server/public/admin.html'), /\.tile\.svc \{ grid-column: 1 \/ -1; \}/);
  const land = read('landing.js');
  assert.match(land, /export function showLanding\(\) \{\r?\n\s*countVisit\(\);/);
  assert.match(land, /\/api\/collect\?visit=1/);
  assert.ok(!/installId|getInstallId/.test(land.slice(land.indexOf('function countVisit'), land.indexOf('export function showLanding'))), 'no identifier sent');
  assert.match(read('legal-text.js'), /Website visits: when the MyNotes website is opened/);
  assert.match(read('server/schema/008_site_visits.sql'), /CREATE TABLE IF NOT EXISTS site_visits/);
});
