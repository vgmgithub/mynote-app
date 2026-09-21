import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { envFor, serverFor, STAGING_SERVER, PRODUCTION_HOSTS, PRODUCTION_SERVER } from '../../config.js';

test('the environment is told from the address the app is opened from', () => {
  assert.equal(envFor('localhost'), 'local');
  assert.equal(envFor('127.0.0.1'), 'local');
  assert.equal(envFor('mynote-app-tau.vercel.app'), 'staging', 'the original address is the staging copy');
  assert.equal(envFor('anything-else.example.com'), 'staging', 'unknown addresses are never production');
  assert.equal(envFor('MyNote-App-Tau.Vercel.App'), 'staging', 'case does not matter');
});

test('only an address listed as production is production', () => {
  assert.deepEqual(PRODUCTION_HOSTS, ['mynotes.viewsofvgm.com']);
  assert.equal(envFor('mynotes.viewsofvgm.com'), 'production');
  assert.equal(envFor('MyNotes.ViewsOfVGM.com'), 'production', 'case does not matter');
  // Nothing else is production: not the staging copy, not a look-alike, not the bare domain.
  for (const h of ['localhost', 'mynote-app-tau.vercel.app', 'example.com', 'viewsofvgm.com', 'api.viewsofvgm.com', 'mynotes.viewsofvgm.app']) {
    assert.notEqual(envFor(h), 'production', h);
  }
});

test('a production copy never falls back to the staging server', () => {
  assert.equal(serverFor('staging'), STAGING_SERVER);
  assert.equal(serverFor('local'), STAGING_SERVER);
  // If production is not configured it has NO server. Falling back would put live users' counts and
  // payments into the test database.
  assert.equal(serverFor('production'), PRODUCTION_SERVER);
  assert.match(PRODUCTION_SERVER, /^https:\/\/[^/]+$/, 'production has a server, and it is a bare https origin');
  assert.notEqual(PRODUCTION_SERVER, STAGING_SERVER, 'production and staging must not share a server');
});

// The whole point is that no module hardcodes a server address any more.
test('no module outside config.js names the server directly', () => {
  for (const f of ['sender.js', 'feed.js', 'app.js', 'personal-ui.js', 'landing.js']) {
    const src = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /mynotes-server\.vercel\.app/, f + ' hardcodes the server address');
  }
});
