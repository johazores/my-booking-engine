import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { TravelportStaysProvider, normalizeTravelportStaysConfiguration } from './travelport-stays-provider-core.ts';
import { TravelportStaysBookingTermsProvider } from './travelport-stays-booking-terms-provider-core.ts';
import { TravelportStaysReservationAuthorityProvider } from './travelport-stays-reservation-authority-provider-core.ts';

const credentials = normalizeTravelportStaysConfiguration({
  environment: 'pre-production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  accessGroup: 'test-access-group',
}).credentials;

const property = Buffer.from(JSON.stringify({
  chainCode: 'HI', propertyCode: 'ABC12', authority: 'TVPT',
})).toString('base64url');
const offer = Buffer.from(JSON.stringify({
  chainCode: 'HI', propertyCode: 'ABC12', propertyAuthority: 'TVPT',
  rateValue: 'rate-key-1', rateAuthority: 'TVPT',
})).toString('base64url');
const stay = {
  checkInDateLocal: '2026-10-10',
  checkOutDateLocal: '2026-10-12',
  rooms: 1,
  adults: 1,
};
const selectedOffer = {
  supplierPropertyReference: property,
  supplierOfferReference: offer,
  currency: 'USD',
  expectedTotalMinor: 14765n,
  expectedOfferFingerprint: 'a'.repeat(64),
};

test('all three Travelport compatibility cores reject hostile child-age inputs before network I/O', async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be reached');
  };
  const search = new TravelportStaysProvider({
    credentials, cacheKey: 'child-ages-search', fetchImpl,
  });
  const rules = new TravelportStaysBookingTermsProvider({
    credentials, cacheKey: 'child-ages-rules', fetchImpl,
    pricingProvider: {} as never,
  });
  const availability = new TravelportStaysReservationAuthorityProvider({
    credentials, cacheKey: 'child-ages-availability', fetchImpl,
    bookingTermsProvider: {} as never,
  });
  const calls: ReadonlyArray<Readonly<{
    name: string;
    run: (childAges: unknown) => Promise<unknown>;
  }>> = [
    {
      name: 'SearchComplete',
      run: (childAges) => search.searchProperties({
        ...stay, cityIataCode: 'SYD', childAges,
      } as never),
    },
    {
      name: 'Rules',
      run: (childAges) => rules.retrieveBookingTerms({
        ...stay, ...selectedOffer, childAges,
      } as never),
    },
    {
      name: 'Availability',
      run: (childAges) => availability.verifyReservationAuthority({
        ...stay, ...selectedOffer, expectedTermsFingerprint: 'b'.repeat(64), childAges,
      } as never),
    },
  ];

  for (const { name, run } of calls) {
    const oversized = new Array(9);
    Object.defineProperty(oversized, Symbol.iterator, {
      get() { throw new Error('untrusted iterator should never run'); },
    });
    const hostileIndex = [7];
    Object.defineProperty(hostileIndex, '0', {
      get() { throw new Error('sensitive caller exception'); },
    });
    const malformed = { 0: 7, length: 1, [Symbol.iterator]() {
      throw new Error('untrusted iterator should never run');
    } };
    for (const childAges of [oversized, hostileIndex, malformed]) {
      await assert.rejects(
        run(childAges),
        (error: unknown) => error instanceof HospitalitySupplierProviderError
          && error.code === 'INVALID_REQUEST'
          && !error.message.includes('sensitive')
          && !error.message.includes('iterator'),
        name,
      );
    }
  }
  assert.equal(fetchCalls, 0);
});
