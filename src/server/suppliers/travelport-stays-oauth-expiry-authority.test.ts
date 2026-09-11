import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysReferenceAuthorityFetch } from './travelport-stays-provider.ts';

const OAUTH_URL = 'https://auth.pp.travelport.net/oauth/token';

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function oauthFetch(payload: unknown) {
  return createTravelportStaysReferenceAuthorityFetch(
    (async () => jsonResponse(payload)) as typeof fetch,
  );
}

test('Travelport OAuth expiry authority rejects values that require coercion or normalization', async () => {
  const invalidExpiries: readonly unknown[] = [
    ' 3600',
    '3600 ',
    '03600',
    '3.6e3',
    '3600.0',
    '3600\t',
    0,
    -1,
    86_401,
    1.5,
    null,
  ];

  for (const expiresIn of invalidExpiries) {
    await assert.rejects(
      oauthFetch({ access_token: 'token', expires_in: expiresIn })(OAUTH_URL),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('Travelport OAuth expiry authority accepts exact positive lifetimes at or below the documented 24-hour boundary', async () => {
  for (const expiresIn of [1, 3_600, 86_400, '1', '3600', '86400'] as const) {
    const response = await oauthFetch({ access_token: 'token', expires_in: expiresIn })(OAUTH_URL);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { access_token: 'token', expires_in: expiresIn });
  }
});

test('Travelport OAuth expiry authority preserves the documented fallback when expires_in is omitted', async () => {
  const response = await oauthFetch({ access_token: 'token' })(OAUTH_URL);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { access_token: 'token' });
});
