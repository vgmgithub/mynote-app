import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { istDay, parseVisit, countVisit } from '../lib/visits.js';
import { shapeStats, STAT_QUERIES } from '../lib/stats.js';

const read = (f) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');

test('a website visit stores only the India day and two counts', async () => {
  assert.equal(istDay(Date.UTC(2026, 9, 3, 19, 0)), '2026-10-04', '00:30 IST is the next day');
  assert.deepEqual(parseVisit({ first: true, installId: 'x', ua: 'y' }), { first: true });
  assert.deepEqual(parseVisit('junk'), { first: false });
  const seen = [];
  await countVisit({ query: async (sql, p) => { seen.push([sql, p]); return [{}]; } }, { first: true }, Date.UTC(2026, 9, 4, 6));
  assert.match(seen[0][0], /INSERT INTO site_visits \(day, visitors, views\) VALUES \(\?, \?, 1\) ON DUPLICATE KEY UPDATE/);
  assert.deepEqual(seen[0][1], ['2026-10-04', 1]);
});

test('stats carry the daily website visits; the admin draws them; the landing page counts once per open', () => {
  assert.match(STAT_QUERIES.siteVisits, /FROM site_visits/);
  const s = shapeStats({ siteVisits: [{ k: new Date('2026-10-04T00:00:00Z'), visitors: '3', views: '5' }] });
  assert.deepEqual(s.siteVisits, [{ day: '2026-10-04', visitors: 3, views: 5 }]);
  assert.match(read('server/api/stats.js'), /'siteVisits'\]/, 'optional: a database without the table still serves the page');
  assert.match(read('server/api/collect.js'), /req\.query\.visit === '1'/);
  assert.match(read('server/public/admin.html'), /id="sitePanel"/);
  const land = read('landing.js');
  assert.match(land, /export function showLanding\(\) \{\r?\n\s*countVisit\(\);/);
  assert.match(land, /\/api\/collect\?visit=1/);
  assert.ok(!/installId|getInstallId/.test(land.slice(land.indexOf('function countVisit'), land.indexOf('export function showLanding'))), 'no identifier sent');
  assert.match(read('legal-text.js'), /Website visits: when the MyNotes website is opened/);
  assert.match(read('server/schema/008_site_visits.sql'), /CREATE TABLE IF NOT EXISTS site_visits/);
});
