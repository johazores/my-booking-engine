import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const groups = ['customers', 'pricing', 'integrations'];

function routesIn(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...routesIn(path));
    else if (entry.isFile() && entry.name === 'route.ts') result.push(path);
  }
  return result;
}

test('customer, pricing, and integration form redirects remain local and no-store', () => {
  for (const group of groups) {
    const routes = routesIn(join(root, 'app', 'api', group));
    assert.ok(routes.length > 0, group);
    for (const path of routes) {
      const name = relative(root, path).split(sep).join('/');
      const source = readFileSync(path, 'utf8');
      assert.match(source, /isSameOriginAuthRequest\(request\)/, name);
      assert.match(source, /redirectToLocalPath\(/, name);
      assert.match(source, /applyAuthResponseNoStore\(response\)/, name);
      assert.doesNotMatch(source, /NextResponse\.redirect\s*\(/, name);
      assert.doesNotMatch(source, /new URL\([\s\S]*?request\.url/, name);
      assert.doesNotMatch(source, /\/(?:customers|pricing)\/\$\{(?:customerId|propertyId)\}/, name);
      assert.doesNotMatch(source, /[?&](?:ratePlan|roomType)=\$\{(?:ratePlanId|roomTypeId)\}/, name);
    }
  }
});
