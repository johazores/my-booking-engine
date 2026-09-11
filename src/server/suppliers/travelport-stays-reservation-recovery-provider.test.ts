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
const PROPERTY_REFERENCE = Buffer.from(JSON.stringify({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  authority: 'TVPT',
}), 'utf8').toString('base64url');

function recoveryRequest(providerReservationReference = 'D6VBHL', requestCorrelationId = REQUEST_CORRELATION_ID) {
  return {
    providerReservationReference,
    requestCorrelationId,
    expectedReservation: {
      supplierPropertyReference: PROPERTY_REFERENCE,
      arrivalDateLocal: '2026-10-10',
      departureDateLocal: '2026-10-12',
      rooms: 1,
      adults: 1,
      childAges: [8],
    },
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function reservationResponse(input: {
  locator?: string;
  travelportStatus?: string;
  supplierLocatorType?: string;
  supplierStatus?: string;
  chainCode?: string;
  propertyCode?: string;
  arrivalDateLocal?: string;
  departureDateLocal?: string;
  rooms?: number;
  guests?: number;
} = {}) {
  return {
    ReservationResponse: {
      Reservation: {
        Offer: [{
          '@type': 'Offer',
          id: 'O1',
          passiveOfferInd: false,
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: input.rooms ?? 1,
            guests: input.guests ?? 2,
            PropertyKey: {
              chainCode: input.chainCode ?? 'HI',
              propertyCode: input.propertyCode ?? 'ABC12',
            },
            DateRange: {
              start: input.arrivalDateLocal ?? '2026-10-10',
              end: input.departureDateLocal ?? '2026-10-12',
            },
          }],
        }],
        Receipt: [
          {
            OfferRef: ['O1'],
            Confirmation: {
              Locator: {
                value: '80073065',
                locatorType: input.supplierLocatorType ?? 'Confirmation Number',
                sourceContext: 'Supplier',
              },
              OfferStatus: { Status: input.supplierStatus ?? 'Confirmed' },
            },
          },
          {
            Confirmation: {
              Locator: { value: input.locator ?? 'D6VBHL', locatorType: 'PNR Locator', sourceContext: 'Travelport' },
              OfferStatus: { Status: input.travelportStatus ?? 'Confirmed' },
            },
          },
        ],
      },
      traceId: 'trace-123',
    },
  };
}

function isInvalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

test('Travelport recovery retrieves the exact durable active reservation identity with durable outbound correlation', async () => {
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

test('Travelport recovery rejects normalized or control-bearing cache keys before provider I/O', () => {
  for (const cacheKey of [
    ' recover-cache',
    'recover-cache ',
    'recover\tcache',
    'recover\u0000cache',
    'recover\u001fcache',
    'recover\u007fcache',
  ]) {
    assert.throws(
      () => new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey }),
      isInvalidRequest,
      cacheKey,
    );
  }
});

test('Travelport recovery does not promote explicit supplier cancellation evidence to FOUND', async () => {
  const fetchImpl = (async (url) => {
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token-cancelled', expires_in: 86400 });
    return jsonResponse(reservationResponse({ supplierLocatorType: 'Cancellation Number', supplierStatus: 'Cancelled' }));
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-cancelled', fetchImpl });

  await assert.rejects(
    provider.retrieveReservation(recoveryRequest()),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Travelport recovery requires active confirmed provider and supplier confirmation receipt state', async () => {
  const cases = [
    ...['Pending', 'Rejected', 'Cancelled'].map((travelportStatus) => ({
      name: `provider-${travelportStatus}`,
      response: reservationResponse({ travelportStatus }),
    })),
    ...['Pending', 'Rejected', 'Cancelled'].map((supplierStatus) => ({
      name: `supplier-${supplierStatus}`,
      response: reservationResponse({ supplierStatus }),
    })),
  ];

  for (const current of cases) {
    const fetchImpl = (async (url) => {
      if (String(url).includes('/oauth/token')) {
        return jsonResponse({ access_token: `token-${current.name}`, expires_in: 86400 });
      }
      return jsonResponse(current.response);
    }) as typeof fetch;
    const provider = new TravelportStaysReservationRecoveryProvider({
      credentials,
      cacheKey: `recover-status-${current.name}`,
      fetchImpl,
    });
    await assert.rejects(
      provider.retrieveReservation(recoveryRequest()),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('Travelport recovery fails closed when the known locator does not match the durable property, stay, room, or guest request', async () => {
  for (const [name, mismatch] of Object.entries({
    property: { propertyCode: 'OTHER' },
    chain: { chainCode: 'XX' },
    arrival: { arrivalDateLocal: '2026-10-11' },
    departure: { departureDateLocal: '2026-10-13' },
    rooms: { rooms: 2 },
    guests: { guests: 3 },
  })) {
    const fetchImpl = (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: `token-${name}`, expires_in: 86400 });
      return jsonResponse(reservationResponse(mismatch));
    }) as typeof fetch;
    const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: `recover-identity-${name}`, fetchImpl });
    await assert.rejects(
      provider.retrieveReservation(recoveryRequest()),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('Travelport recovery does not treat an undocumented generic HTTP 404 as authoritative NOT_FOUND evidence', async () => {
  const fetchImpl = (async (url) => {
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
    return jsonResponse({}, 404);
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-missing', fetchImpl });
  await assert.rejects(
    provider.retrieveReservation(recoveryRequest()),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('Travelport recovery fails closed when provider truth returns another Travelport locator', async () => {
  const fetchImpl = (async (url) => {
    if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token', expires_in: 86400 });
    return jsonResponse(reservationResponse({ locator: 'OTHER1' }));
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

test('Travelport recovery rejects unsafe request authority and reservation expectation before provider transport', async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({});
  }) as typeof fetch;
  const provider = new TravelportStaysReservationRecoveryProvider({ credentials, cacheKey: 'recover-input', fetchImpl });

  for (const reference of [
    ' D6VBHL',
    'D6VBHL ',
    'D6V\nBHL',
    'D6V\tBHL',
    'D6V\u0000BHL',
    'D6V\u001fBHL',
    'D6V\u007fBHL',
  ]) {
    await assert.rejects(provider.retrieveReservation(recoveryRequest(reference)), isInvalidRequest, reference);
  }

  for (const requestCorrelationId of [
    ` ${REQUEST_CORRELATION_ID}`,
    `${REQUEST_CORRELATION_ID} `,
    'bad\ncorrelation',
    'bad\tcorrelation',
    'bad\u0000correlation',
    'bad\u001fcorrelation',
    'bad\u007fcorrelation',
  ]) {
    await assert.rejects(
      provider.retrieveReservation(recoveryRequest('D6VBHL', requestCorrelationId)),
      isInvalidRequest,
      requestCorrelationId,
    );
  }

  await assert.rejects(provider.retrieveReservation({
    ...recoveryRequest(),
    expectedReservation: { ...recoveryRequest().expectedReservation, supplierPropertyReference: 'not-a-reference' },
  }));
  await assert.rejects(provider.retrieveReservation({
    ...recoveryRequest(),
    expectedReservation: { ...recoveryRequest().expectedReservation, rooms: 2 },
  }));
  assert.equal(calls, 0);
});
