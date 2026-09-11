import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { createTravelportStaysReservationAuthorityResponseFetch } from './travelport-stays-reservation-authority-boundary.ts';

const SEARCH_URL = 'https://api.pp.travelport.net/12/hotel/search/searchcomplete';
const AVAILABILITY_URL = 'https://api.pp.travelport.net/11/hotel/availability/catalogofferingshospitality';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function guarded(payload: unknown, url = SEARCH_URL) {
  const fetchImpl = (async () => jsonResponse(payload)) as typeof fetch;
  return createTravelportStaysReservationAuthorityResponseFetch(fetchImpl)(url, { method: 'POST' });
}

function isInvalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

function searchComplete(): any {
  return {
    pagination: {
      page: 1,
      pageSize: 1,
      totalPages: 1,
      totalItems: 1,
    },
    hotelsResponse: {
      propertyItems: [{
        chainCode: 'HI',
        propertyCode: 'ABC12',
        roomTypes: [{
          rates: [{
            rateKey: { value: 'rate-key-1', authority: 'TVPT' },
            bookingCode: 'KHATHR',
            rateCodeInfo: {
              rateCode: 'THR',
              ratePlanID: 'THORPREFERRED',
              rateCategory: 'MultiLevel/Negotiated/Secure',
            },
            price: {
              currencyCode: 'USD',
              totalPrice: { amount: '147.65' },
            },
          }],
        }],
      }],
    },
  };
}

function availability(): any {
  return {
    CatalogOfferingsHospitalityResponse: {
      CatalogOfferings: {
        totalCatalogOffering: 1,
        catalogOfferingPerPage: 1,
        numberOfPages: 1,
        CatalogOffering: [{
          id: 'offer-1',
          Identifier: { value: 'offer-1', authority: 'TVPT' },
          TermsAndConditions: {
            ProductRateCodeInfo: {
              RateCodeInfo: {
                value: 'THR',
                rateID: 'THORPREFERRED',
                rateCategory: 'MultiLevel/Negotiated/Secure',
              },
            },
          },
          ProductOptions: [{
            Product: [{
              bookingCode: 'KHATHR',
              PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
              DateRange: { start: '2026-10-10', end: '2026-10-12' },
            }],
          }],
        }],
      },
    },
  };
}

test('canonical reservation authority structural evidence remains accepted', async () => {
  assert.equal((await guarded(searchComplete())).ok, true);
  assert.equal((await guarded(availability(), AVAILABILITY_URL)).ok, true);

  const emptyAvailability = {
    CatalogOfferingsHospitalityResponse: {
      CatalogOfferings: {
        totalCatalogOffering: 0,
        catalogOfferingPerPage: 0,
        numberOfPages: 1,
      },
    },
  };
  assert.equal((await guarded(emptyAvailability, AVAILABILITY_URL)).ok, true);
});

test('SearchComplete present malformed collections and nested authority objects fail closed', async () => {
  const mutations: Array<(payload: any) => void> = [
    (payload) => { payload.hotelsResponse.propertyItems[0] = 'property'; },
    (payload) => { payload.hotelsResponse.propertyItems[0].roomTypes = {}; },
    (payload) => { payload.hotelsResponse.propertyItems[0].roomTypes[0].rates[0] = 'rate'; },
    (payload) => { payload.hotelsResponse.propertyItems[0].roomTypes[0].rates[0].rateKey = 'rate-key'; },
    (payload) => { payload.hotelsResponse.propertyItems[0].roomTypes[0].rates[0].rateCodeInfo = []; },
    (payload) => { payload.hotelsResponse.propertyItems[0].roomTypes[0].rates[0].price = '147.65'; },
    (payload) => { payload.hotelsResponse.propertyItems[0].roomTypes[0].rates[0].price.totalPrice = '147.65'; },
    (payload) => { payload.hotelsResponse.propertyItems[0].roomTypes[0].rates[0].price.totalPrice.amount = -1; },
  ];

  for (const mutate of mutations) {
    const payload = searchComplete();
    mutate(payload);
    await assert.rejects(() => guarded(payload), isInvalidResponse);
  }
});

test('Availability present malformed collections, items, and nested authority objects fail closed', async () => {
  const mutations: Array<(payload: any) => void> = [
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering = {}; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0] = 'offering'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].Identifier = 'offer-1'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].TermsAndConditions = 'terms'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].TermsAndConditions.ProductRateCodeInfo = 'rate-info'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].TermsAndConditions.ProductRateCodeInfo.RateCodeInfo = 'rate'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].ProductOptions = {}; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].ProductOptions[0] = 'option'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].ProductOptions[0].Product = {}; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].ProductOptions[0].Product[0] = 'product'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].ProductOptions[0].Product[0].PropertyKey = 'property'; },
    (payload) => { payload.CatalogOfferingsHospitalityResponse.CatalogOfferings.CatalogOffering[0].ProductOptions[0].Product[0].DateRange = 'dates'; },
  ];

  for (const mutate of mutations) {
    const payload = availability();
    mutate(payload);
    await assert.rejects(() => guarded(payload, AVAILABILITY_URL), isInvalidResponse);
  }
});
