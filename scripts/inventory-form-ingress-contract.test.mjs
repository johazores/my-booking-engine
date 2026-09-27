import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const inventoryApiRoot = join(repositoryRoot, 'app', 'api', 'inventory');

function collectDirectFormDataRoutes(directory) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      matches.push(...collectDirectFormDataRoutes(absolute));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const source = readFileSync(absolute, 'utf8');
    if (!source.includes('request.formData()')) continue;
    matches.push(relative(repositoryRoot, absolute).split(sep).join('/'));
  }
  return matches.sort();
}

test('inventory mutation routes use the shared form-data reader', () => {
  assert.deepEqual(collectDirectFormDataRoutes(inventoryApiRoot), []);
});
