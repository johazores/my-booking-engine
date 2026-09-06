import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { TravelportStaysReservationRecoveryProvider } from './travelport-stays-reservation-recovery-provider.ts';
import { normalizeTravelportStaysConfiguration } from './travelport-stays-provider.ts';

const credentials = normalizeTravelportStaysConfiguration({
  environment: 'pre-production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessGroup: 'access-group',
}).credentials;

const REQUEST_CORRELATION_ID = '11111111-1111-4111-8111-111111111111';

function recoveryRequest(providerReservationReference = 'D6VBHL', requestCorrelationId = REQUEST_CORRELATION_ID) {
  return { providerReservationReference, requestCorrelationId };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function reservationResponse(locator = 'D6VBHL') {
  return {
    ReservationResponse: {
      Reservation: {
        Receipt: [
          { Confirmation: { Locator: { value: '80073065', sourceContext: 'Supplier' } } },
          { Confirmation: { Locator: { value: locator, sourceContext: 'Travelport' } } },
        ],
      },
      traceId: 'trace-123',
    },
  };
}

test('Travelport recovery retrieves a known aggregator locator with durable outbound correlation', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
    return jsonResponse(reservationResponse());
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-found', fetchImpl });

  const result = await provider.retrieveReservation(recoveryRequest());
  assert.deepEqual(result, {
    status: 'FOUND',
    providerReservationReference: 'D6VBHL',
    supplierConfirmationReference: '80073065',
    providerCorrelationId: 'trace-123',
  });
  const retrieve = requests.find((request) => request.url.includes('/book/reservations/D6VBHL'))!;
  assert.ok(retrieve);
  assert.equal(retrieve.url, 'https://api.pp.travelport.net/11/hotel/book/reservations/D6VBHL');
  assert.equal(retrieve.init?.method, 'GET');
  assert.equal(retrieve.init?.cache, 'no-store');
  const headers = new Headers(retrieve.init?.headers);
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.get('E2ETrackingID'), `sf-${REQUEST_CORRELATION_ID}`);
  assert.equal(headers.get('TraceId'), REQUEST_CORRELATION_ID);
});

test('Travelport recovery treats an explicit known-locator 404 as NOT_FOUND', async () => {
  const fetchImpl = (async (url) => {
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
    return jsonResponse({}, 404);
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-missing', fetchImpl });
  assert.deepEqual(await provider.retrieveReservation(recoveryRequest()), {
    status: 'NOT_FOUND',
    providerReservationReference: 'D6VBHL',
    providerCorrelationId: null,
  });
});

test('Travelport recovery fails closed when provider truth returns another Travelport locator', async () => {
  const fetchImpl = (async (url) => {
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
    return jsonResponse(reservationResponse('OTHER1'));
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-mismatch', fetchImpl });
  await assert.rejects(
    provider.retrieveReservation(recoveryRequest()),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Travelport recovery normalizes retryable provider failures and evicts rejected auth tokens', async () => {
  for (const [status, expected] of [[429, 'RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE']] as const) {
    const fetchImpl = (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: `token-${status}`, expires_in: 86400 });
      return jsonResponse({}, status);
    }) as typeof fetch;
    const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: `recover-${status}`, fetchImpl });
    await assert.rejects(
      provider.retrieveReservation(recoveryRequest()),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === expected && error.retryable,
    );
  }

  let authCalls = 0;
  const fetchImpl = (async (url) => {
    if (String(url).includes('/oauth/token')) {
      authCalls += 1;
      return jsonResponse({ access_token: `token-auth-${authCalls}`, expires_in: 86400 });
    }
    return jsonResponse({}, 401);
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-auth', fetchImpl });
  await assert.rejects(provider.retrieveReservation(recoveryRequest()));
  await assert.rejects(provider.retrieveReservation(recoveryRequest()));
  assert.equal(authCalls, 2);
});

test('Travelport recovery rejects unsafe locator and request-correlation input before provider transport', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-input', fetchImpl });
  await assert.rejects(provider.retrieveReservation(recoveryRequest('bad\nlocator')));
  await assert.rejects(provider.retrieveReservation(recoveryRequest('D6VBHL', 'bad\ncorrelation')));
  assert.equal(calls, 0);
});
