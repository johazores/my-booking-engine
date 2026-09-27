import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const apiRoot = join(repositoryRoot, 'app', 'api');

function collectRawJsonRoutes(directory) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...collectRawJsonRoutes(absolute));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const source = readFileSync(absolute, 'utf8');
    if (!source.includes('request.json()')) continue;
    matches.push(relative(repositoryRoot, absolute).split(sep).join('/'));
  }
  return matches.sort();
}

test('production API routes do not use raw request.json() parsing', () => {
  assert.deepEqual(collectRawJsonRoutes(apiRoot), []);
});
