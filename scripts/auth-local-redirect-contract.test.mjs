import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const routes = [
  'app/api/auth/sign-in/route.ts',
  'app/api/auth/sign-up/route.ts',
  'app/api/auth/sign-out/route.ts',
  'app/api/organizations/route.ts',
  'app/api/organizations/select/route.ts',
  'app/api/organizations/archive/route.ts',
  'app/api/organizations/branding/route.ts',
  'app/api/organizations/settings/route.ts',
  'app/api/organizations/memberships/[membership-id]/role/route.ts',
  'app/api/organizations/memberships/[membership-id]/status/route.ts',
];

test('identity and organization browser redirects never use the incoming request Host', () => {
  for (const routePath of routes) {
    const source = readFileSync(resolve(repositoryRoot, routePath), 'utf8');
    assert.match(source, /redirectToLocalPath\(/, routePath);
    assert.doesNotMatch(source, /NextResponse\.redirect\s*\(/, routePath);
    assert.doesNotMatch(source, /new URL\([^)]*request\.url/, routePath);
  }
});
