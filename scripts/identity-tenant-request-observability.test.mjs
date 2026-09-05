import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const AUTH_ROUTES = [
  ['app/api/auth/sign-in/route.ts', 'auth.sign-in'],
  ['app/api/auth/sign-up/route.ts', 'auth.sign-up'],
  ['app/api/auth/sign-out/route.ts', 'auth.sign-out'],
];

const TENANT_ROUTES = [
  ['app/api/organizations/route.ts', 'organization.create'],
  ['app/api/organizations/select/route.ts', 'organization.select'],
  ['app/api/organizations/settings/route.ts', 'organization.settings.update'],
  ['app/api/organizations/branding/route.ts', 'organization.branding.update'],
  ['app/api/organizations/archive/route.ts', 'organization.archive'],
  ['app/api/organizations/memberships/[membership-id]/role/route.ts', 'organization.membership.role.update'],
  ['app/api/organizations/memberships/[membership-id]/status/route.ts', 'organization.membership.status.update'],
];

function source(path) {
  return readFileSync(path, 'utf8');
}

function assertOperation(routeSource, operation) {
  assert.match(routeSource, /createRequestObservation\(request, \{ operation: '[^']+' \}\)/);
  assert.ok(routeSource.includes(`operation: '${operation}'`), `${operation} must use its static operation name`);
  assert.match(routeSource, /observation\.finish\(/);
}

test('authentication mutations emit correlated completion logs without identity scope', () => {
  for (const [path, operation] of AUTH_ROUTES) {
    const routeSource = source(path);
    assertOperation(routeSource, operation);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*organizationId/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*bookingReference/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*provider/s);
  }
});

test('sign-in and sign-up classify redirect-based failures explicitly', () => {
  for (const path of ['app/api/auth/sign-in/route.ts', 'app/api/auth/sign-up/route.ts']) {
    const routeSource = source(path);
    assert.match(routeSource, /303\), 'rejected'\)/);
    assert.match(routeSource, /code === 'server' \? 'failed' : 'rejected'/);
  }
});

test('sign-out fails closed when session revocation cannot be persisted', () => {
  const routeSource = source('app/api/auth/sign-out/route.ts');
  const revokeIndex = routeSource.indexOf('await signOutSession(token)');
  const failureIndex = routeSource.indexOf("new Response('Unable to sign out', { status: 500 })");
  const cookieClearIndex = routeSource.indexOf("response.cookies.set(AUTH_SESSION_COOKIE, '', {");
  assert.ok(revokeIndex >= 0, 'sign-out must revoke the persisted session');
  assert.ok(failureIndex > revokeIndex, 'revocation failure must produce an observed server failure');
  assert.ok(cookieClearIndex > failureIndex, 'the browser cookie must only be cleared after revocation succeeds');
});

test('tenant administration mutations use static operations and bounded organization-only scope', () => {
  for (const [path, operation] of TENANT_ROUTES) {
    const routeSource = source(path);
    assertOperation(routeSource, operation);
    assert.match(routeSource, /\{ organizationId \}/);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*membershipId/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*userId/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*role/s);
    assert.doesNotMatch(routeSource, /observation\.finish\([^;]*status:/s);
  }
});

test('organization scope is attached only after server-side organization authority is established', () => {
  const createSource = source('app/api/organizations/route.ts');
  assert.ok(
    createSource.indexOf('organizationId = organization.id;') > createSource.indexOf('await createOrganizationForUser({'),
    'new organization scope must be assigned only after creation succeeds',
  );

  const selectSource = source('app/api/organizations/select/route.ts');
  assert.ok(
    selectSource.indexOf('organizationId = organization.id;') > selectSource.indexOf('await findOrganizationForUser({'),
    'selected organization scope must be assigned only after membership lookup succeeds',
  );

  for (const path of TENANT_ROUTES.slice(2).map(([path]) => path)) {
    const routeSource = source(path);
    const authorityIndex = routeSource.indexOf('await readActiveOrganizationContext(session.user.id)');
    const scopeIndex = routeSource.indexOf('organizationId = activeContext.organization.id;');
    assert.ok(authorityIndex >= 0 && scopeIndex > authorityIndex, `${path} must establish active tenant authority before logging tenant scope`);
  }
});


test('tenant authority infrastructure failures are observed as server failures', () => {
  for (const [path] of TENANT_ROUTES) {
    const routeSource = source(path);
    assert.match(routeSource, /readAuthSession\(\);[\s\S]*new Response\('Internal Server Error', \{ status: 500 \}\)/);
  }

  for (const path of TENANT_ROUTES.slice(2).map(([path]) => path)) {
    const routeSource = source(path);
    const authorityIndex = routeSource.indexOf('await readActiveOrganizationContext(session.user.id)');
    const serverFailureIndex = routeSource.indexOf("new Response('Internal Server Error', { status: 500 })", authorityIndex);
    assert.ok(serverFailureIndex > authorityIndex, `${path} must observe active-tenant lookup failures as server failures`);
  }

  const selectSource = source('app/api/organizations/select/route.ts');
  const lookupIndex = selectSource.indexOf('await findOrganizationForUser({');
  const lookupFailureIndex = selectSource.indexOf("new Response('Internal Server Error', { status: 500 })", lookupIndex);
  assert.ok(lookupFailureIndex > lookupIndex, 'organization repository failures must not be misclassified as forbidden selections');
});

test('tenant administration form redirects preserve rejected-versus-failed outcomes', () => {
  for (const [path] of TENANT_ROUTES) {
    const routeSource = source(path);
    assert.ok(routeSource.includes("'rejected'"), `${path} must mark redirect-based validation/auth failures rejected`);
  }

  for (const path of TENANT_ROUTES.filter(([path]) => !path.endsWith('/select/route.ts')).map(([path]) => path)) {
    const routeSource = source(path);
    assert.match(routeSource, /code === 'server' \? 'failed' : 'rejected'/);
  }
});
