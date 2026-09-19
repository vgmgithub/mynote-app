import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = readdirSync(root).filter((f) => f.endsWith('.js'));

test('every app module parses (catches a broken edit before it ships)', () => {
  assert.ok(files.length > 10);
  for (const f of files) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(root, f)], { stdio: 'pipe' }), f + ' has a syntax error');
  }
});
