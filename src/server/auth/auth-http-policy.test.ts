import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAuthRequiredRedirect,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
} from './auth-http-policy.ts';

test('authentication mutations accept only exact same-origin requests', () => {
  const sameOrigin = new Request('https://sf.example/api/auth/sign-in', {
    method: 'POST',
    headers: { origin: 'https://sf.example' },
  });
  const crossOrigin = new Request('https://sf.example/api/auth/sign-in', {
    method: 'POST',
    headers: { origin: 'https://attacker.example' },
  });
  const missingOrigin = new Request('https://sf.example/api/auth/sign-in', {
    method: 'POST',
  });

  assert.equal(isSameOriginAuthRequest(sameOrigin), true);
  assert.equal(isSameOriginAuthRequest(crossOrigin), false);
  assert.equal(isSameOriginAuthRequest(missingOrigin), false);
});

test('credential endpoints accept browser form media types only', () => {
  const urlEncoded = new Request('https://sf.example/api/auth/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  });
  const multipart = new Request('https://sf.example/api/auth/sign-up', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=sf-boundary' },
  });
  const json = new Request('https://sf.example/api/auth/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
  const missing = new Request('https://sf.example/api/auth/sign-in', {
    method: 'POST',
  });

  assert.equal(isSupportedAuthFormRequest(urlEncoded), true);
  assert.equal(isSupportedAuthFormRequest(multipart), true);
  assert.equal(isSupportedAuthFormRequest(json), false);
  assert.equal(isSupportedAuthFormRequest(missing), false);
});

test('protected auth guard distinguishes missing and invalid sessions', () => {
  assert.equal(
    getAuthRequiredRedirect({ hadSessionCookie: false, session: null }),
    '/sign-in?error=required',
  );
  assert.equal(
    getAuthRequiredRedirect({ hadSessionCookie: true, session: null }),
    '/sign-in?error=session',
  );
  assert.equal(
    getAuthRequiredRedirect({ hadSessionCookie: true, session: { userId: 'active' } }),
    null,
  );
});
