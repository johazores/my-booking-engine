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

const reviewedRemainingRawJsonRoutes = [
  'app/api/payments/stripe/reconcile/route.ts',
  'app/api/payments/stripe/refunds/reconcile/route.ts',
  'app/api/payments/stripe/refunds/route.ts',
].sort();

test('raw JSON request parsing is limited to the reviewed remaining ingress gaps', () => {
  assert.deepEqual(collectRawJsonRoutes(apiRoot), reviewedRemainingRawJsonRoutes);
});
