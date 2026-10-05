// Read-only. Lists the web commits (and the files they touched) after a given web version, so the Android app can
// be brought up to date. Usage: node tools/android-changes.js 870 [branch]   (branch defaults to production)
import { execFileSync } from 'node:child_process';

const since = Number(process.argv[2]);
const branch = process.argv[3] || 'production';
if (!since) { console.error('Usage: node tools/android-changes.js <last synced version, e.g. 870> [branch]'); process.exit(1); }

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const log = git('log', branch, '--reverse', '--format=%H%x09%s').split('\n').filter(Boolean);
let shown = 0;
for (const line of log) {
  const [hash, subject] = line.split('\t');
  const m = /^v(\d+)\b/.exec(subject);
  if (!m || Number(m[1]) <= since) continue;
  const files = git('show', '--name-only', '--format=', hash).split('\n').filter((f) => f && !f.startsWith('tests/') && !f.startsWith('docs/'));
  console.log('v' + m[1] + '  ' + subject.slice(0, 160));
  files.forEach((f) => console.log('    ' + f));
  shown++;
}
console.log(shown ? '\n' + shown + ' version(s) after v' + since + ' on ' + branch + '.' : 'Nothing after v' + since + ' on ' + branch + '.');
