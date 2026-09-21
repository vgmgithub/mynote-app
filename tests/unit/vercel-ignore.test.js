import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldBuild } from '../../scripts/vercel-ignore.js';

const APP = ['app.js', 'styles.css'];

test('the production project builds only the production branch', () => {
  assert.equal(shouldBuild({ branch: 'production', target: 'production', files: APP }).build, true);
  assert.equal(shouldBuild({ branch: 'main', target: 'production', files: APP }).build, false, 'a main push must not build production');
  assert.equal(shouldBuild({ branch: 'feature/x', target: 'production', files: APP }).build, false);
});

test('the staging project never builds the production branch, which it already built from main', () => {
  assert.equal(shouldBuild({ branch: 'main', target: 'staging', files: APP }).build, true);
  assert.equal(shouldBuild({ branch: 'production', target: 'staging', files: APP }).build, false);
});

// The dangerous mistake is skipping a release, so a project with no setting must build every branch.
test('a project with no target set builds every branch, so a missing setting cannot block a release', () => {
  for (const branch of ['main', 'production', 'feature/x']) assert.equal(shouldBuild({ branch, target: '', files: APP }).build, true, branch);
  assert.equal(shouldBuild({ branch: 'production', target: undefined, files: APP }).build, true);
});

test('a change that cannot reach the app does not build it', () => {
  for (const files of [['server/lib/news.js'], ['docs/tiers.md'], ['tests/unit/a.test.js'], ['README.md'], ['.github/workflows/tests.yml'], ['server/a.js', 'docs/b.md']]) {
    assert.equal(shouldBuild({ branch: 'main', target: '', files }).build, false, files.join());
  }
});

test('any app file in the change builds, even alongside docs', () => {
  assert.equal(shouldBuild({ branch: 'main', target: '', files: ['docs/x.md', 'app.js'] }).build, true);
  assert.equal(shouldBuild({ branch: 'main', target: '', files: ['service-worker.js'] }).build, true);
  assert.equal(shouldBuild({ branch: 'main', target: '', files: ['config.js'] }).build, true);
});

test('when the diff cannot be worked out it builds: a needless build is cheap, a skipped release is not', () => {
  assert.equal(shouldBuild({ branch: 'main', target: '', files: null }).build, true);
  assert.equal(shouldBuild({ branch: 'main', target: '', files: [] }).build, true);
});

test('vercel.json runs the script, and the script diffs against the last deployed commit', () => {
  const v = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  assert.equal(v.ignoreCommand, 'node scripts/vercel-ignore.js');
  assert.match(readFileSync(new URL('../../scripts/vercel-ignore.js', import.meta.url), 'utf8'), /VERCEL_GIT_PREVIOUS_SHA/);
});
