// Vercel "Ignored Build Step" for the app projects. Vercel runs this before every build; exit 0 means SKIP the
// build, exit 1 means BUILD. It replaces the one-line git diff that used to live in vercel.json.
//
// Two jobs.
//
// 1. Each project builds only its own branch. The same repo now feeds four Vercel projects (staging app and
//    server, production app and server), and without this every push built in all of them, which doubled the
//    daily deployment count and hit Vercel's limit. Set MYNOTES_TARGET=production on the PRODUCTION app
//    project; the staging project leaves it unset.
//      production project : builds the 'production' branch only
//      staging project    : builds everything except 'production' (that commit was already built from main)
//
// 2. Skip a build when nothing that reaches the app changed (server, docs, tests, markdown, CI). The diff is
//    against the last successfully deployed commit (Vercel's VERCEL_GIT_PREVIOUS_SHA) rather than just the
//    parent commit, so a release of many commits whose top commit happens to be docs is not wrongly skipped.
//
// If anything about the diff cannot be worked out, it builds. A needless build is cheap; a skipped release is not.
import { execSync } from 'node:child_process';

const NOT_APP = [/^server\//, /^docs\//, /^tests\//, /^\.github\//, /\.md$/];

export function shouldBuild({ branch, target, files }) {
  const isProductionProject = target === 'production';
  if (isProductionProject && branch !== 'production') {
    return { build: false, why: 'production project builds only the production branch' };
  }
  if (!isProductionProject && branch === 'production') {
    return { build: false, why: 'staging builds main; the production branch is built by the production project' };
  }
  if (Array.isArray(files) && files.length && files.every((f) => NOT_APP.some((re) => re.test(f)))) {
    return { build: false, why: 'only server, docs, tests or markdown changed' };
  }
  return { build: true, why: 'app files changed, or the change could not be determined' };
}

function changedFiles() {
  const base = process.env.VERCEL_GIT_PREVIOUS_SHA || 'HEAD^';
  try {
    return execSync(`git diff --name-only ${base} HEAD`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_) {
    return null;   // could not diff: build
  }
}

// Only when run as a script, so the tests can import shouldBuild without side effects.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/vercel-ignore.js')) {
  const files = changedFiles();
  const r = shouldBuild({ branch: process.env.VERCEL_GIT_COMMIT_REF || '', target: process.env.MYNOTES_TARGET || '', files });
  console.log((r.build ? 'BUILD: ' : 'SKIP: ') + r.why);
  process.exit(r.build ? 1 : 0);
}
