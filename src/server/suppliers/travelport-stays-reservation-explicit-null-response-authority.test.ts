import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';
import { classifyTravelportStaysReservationSyncOutcome } from './travelport-stays-reservation-sync-domain.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

const providerReservationReference = 'D6VBHL';
const supplierConfirmationReference = 'T9RY0-WQ842';
const providerCorrelationId = '9457f5be-e648-4cb6-ac1f-1d349d06d6ce';

type NullIdentity = 'source-context' | 'locator-type' | 'both';
type NullPnrDiscriminator = 'receipt' | 'confirmation' | 'offer-status';

function supplierReceipt() {
  return {
    '@type': 'ReceiptConfirmation',
    OfferRef: ['O1'],
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: supplierConfirmationReference,
        locatorType: 'Confirmation Number',
        source: 'BO',
        sourceContext: 'Supplier',
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function travelportPnrReceipt(nullDiscriminator?: NullPnrDiscriminator) {
  return {
    '@type': nullDiscriminator === 'receipt' ? null : 'ReceiptConfirmation',
    Confirmation: {
      '@type': nullDiscriminator === 'confirmation' ? null : 'ConfirmationHold',
      Locator: {
        value: providerReservationReference,
        locatorType: 'PNR Locator',
        sourceContext: 'Travelport',
      },
      OfferStatus: {
        '@type': nullDiscriminator === 'offer-status' ? null : 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function nullIdentitySibling(identity: NullIdentity) {
  return {
    '@type': 'ReceiptConfirmation',
    Confirmation: {
      '@type': 'ConfirmationHold',
      Locator: {
        value: 'MALFORMED-SIBLING',
        ...(identity === 'source-context' || identity === 'both' ? { sourceContext: null } : {}),
        ...(identity === 'locator-type' || identity === 'both' ? { locatorType: null } : {}),
      },
      OfferStatus: {
        '@type': 'OfferStatusHospitality',
        Status: 'Confirmed',
      },
    },
  };
}

function reservationResponse(input: Readonly<{
  nullIdentity?: NullIdentity;
  nullPnrDiscriminator?: NullPnrDiscriminator;
}> = {}) {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          id: 'O1',
          Identifier: { authority: 'BKNG' },
          Product: [{
            '@type': 'ProductHospitality',
            Quantity: 1,
            guests: 2,
            PropertyKey: { chainCode: 'CN', propertyCode: 'B6381' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [
          supplierReceipt(),
          travelportPnrReceipt(input.nullPnrDiscriminator),
          ...(input.nullIdentity ? [nullIdentitySibling(input.nullIdentity)] : []),
        ],
      },
      traceId: providerCorrelationId,
    },
  };
}

function assertInvalidAcrossReservationResponseConsumers(body: unknown) {
  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId,
  });

  assert.throws(
    () => parseTravelportStaysReservationResponse(body, {
      expectedProviderReservationReference: providerReservationReference,
      expectedReservation,
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );

  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
    supplierConfirmationReference,
  }), {
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    providerCorrelationId,
  });
}

test('valid Stays receipt authority remains accepted across Create, Retrieve, and Sync classification', () => {
  const body = reservationResponse();

  assert.deepEqual(classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
  }), {
    status: 'CONFIRMED',
    providerReservationReference,
    supplierConfirmationReference,
    providerCorrelationId,
  });

  assert.deepEqual(parseTravelportStaysReservationResponse(body, {
    expectedProviderReservationReference: providerReservationReference,
    expectedReservation,
    requireConfirmedTravelportReceipt: true,
  }), {
    providerReservationReference,
    supplierConfirmationReference,
    providerCorrelationId,
  });

  assert.deepEqual(classifyTravelportStaysReservationSyncOutcome({
    httpStatus: 200,
    body,
    expectedReservation,
    supplierConfirmationReference,
  }), {
    status: 'CONFIRMED',
    providerReservationReference,
    supplierConfirmationReference,
    providerCorrelationId,
  });
});

test('explicit-null locator identity cannot disappear beside valid authority in any reservation response consumer', () => {
  for (const nullIdentity of ['source-context', 'locator-type', 'both'] as const) {
    assertInvalidAcrossReservationResponseConsumers(reservationResponse({ nullIdentity }));
  }
});

test('explicit-null PNR receipt discriminators cannot authorize commercial or recovery success', () => {
  for (const nullPnrDiscriminator of ['receipt', 'confirmation', 'offer-status'] as const) {
    assertInvalidAcrossReservationResponseConsumers(reservationResponse({ nullPnrDiscriminator }));
  }
});
