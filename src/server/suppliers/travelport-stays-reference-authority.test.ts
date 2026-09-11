import assert from 'node:assert/strict';
import test from 'node:test';

import type { HospitalitySupplierPricingProvider } from './hospitality-supplier-provider.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { TravelportStaysBookingTermsProvider } from './travelport-stays-booking-terms-provider.ts';
import {
  assertTravelportStaysPropertyReference,
  normalizeTravelportStaysConfiguration,
  TravelportStaysProvider,
} from './travelport-stays-provider.ts';

const credentials = normalizeTravelportStaysConfiguration({
  environment: 'pre-production',
  username: 'test-user',
  password: 'test-password',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  accessGroup: 'access-group',
}).credentials;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function reference(payload: Readonly<Record<string, string>>) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function noncanonicalBase64urlAlias(canonical: string) {
  const bytes = Buffer.from(canonical, 'base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (const candidate of alphabet) {
    const alias = `${canonical.slice(0, -1)}${candidate}`;
    if (alias !== canonical && Buffer.from(alias, 'base64url').equals(bytes)) return alias;
  }
  throw new Error('Fixture does not have a non-canonical base64url alias.');
}

const propertyReference = reference({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  authority: 'TVPT',
});

const offerReference = reference({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  propertyAuthority: 'TVPT',
  rateValue: 'rate-key-1',
  rateAuthority: 'TVPT',
});

const offerSearchInput = {
  supplierPropertyReference: propertyReference,
  checkInDateLocal: '2026-10-10',
  checkOutDateLocal: '2026-10-12',
  rooms: 1,
  adults: 2,
  currency: 'USD',
} as const;

function offerResponse(rateValue = 'rate-key-1', bookingCode = 'KHATHR') {
  return {
    pagination: { page: 1, pageSize: 1, totalPages: 1, totalItems: 1 },
    hotelsResponse: {
      propertyItems: [{
        name: 'Hotel One',
        chainCode: 'HI',
        propertyCode: 'ABC12',
        availability: true,
        roomTypes: [{
          shortRoomDescription: 'King room',
          rates: [{
            rateKey: { value: rateValue, authority: 'TVPT' },
            bookingCode,
            quantity: 1,
            price: {
              currencyCode: 'USD',
              base: { amount: 100 },
              totalTaxes: { amount: 10 },
              totalPrice: { amount: 110 },
            },
          }],
        }],
      }],
    },
  };
}

test('supplier property references reject non-canonical base64url aliases', () => {
  const canonical = reference({
    chainCode: 'HI',
    propertyCode: 'ABC123',
    authority: 'TVPT',
  });
  const alias = noncanonicalBase64urlAlias(canonical);
  assert.throws(
    () => assertTravelportStaysPropertyReference(alias),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
});

test('response authority fetch rejects padded SearchComplete and Rules machine evidence before core normalization', async () => {
  const {
    createTravelportStaysReferenceAuthorityFetch,
  } = await import('./travelport-stays-provider.ts');

  const paddedSearch = createTravelportStaysReferenceAuthorityFetch(
    (async () => jsonResponse({
      pagination: { page: 1, pageSize: 1, totalPages: 1, totalItems: 1 },
      hotelsResponse: {
        propertyItems: [{
          name: 'Hotel One',
          chainCode: ' HI',
          propertyCode: 'ABC12',
          roomTypes: [],
        }],
      },
    })) as typeof fetch,
  );
  await assert.rejects(
    paddedSearch('https://api.pp.travelport.net/12/hotel/search/searchcomplete'),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );

  const paddedRules = createTravelportStaysReferenceAuthorityFetch(
    (async () => jsonResponse({
      OfferHospitalityResponse: {
        Offer: {
          TermsAndConditionsFull: [{ AcceptedCreditCard: [{ value: ' VI' }] }],
        },
      },
    })) as typeof fetch,
  );
  await assert.rejects(
    paddedRules('https://api.pp.travelport.net/11/hotel/rules/offershospitality/buildfromrequest'),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('SearchComplete rejects provider property identity that only becomes valid after trimming', async () => {
  const provider = new TravelportStaysProvider({
    credentials,
    cacheKey: 'reference-authority:property-response',
    fetchImpl: (async (url) => String(url).includes('/oauth/token')
      ? jsonResponse({ access_token: 'token' })
      : jsonResponse({
        pagination: { page: 1, pageSize: 1, totalPages: 1, totalItems: 1 },
        hotelsResponse: {
          propertyItems: [{
            name: 'Hotel One',
            chainCode: ' HI',
            propertyCode: 'ABC12',
            availability: true,
          }],
        },
      })) as typeof fetch,
  });

  await assert.rejects(
    provider.searchProperties({
      cityIataCode: 'SYD',
      checkInDateLocal: '2026-10-10',
      checkOutDateLocal: '2026-10-12',
      rooms: 1,
      adults: 2,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('offer pricing rejects provider rate identity with padding or ASCII controls', async () => {
  for (const rateValue of [' rate-key-1', 'rate-key-1 ', 'rate\tkey', 'rate\u0000key', 'rate\u007fkey']) {
    const provider = new TravelportStaysProvider({
      credentials,
      cacheKey: `reference-authority:rate:${Buffer.from(rateValue).toString('hex')}`,
      fetchImpl: (async (url) => String(url).includes('/oauth/token')
        ? jsonResponse({ access_token: 'token' })
        : jsonResponse(offerResponse(rateValue))) as typeof fetch,
    });
    await assert.rejects(
      provider.searchPropertyOffers(offerSearchInput),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }
});

test('pricing input rejects decoded property identity that relies on trimming', async () => {
  let calls = 0;
  const provider = new TravelportStaysProvider({
    credentials,
    cacheKey: 'reference-authority:property-request',
    fetchImpl: (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });

  const paddedReference = reference({
    chainCode: ' HI',
    propertyCode: 'ABC12',
    authority: 'TVPT',
  });
  await assert.rejects(
    provider.searchPropertyOffers({ ...offerSearchInput, supplierPropertyReference: paddedReference }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  assert.equal(calls, 0);
});

test('offer revalidation rejects padded decoded rate identity before provider transport', async () => {
  let calls = 0;
  const provider = new TravelportStaysProvider({
    credentials,
    cacheKey: 'reference-authority:offer-request',
    fetchImpl: (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });
  const supplierOfferReference = reference({
    chainCode: 'HI',
    propertyCode: 'ABC12',
    propertyAuthority: 'TVPT',
    rateValue: ' rate-key-1',
    rateAuthority: 'TVPT',
  });

  await assert.rejects(
    provider.revalidatePropertyOffer({
      ...offerSearchInput,
      supplierOfferReference,
      expectedTotalMinor: 11000n,
      expectedOfferFingerprint: 'a'.repeat(64),
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  assert.equal(calls, 0);
});

test('pagination input rejects ASCII controls before provider transport', async () => {
  let calls = 0;
  const provider = new TravelportStaysProvider({
    credentials,
    cacheKey: 'reference-authority:pagination',
    fetchImpl: (async () => {
      calls += 1;
      return jsonResponse({});
    }) as typeof fetch,
  });

  await assert.rejects(
    provider.searchPropertiesPage({ pageToken: 'page\ttoken', pageNumber: 2 }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST',
  );
  assert.equal(calls, 0);
});

test('Rules bridge rejects a booking code that only becomes valid after trimming', async () => {
  let calls = 0;
  const pricingProvider = {
    code: 'unused',
    async searchProperties() { throw new Error('not used'); },
    async searchPropertiesPage() { throw new Error('not used'); },
    async searchPropertyOffers() { throw new Error('not used'); },
    async revalidatePropertyOffer() { throw new Error('not used'); },
  } as unknown as HospitalitySupplierPricingProvider;

  const provider = new TravelportStaysBookingTermsProvider({
    credentials,
    cacheKey: 'reference-authority:rules-bridge',
    pricingProvider,
    fetchImpl: (async (url) => {
      calls += 1;
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token' });
      return jsonResponse(offerResponse('rate-key-1', ' KHATHR'));
    }) as typeof fetch,
  });

  await assert.rejects(
    provider.retrieveBookingTerms({
      ...offerSearchInput,
      supplierOfferReference: offerReference,
      expectedTotalMinor: 11000n,
      expectedOfferFingerprint: 'a'.repeat(64),
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
  assert.equal(calls, 2);
});

test('Rules response rejects padded accepted-card authority before terms can be reviewed', async () => {
  let hotelCalls = 0;
  const pricingProvider = {
    code: 'unused',
    async searchProperties() { throw new Error('not used'); },
    async searchPropertiesPage() { throw new Error('not used'); },
    async searchPropertyOffers() { throw new Error('not used'); },
    async revalidatePropertyOffer() { throw new Error('not used'); },
  } as unknown as HospitalitySupplierPricingProvider;

  const provider = new TravelportStaysBookingTermsProvider({
    credentials,
    cacheKey: 'reference-authority:rules-card',
    pricingProvider,
    fetchImpl: (async (url) => {
      if (String(url).includes('/oauth/token')) return jsonResponse({ access_token: 'token' });
      hotelCalls += 1;
      if (String(url).includes('/search/searchcomplete')) return jsonResponse(offerResponse());
      return jsonResponse({
        OfferHospitalityResponse: {
          Offer: {
            Product: [{
              bookingCode: 'KHATHR',
              PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
              DateRange: { start: '2026-10-10', end: '2026-10-12' },
            }],
            Price: { CurrencyCode: { value: 'USD' }, TotalPrice: 110 },
            TermsAndConditionsFull: [{
              AcceptedCreditCard: [{ value: ' VI' }],
            }],
          },
        },
      });
    }) as typeof fetch,
  });

  await assert.rejects(
    provider.retrieveBookingTerms({
      ...offerSearchInput,
      supplierOfferReference: offerReference,
      expectedTotalMinor: 11000n,
      expectedOfferFingerprint: 'a'.repeat(64),
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
  assert.equal(hotelCalls, 2);
});
