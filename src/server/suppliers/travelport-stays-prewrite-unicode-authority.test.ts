import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysPreWriteUnicodeAuthorityFetch } from './travelport-stays-json-unicode-authority.ts';

const endpoints = [
  'https://api.pp.travelport.net/12/hotel/search/searchcomplete',
  'https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest',
  'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality',
  'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality/page-token?pageNumber=2',
] as const;

function failureCode(code: 'INVALID_REQUEST' | 'INVALID_RESPONSE') {
  return (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === code;
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('pre-write Travelport JSON rejects ill-formed request strings before provider I/O', async () => {
  for (const endpoint of endpoints.slice(0, 3)) {
    let calls = 0;
    const guardedFetch = createTravelportStaysPreWriteUnicodeAuthorityFetch(async () => {
      calls += 1;
      return response({ ok: true });
    });

    await assert.rejects(
      () => guardedFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ machineAuthority: 'rate-\uD800-value' }),
      }),
      failureCode('INVALID_REQUEST'),
    );
    assert.equal(calls, 0);
  }
});

test('pre-write Travelport JSON rejects ill-formed success-response values and keys', async () => {
  for (const body of [
    { machineAuthority: 'locator-\uDC00-value' },
    JSON.parse('{"machine\\ud800key":"value"}') as unknown,
  ]) {
    let calls = 0;
    const guardedFetch = createTravelportStaysPreWriteUnicodeAuthorityFetch(async () => {
      calls += 1;
      return response(body);
    });

    await assert.rejects(
      () => guardedFetch(endpoints[3], { method: 'GET' }),
      failureCode('INVALID_RESPONSE'),
    );
    assert.equal(calls, 1);
  }
});

test('well-formed non-BMP Travelport JSON remains accepted', async () => {
  for (const endpoint of endpoints) {
    const guardedFetch = createTravelportStaysPreWriteUnicodeAuthorityFetch(async () => response({
      providerText: 'valid 🚀 authority',
      nested: [{ value: 'rate-🚀' }],
    }));

    const result = await guardedFetch(endpoint, {
      method: endpoint.includes('?pageNumber=') ? 'GET' : 'POST',
      ...(endpoint.includes('?pageNumber=') ? {} : {
        body: JSON.stringify({ requestText: 'guest 🚀' }),
      }),
    });
    assert.equal(result.status, 200);
  }
});

test('non-target and non-success traffic is not promoted into Unicode authority', async () => {
  const malformed = { providerText: 'ignored \uD800 evidence' };
  const guardedFetch = createTravelportStaysPreWriteUnicodeAuthorityFetch(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    return url.includes('searchcomplete') ? response(malformed, 429) : response(malformed);
  });

  const nonTarget = await guardedFetch('https://example.com/11/hotel/rules/offershospitality/buildfromrequest');
  assert.equal(nonTarget.status, 200);

  const nonSuccess = await guardedFetch(endpoints[0], { method: 'POST', body: '{}' });
  assert.equal(nonSuccess.status, 429);
});
