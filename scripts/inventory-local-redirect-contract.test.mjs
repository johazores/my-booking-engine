import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const inventoryRoot = join(repositoryRoot, 'app', 'api', 'inventory');

function collectRoutes(directory) {
  const routes = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) routes.push(...collectRoutes(path));
    else if (entry.isFile() && entry.name === 'route.ts') routes.push(path);
  }
  return routes;
}

test('all inventory browser POST redirects are local and independent of inbound Host', () => {
  const routes = collectRoutes(inventoryRoot);
  assert.ok(routes.length > 0, 'expected implemented inventory mutation routes');
  for (const path of routes) {
    const name = relative(repositoryRoot, path).split(sep).join('/');
    const source = readFileSync(path, 'utf8');
    assert.match(source, /prepareInventoryMutationRequest\(/, name);
    assert.match(source, /redirectToLocalPath\(/, name);
    assert.doesNotMatch(source, /NextResponse\.redirect\s*\(/, name);
    assert.doesNotMatch(source, /new URL\([\s\S]*?request\.url/, name);
    assert.doesNotMatch(source, /\/inventory\/\$\{(?:propertyId|roomTypeId|ratePlanId)\}/, name);
    assert.doesNotMatch(source, /[?&](?:roomType|ratePlan)=\$\{(?:roomTypeId|ratePlanId)\}/, name);
  }
});

test('inventory mutation responses are no-store at the shared finish boundary', () => {
  const source = readFileSync(
    join(repositoryRoot, 'src', 'server', 'inventory', 'inventory-http.ts'),
    'utf8',
  );
  assert.match(source, /redirectToLocalPath\('\/sign-in\?error=required'\)/);
  assert.match(source, /redirectToLocalPath\('\/inventory\?error=tenant'\)/);
  assert.match(source, /applyAuthResponseNoStore\(response\)/);
  assert.doesNotMatch(source, /NextResponse\.redirect\s*\(/);
});
