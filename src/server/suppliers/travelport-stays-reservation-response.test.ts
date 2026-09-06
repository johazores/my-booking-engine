import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

function response(input: {
  travelportReference?: string;
  travelportStatus?: string;
  supplierReferences?: readonly string[];
  supplierStatus?: string;
  traceId?: string;
  includeSensitiveData?: boolean;
} = {}) {
  const travelportReference = input.travelportReference ?? 'D6VBHL';
  const supplierReferences = input.supplierReferences ?? ['80073065'];
  return {
    ReservationResponse: {
      Reservation: {
        ...(input.includeSensitiveData ? {
          Traveler: [{ PersonName: { Given: 'Sensitive', Surname: 'Traveler' } }],
          FormOfPayment: [{ PaymentCard: { CardNumber: { PlainText: '4111111111111111' } } }],
        } : {}),
        Receipt: [
          ...supplierReferences.map((reference) => ({
            Confirmation: {
              Locator: { value: reference, sourceContext: 'Supplier' },
              OfferStatus: { Status: input.supplierStatus ?? 'Confirmed' },
            },
          })),
          {
            Confirmation: {
              Locator: { value: travelportReference, sourceContext: 'Travelport' },
              OfferStatus: { Status: input.travelportStatus ?? 'Confirmed' },
            },
          },
          {
            Confirmation: {
              Locator: { value: '96120603', sourceContext: 'Agency' },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
        ],
      },
      traceId: input.traceId ?? '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1',
    },
  };
}

test('normalizes only durable locator and correlation evidence from a confirmed create response', () => {
  const result = parseTravelportStaysReservationResponse(response({ includeSensitiveData: true }), {
    requireConfirmedTravelportReceipt: true,
  });

  assert.deepEqual(result, {
    providerReservationReference: 'D6VBHL',
    supplierConfirmationReference: '80073065',
    providerCorrelationId: '5ba67b95-a9b2-4d0b-b3a2-b075969e79f1',
  });
  assert.equal('Traveler' in result, false);
  assert.equal('FormOfPayment' in result, false);
});

test('retrieve verification can require an exact known aggregator locator without requiring active status', () => {
  const result = parseTravelportStaysReservationResponse(response({ travelportStatus: 'Cancelled' }), {
    expectedProviderReservationReference: 'D6VBHL',
  });
  assert.equal(result.providerReservationReference, 'D6VBHL');

  assert.throws(
    () => parseTravelportStaysReservationResponse(response(), { expectedProviderReservationReference: 'OTHER' }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('create evidence fails closed unless provider and supplier receipts are confirmed', () => {
  for (const status of ['Pending', 'Rejected', 'Cancelled']) {
    assert.throws(
      () => parseTravelportStaysReservationResponse(response({ travelportStatus: status }), {
        requireConfirmedTravelportReceipt: true,
      }),
      (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    );
  }

  assert.throws(
    () => parseTravelportStaysReservationResponse(response({ supplierStatus: 'Pending' }), {
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('ambiguous locator evidence fails closed', () => {
  const duplicate = response();
  duplicate.ReservationResponse.Reservation.Receipt.push({
    Confirmation: {
      Locator: { value: 'OTHER', sourceContext: 'Travelport' },
      OfferStatus: { Status: 'Confirmed' },
    },
  });
  assert.throws(
    () => parseTravelportStaysReservationResponse(duplicate),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );

  assert.throws(
    () => parseTravelportStaysReservationResponse(response({ supplierReferences: ['A', 'B'] })),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
});

test('unsafe provider locator and correlation strings are never normalized as durable evidence', () => {
  const unsafeLocator = response({ travelportReference: 'D6V\nBHL' });
  assert.throws(
    () => parseTravelportStaysReservationResponse(unsafeLocator),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );

  const unsafeTrace = parseTravelportStaysReservationResponse(response({ traceId: 'trace\nsecret' }));
  assert.equal(unsafeTrace.providerCorrelationId, null);
});
