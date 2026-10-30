import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTH_FORM_MAX_BYTES,
  applyAuthResponseNoStore,
  getAuthRequiredRedirect,
  getAuthRateLimitMessage,
  isSameOriginAuthRequest,
  isSupportedAuthFormRequest,
} from './auth-http-policy.ts';

test('credential form ingress uses a smaller bounded body budget', () => {
  assert.equal(AUTH_FORM_MAX_BYTES, 8192);
});

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

test('authentication responses are no-store for redirects and errors', () => {
  for (const response of [
    new Response(null, { status: 303, headers: { Location: '/account' } }),
    new Response('Forbidden', { status: 403 }),
    new Response('Unavailable', { status: 500, headers: { 'Cache-Control': 'public, max-age=600' } }),
  ]) {
    assert.equal(applyAuthResponseNoStore(response), response);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
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

test('authentication rate-limit feedback shows bounded database wait without trusting query input', () => {
  assert.equal(getAuthRateLimitMessage('1'), 'Too many attempts. Please wait about 1 minute before trying again.');
  assert.equal(getAuthRateLimitMessage('60'), 'Too many attempts. Please wait about 1 minute before trying again.');
  assert.equal(getAuthRateLimitMessage('61'), 'Too many attempts. Please wait about 2 minutes before trying again.');
  assert.equal(getAuthRateLimitMessage('900'), 'Too many attempts. Please wait about 15 minutes before trying again.');
  for (const invalid of [undefined, null, '', '0', '901', '-1', '1.5', '1e2', '01', ' 60 ', ['60'], 60]) {
    assert.equal(getAuthRateLimitMessage(invalid), 'Too many attempts. Please wait before trying again.');
  }
});
