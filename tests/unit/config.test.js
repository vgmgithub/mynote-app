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
  // With nothing listed yet, nothing can be production by accident.
  assert.deepEqual(PRODUCTION_HOSTS, [], 'fill this in only when the production domain exists');
  for (const h of ['localhost', 'mynote-app-tau.vercel.app', 'example.com']) assert.notEqual(envFor(h), 'production');
});

test('a production copy never falls back to the staging server', () => {
  assert.equal(serverFor('staging'), STAGING_SERVER);
  assert.equal(serverFor('local'), STAGING_SERVER);
  // If production is not configured it has NO server. Falling back would put live users' counts and
  // payments into the test database.
  assert.equal(serverFor('production'), PRODUCTION_SERVER);
  if (!PRODUCTION_SERVER) assert.equal(serverFor('production'), '');
  assert.notEqual(PRODUCTION_SERVER, STAGING_SERVER, 'production and staging must not share a server');
});

// The whole point is that no module hardcodes a server address any more.
test('no module outside config.js names the server directly', () => {
  for (const f of ['sender.js', 'feed.js', 'app.js', 'personal-ui.js', 'landing.js']) {
    const src = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /mynotes-server\.vercel\.app/, f + ' hardcodes the server address');
  }
});
