import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

function collectRouteFiles(directory) {
  const routes = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...collectRouteFiles(path));
    else if (entry.isFile() && entry.name === 'route.ts') routes.push(path);
  }
  return routes;
}

test('POST route handlers do not construct Host-derived browser redirects', () => {
  let inspected = 0;
  for (const path of collectRouteFiles(join(root, 'app'))) {
    const source = readFileSync(path, 'utf8');
    if (!/export\s+(?:async\s+)?function\s+POST\s*\(/.test(source)) continue;
    inspected += 1;
    const name = relative(root, path).split(sep).join('/');
    assert.doesNotMatch(source, /(?:NextResponse|Response)\.redirect\s*\(/, name);
    assert.doesNotMatch(source, /new\s+URL\s*\([^,\n]+,\s*(?:request|req)\.(?:url|nextUrl)\s*\)/, name);
  }
  assert.ok(inspected > 0, 'expected production POST route handlers');
});

test('tax reconciliation POST uses shared path-only redirects and no-store completion', () => {
  const source = readFileSync(join(root, 'app/invoices/reconciliation/run/route.ts'), 'utf8');
  assert.match(source, /requireHospitalityBookingApiContext\(request,\s*\{\s*write:\s*true\s*\}\)/);
  assert.match(source, /redirectToLocalPath\(/);
  assert.match(source, /applyAuthResponseNoStore\(response\)/);
  assert.doesNotMatch(source, /new URL\(/);
  assert.doesNotMatch(source, /function redirectResponse\(/);
});
