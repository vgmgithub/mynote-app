// Vercel "Ignored Build Step". Vercel runs this before every build; exit 0 means SKIP, exit 1 means BUILD.
//
// Two jobs.
//
// 1. Never build a preview. One repo feeds four Vercel projects (staging app and server, production app and
//    server), so without this a push to `main` also built previews in the production projects and a push to
//    `production` built previews in the staging ones - double the deployments, for builds nobody looks at. Each
//    project already knows which branch is ITS production branch (Settings > Git), so "production only" is all the
//    rule needs to be, and it needs no configuration of its own.
//
//    An earlier version of this decided by an environment variable, MYNOTES_TARGET, set per project. Setting it to
//    the wrong value on the wrong project silently skipped every build of the staging app for ten versions. A rule
//    that can block releases when somebody mis-types a setting is the wrong rule; this one has nothing to mis-type.
//
// 2. Skip a production build when nothing that reaches the app changed (server, docs, tests, markdown, CI).
//
// If anything cannot be worked out, it builds. A needless build is cheap; a skipped release is not.
import { execSync } from 'node:child_process';

const NOT_APP = [/^server\//, /^docs\//, /^tests\//, /^\.github\//, /\.md$/];

export function shouldBuild({ env, files }) {
  // Only 'production' and 'preview' exist here; anything else is unexpected, so build.
  if (env === 'preview') {
    return { build: false, why: 'preview build: each project builds only its own production branch' };
  }
  if (Array.isArray(files) && files.length && files.every((f) => NOT_APP.some((re) => re.test(f)))) {
    return { build: false, why: 'only server, docs, tests or markdown changed' };
  }
  return { build: true, why: 'app files changed, or the change could not be determined' };
}

function changedFiles() {
  // Against the last successfully deployed commit, so a release of many commits whose top commit is docs is not
  // wrongly skipped. Vercel's clone is shallow, so this often cannot be answered at all - then it builds.
  const base = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!base) return null;
  try {
    return execSync(`git diff --name-only ${base} HEAD`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_) {
    return null;
  }
}

// Only when run as a script, so the tests can import shouldBuild without side effects.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/vercel-ignore.js')) {
  const r = shouldBuild({ env: process.env.VERCEL_ENV || '', files: changedFiles() });
  console.log((r.build ? 'BUILD: ' : 'SKIP: ') + r.why);
  process.exit(r.build ? 1 : 0);
}
