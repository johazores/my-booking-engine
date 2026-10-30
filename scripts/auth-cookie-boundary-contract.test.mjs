import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authHttp = readFileSync('src/server/auth/auth-http.ts', 'utf8');
const routes = ['sign-in', 'sign-up', 'sign-out'];

test('authentication identity transitions expire the prior tenant selection', () => {
  assert.match(authHttp, /response\.cookies\.set\(ACTIVE_ORGANIZATION_COOKIE, ''/);
  assert.match(authHttp, /maxAge:\s*0/);
  assert.match(authHttp, /expires:\s*new Date\(0\)/);
  for (const route of routes) {
    const source = readFileSync(`app/api/auth/${route}/route.ts`, 'utf8');
    assert.match(source, /clearSelectedOrganizationCookie\(response\)/, route);
  }
});

test('all authentication POST response paths apply no-store policy', () => {
  for (const route of routes) {
    const source = readFileSync(`app/api/auth/${route}/route.ts`, 'utf8');
    assert.match(source, /const finish = /, route);
    assert.match(source, /applyAuthResponseNoStore\(response\)/, route);
  }
});
