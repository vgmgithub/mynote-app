import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldBuild } from '../../scripts/vercel-ignore.js';

const APP = ['app.js', 'styles.css'];

// The rule that matters: a production build is never skipped for being on the wrong branch. An earlier version
// decided that from a per-project setting, and one wrong value silently blocked ten versions of the staging app.
test('a production build always happens, whatever the branch or the settings', () => {
  assert.equal(shouldBuild({ env: 'production', files: APP }).build, true);
  assert.equal(shouldBuild({ env: 'production', files: null }).build, true);
  assert.equal(shouldBuild({ env: '', files: APP }).build, true, 'an unexpected value builds rather than skips');
});

test('previews are skipped: each project builds only its own production branch', () => {
  assert.equal(shouldBuild({ env: 'preview', files: APP }).build, false);
  assert.equal(shouldBuild({ env: 'preview', files: null }).build, false);
});

test('a production change that cannot reach the app does not build it', () => {
  for (const files of [['server/lib/news.js'], ['docs/tiers.md'], ['tests/unit/a.test.js'], ['README.md'], ['.github/workflows/tests.yml']]) {
    assert.equal(shouldBuild({ env: 'production', files }).build, false, files.join());
  }
  assert.equal(shouldBuild({ env: 'production', files: ['docs/x.md', 'app.js'] }).build, true, 'one app file is enough');
});

test('when the change cannot be worked out it builds: a needless build is cheap, a skipped release is not', () => {
  assert.equal(shouldBuild({ env: 'production', files: null }).build, true);
  assert.equal(shouldBuild({ env: 'production', files: [] }).build, true);
});

test('vercel.json runs the script, and nothing reads a per-project setting any more', () => {
  const v = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.equal(v.ignoreCommand, 'node scripts/vercel-ignore.js');
  const src = readFileSync(new URL('../../scripts/vercel-ignore.js', import.meta.url), 'utf8');
  // The history is explained in a comment; what matters is that no CODE reads it any more.
  const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /MYNOTES_TARGET/, 'the setting that could block a release must no longer be read');
  assert.match(src, /VERCEL_ENV/);
});
