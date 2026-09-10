import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  parseTravelportStaysReservationResponse,
  type TravelportStaysReservationRecoveryExpectation,
} from './travelport-stays-reservation-response.ts';

const expectedReservation: TravelportStaysReservationRecoveryExpectation = Object.freeze({
  chainCode: 'HI',
  propertyCode: 'ABC12',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

function supplierReceipt(input: {
  offerRefs?: readonly string[] | null;
  locatorType?: 'Confirmation Number' | 'Cancellation Number';
  status?: 'Confirmed' | 'Cancelled';
  value?: string;
} = {}) {
  const offerRefs = input.offerRefs === undefined ? ['O1'] : input.offerRefs;
  return {
    ...(offerRefs === null ? {} : { OfferRef: [...offerRefs] }),
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: input.value ?? 'SUP-123',
        locatorType: input.locatorType ?? 'Confirmation Number',
        sourceContext: 'Supplier',
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: input.status ?? 'Confirmed',
      },
    },
  };
}

function travelportPnrReceipt(offerRefs: readonly string[] | null = null) {
  return {
    ...(offerRefs === null ? {} : { OfferRef: [...offerRefs] }),
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: 'PNR-123',
        locatorType: 'PNR Locator',
        sourceContext: 'Travelport',
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function response(input: {
  supplier?: Record<string, unknown> | null;
  pnrOfferRefs?: readonly string[] | null;
  extraOffer?: Record<string, unknown> | null;
  extraReceipt?: Record<string, unknown> | null;
} = {}) {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [
          {
            '@type': 'Offer',
            id: 'O1',
            passiveOfferInd: false,
            Product: [{
              '@type': 'ProductHospitality',
              Quantity: 1,
              guests: 2,
              PropertyKey: { chainCode: 'HI', propertyCode: 'ABC12' },
              DateRange: { start: '2026-10-10', end: '2026-10-12' },
            }],
          },
          ...(input.extraOffer ? [input.extraOffer] : []),
        ],
        Receipt: [
          ...(input.supplier === null ? [] : [input.supplier ?? supplierReceipt()]),
          travelportPnrReceipt(input.pnrOfferRefs ?? null),
          ...(input.extraReceipt ? [input.extraReceipt] : []),
        ],
      },
      traceId: 'trace-123',
    },
  };
}

function assertInvalid(fn: () => unknown) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('accepts active-hotel supplier confirmation while preserving unscoped reservation PNR authority', () => {
  const result = parseTravelportStaysReservationResponse(response(), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });
  assert.equal(result.providerReservationReference, 'PNR-123');
  assert.equal(result.supplierConfirmationReference, 'SUP-123');
});

test('rejects Travelport PNR when it is scoped to the active hotel offer instead of reservation level', () => {
  assertInvalid(() => parseTravelportStaysReservationResponse(response({
    pnrOfferRefs: ['O1'],
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }));
});

test('rejects Travelport PNR scoped to another active offer from becoming hotel recovery authority', () => {
  assertInvalid(() => parseTravelportStaysReservationResponse(response({
    pnrOfferRefs: ['O2'],
    extraOffer: {
      '@type': 'Offer',
      id: 'O2',
      passiveOfferInd: false,
      Product: [{ '@type': 'ProductAir' }],
    },
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }));
});

test('rejects supplier confirmation without explicit active-hotel offer ownership', () => {
  assertInvalid(() => parseTravelportStaysReservationResponse(response({
    supplier: supplierReceipt({ offerRefs: null }),
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }));
});

test('rejects supplier confirmation scoped to a different active non-hospitality offer', () => {
  assertInvalid(() => parseTravelportStaysReservationResponse(response({
    supplier: supplierReceipt({ offerRefs: ['O2'] }),
    extraOffer: {
      '@type': 'Offer',
      id: 'O2',
      passiveOfferInd: false,
      Product: [{ '@type': 'ProductAir' }],
    },
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }));
});

test('rejects supplier cancellation evidence outside the active hotel offer', () => {
  for (const supplier of [
    supplierReceipt({
      offerRefs: null,
      locatorType: 'Cancellation Number',
      status: 'Cancelled',
      value: 'CXL-123',
    }),
    supplierReceipt({
      offerRefs: ['O2'],
      locatorType: 'Cancellation Number',
      status: 'Cancelled',
      value: 'CXL-123',
    }),
  ]) {
    assertInvalid(() => parseTravelportStaysReservationResponse(response({
      supplier,
      extraOffer: {
        '@type': 'Offer',
        id: 'O2',
        passiveOfferInd: false,
        Product: [{ '@type': 'ProductAir' }],
      },
    }), {
      expectedProviderReservationReference: 'PNR-123',
      expectedReservation,
    }));
  }
});

test('active-hotel supplier cancellation still reaches the active lifecycle rejection', () => {
  assertInvalid(() => parseTravelportStaysReservationResponse(response({
    supplier: supplierReceipt({
      offerRefs: ['O1'],
      locatorType: 'Cancellation Number',
      status: 'Cancelled',
      value: 'CXL-123',
    }),
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }));
});

test('rejects supplier confirmation shared across the hotel and another active offer', () => {
  assertInvalid(() => parseTravelportStaysReservationResponse(response({
    supplier: supplierReceipt({ offerRefs: ['O1', 'O2'] }),
    extraOffer: {
      '@type': 'Offer',
      id: 'O2',
      passiveOfferInd: false,
      Product: [{ '@type': 'ProductAir' }],
    },
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }));
});

test('rejects duplicate receipt offer references rather than collapsing ownership evidence', () => {
  assertInvalid(() => parseTravelportStaysReservationResponse(response({
    supplier: supplierReceipt({ offerRefs: ['O1', 'O1'] }),
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }));
});

test('preserves unrelated well-formed multi-content receipt evidence on another active offer', () => {
  const result = parseTravelportStaysReservationResponse(response({
    extraOffer: {
      '@type': 'Offer',
      id: 'O2',
      passiveOfferInd: false,
      Product: [{ '@type': 'ProductAir' }],
    },
    extraReceipt: {
      OfferRef: ['O2'],
      '@type': 'ReceiptPayment',
      Payment: { '@type': 'Payment' },
    },
  }), {
    expectedProviderReservationReference: 'PNR-123',
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  });
  assert.equal(result.supplierConfirmationReference, 'SUP-123');
});
