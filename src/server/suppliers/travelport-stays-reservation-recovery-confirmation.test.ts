import assert from 'node:assert/strict';
import test from 'node:test';

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

const PROPERTY_REFERENCE = Buffer.from(JSON.stringify({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  authority: 'TVPT',
}), 'utf8').toString('base64url');

function activeReservationWithoutSupplierConfirmation() {
  return {
    ReservationResponse: {
      Reservation: {
        Offer: [{
          '@type': 'Offer',
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [{
          Confirmation: {
            Locator: { value: 'D6VBHL', locatorType: 'PNR Locator', sourceContext: 'Travelport' },
            OfferStatus: { Status: 'Confirmed' },
          },
        }],
      },
      traceId: 'trace-missing-supplier',
    },
  };
}

test('Travelport recovery marks supplier confirmation as required for provider-neutral FOUND settlement', async () => {
  const fetchImpl = (async (url: RequestInfo | URL) => {
    if (String(url).includes('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 86400 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(activeReservationWithoutSupplierConfirmation()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const provider = new TravelportStaysReservationRecoveryProvider({
    credentials,
    cacheKey: 'recover-missing-supplier-confirmation',
    fetchImpl,
  });
  assert.equal(provider.requiresSupplierConfirmationForFound, true);

  const result = await provider.retrieveReservation({
    providerReservationReference: 'D6VBHL',
    requestCorrelationId: '11111111-1111-4111-8111-111111111111',
    expectedReservation: {
      supplierPropertyReference: PROPERTY_REFERENCE,
      arrivalDateLocal: '2026-10-10',
      departureDateLocal: '2026-10-12',
      rooms: 1,
      adults: 1,
      childAges: [8],
    },
  });
  assert.equal(result.status, 'FOUND');
  if (result.status === 'FOUND') assert.equal(result.supplierConfirmationReference, null);
});
