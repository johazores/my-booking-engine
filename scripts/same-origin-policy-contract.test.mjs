import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function routeFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...routeFiles(path));
    else if (entry.isFile() && entry.name === 'route.ts') result.push(path);
  }
  return result;
}

function isWriteRoute(source) {
  return /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\s*\(/.test(source);
}

test('all public booking mutation routes enforce the shared exact-Origin guard', () => {
  let checked = 0;
  for (const path of routeFiles(join(root, 'app/api/public-bookings'))) {
    const source = readFileSync(path, 'utf8');
    if (!isWriteRoute(source)) continue;
    checked += 1;
    const name = relative(root, path).split(sep).join('/');
    assert.match(source, /isSameOriginPublicBookingWrite\s*\(\s*request\s*\)/, name);
  }
  assert.ok(checked > 0, 'expected public booking mutation routes');
});

test('public and authenticated origin policies delegate to the same strict helper', () => {
  const publicPolicy = readFileSync(join(root, 'src/server/bookings/public-booking-http-policy.ts'), 'utf8');
  const authPolicy = readFileSync(join(root, 'src/server/auth/auth-http-policy.ts'), 'utf8');
  for (const source of [publicPolicy, authPolicy]) {
    assert.match(source, /isSameOriginRequest\(request\)/);
    assert.doesNotMatch(source, /new URL\(origin\)\.origin/);
  }
});
