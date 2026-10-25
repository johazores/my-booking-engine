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

const propertyReference = Buffer.from(JSON.stringify({
  chainCode: 'HI', propertyCode: 'ABC12', authority: 'TVPT',
})).toString('base64url');
const offerReference = Buffer.from(JSON.stringify({
  chainCode: 'HI', propertyCode: 'ABC12', propertyAuthority: 'TVPT',
  rateValue: 'rate-key-1', rateAuthority: 'TVPT',
})).toString('base64url');

function changingInput(values: Record<string, unknown>) {
  const reads = new Map<string, number>();
  const input = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(input, key, {
      get() {
        const count = (reads.get(key) ?? 0) + 1;
        reads.set(key, count);
        if (count > 1) throw new Error(`Unexpected second caller read: ${key}`);
        return value;
      },
    });
  }
  return { input, reads, keys: Object.keys(values) };
}

const stay = {
  checkInDateLocal: '2026-10-10',
  checkOutDateLocal: '2026-10-12',
  rooms: 1,
  adults: 2,
  childAges: [7],
};
const offer = {
  ...stay,
  supplierPropertyReference: propertyReference,
  currency: 'USD',
};
const revalidation = {
  ...offer,
  supplierOfferReference: offerReference,
  expectedTotalMinor: 14765n,
  expectedOfferFingerprint: 'a'.repeat(64),
};

test('direct SearchComplete and Rules cores never reread caller authority across provider I/O', async () => {
  let networkCalls = 0;
  const fetchImpl = (async () => {
    networkCalls += 1;
    throw new Error('No network in this regression');
  }) as typeof fetch;
  const search = new TravelportStaysProvider({
    credentials, cacheKey: 'direct-scalar-search', fetchImpl,
  });
  const rules = new TravelportStaysBookingTermsProvider({
    credentials, cacheKey: 'direct-scalar-rules', fetchImpl,
    pricingProvider: {} as never,
  });
  const scenarios: ReadonlyArray<Readonly<{
    name: string;
    values: Record<string, unknown>;
    run: (input: never) => Promise<unknown>;
  }>> = [
    { name: 'city search', values: { ...stay, cityIataCode: 'SYD', radiusKm: 30 }, run: (input) => search.searchProperties(input) },
    { name: 'search page', values: { pageToken: 'next-page', pageNumber: 2 }, run: (input) => search.searchPropertiesPage(input) },
    { name: 'exact offer', values: offer, run: (input) => search.searchPropertyOffers(input) },
    { name: 'offer revalidation', values: revalidation, run: (input) => search.revalidatePropertyOffer(input) },
    { name: 'Rules review', values: revalidation, run: (input) => rules.retrieveBookingTerms(input) },
  ];

  for (const scenario of scenarios) {
    const { input, reads, keys } = changingInput(scenario.values);
    await assert.rejects(
      scenario.run(input as never),
      (error: unknown) => error instanceof HospitalitySupplierProviderError
        && error.code === 'PROVIDER_UNAVAILABLE',
      scenario.name,
    );
    for (const key of keys) {
      assert.equal(reads.get(key), 1, `${scenario.name}: ${key} must be read once`);
    }
  }
  assert.equal(networkCalls, scenarios.length);
});

test('direct Availability core forwards a frozen single-read snapshot to Rules review', async () => {
  let forwarded: Record<string, unknown> | null = null;
  const provider = new TravelportStaysReservationAuthorityProvider({
    credentials,
    cacheKey: 'direct-scalar-availability',
    fetchImpl: (async () => { throw new Error('Network must not be reached'); }) as typeof fetch,
    bookingTermsProvider: {
      async retrieveBookingTerms(input: Record<string, unknown>) {
        forwarded = input;
        throw new Error('Stop after Rules handoff');
      },
    } as never,
  });
  const values = { ...revalidation, expectedTermsFingerprint: 'b'.repeat(64) };
  const { input, reads, keys } = changingInput(values);
  await assert.rejects(provider.verifyReservationAuthority(input as never), /Stop after Rules handoff/);
  for (const key of keys) assert.equal(reads.get(key), 1, `${key} must be read once`);
  assert.ok(forwarded);
  assert.ok(Object.isFrozen(forwarded));
  assert.ok(Object.isFrozen(forwarded.childAges));
  assert.deepEqual(forwarded.childAges, [7]);
});
