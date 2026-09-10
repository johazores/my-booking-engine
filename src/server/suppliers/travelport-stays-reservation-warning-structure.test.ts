import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { classifyTravelportStaysReservationCreateOutcome } from './travelport-stays-reservation-create-outcome.ts';
import { parseTravelportStaysReservationResponse } from './travelport-stays-reservation-response.ts';

const expectedReservation = Object.freeze({
  chainCode: 'CN',
  propertyCode: 'B6381',
  arrivalDateLocal: '2026-10-10',
  departureDateLocal: '2026-10-12',
  rooms: 1,
  guests: 2,
});

const documentedWarning =
  'Hotel sell confirmed from supplier. Travelport PNR processing did not complete. Use SYNC message with confirmation number to complete PNR.';

function createResponse(result?: unknown, includeTravelport = true) {
  return {
    ReservationResponse: {
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
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
          {
            Confirmation: {
              Locator: {
                value: 'T9RY0-WQ842',
                locatorType: 'Confirmation Number',
                source: 'BO',
                sourceContext: 'Supplier',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          },
          ...(includeTravelport ? [{
            Confirmation: {
              Locator: {
                value: '0GQ9HS',
                locatorType: 'PNR Locator',
                sourceContext: 'Travelport',
              },
              OfferStatus: { Status: 'Confirmed' },
            },
          }] : []),
        ],
      },
      ...(result === undefined ? {} : { Result: result }),
      traceId: 'warning-structure-create',
    },
  };
}

function retrieveResponse(result?: unknown) {
  return {
    ReservationResponse: {
      Reservation: {
        Receipt: [{
          Confirmation: {
            Locator: {
              value: '0GQ9HS',
              locatorType: 'PNR Locator',
              sourceContext: 'Travelport',
            },
            OfferStatus: { Status: 'Confirmed' },
          },
        }],
      },
      ...(result === undefined ? {} : { Result: result }),
      traceId: 'warning-structure-retrieve',
    },
  };
}

function classify(result?: unknown) {
  return classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: createResponse(result),
    expectedReservation,
  });
}

function assertCreateInvalid(result: unknown, label: string) {
  const outcome = classify(result);
  assert.equal(outcome.status, 'AMBIGUOUS', label);
  if (outcome.status === 'AMBIGUOUS') {
    assert.equal(outcome.failureCode, 'INVALID_RESPONSE', label);
  }
}

function assertRetrieveInvalid(result: unknown, label: string) {
  assert.throws(
    () => parseTravelportStaysReservationResponse(retrieveResponse(result), {
      expectedProviderReservationReference: '0GQ9HS',
      requireConfirmedTravelportReceipt: true,
    }),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
    label,
  );
}

test('warning evidence preserves omission compatibility and accepts the documented typed shape', () => {
  const withoutResult = classify();
  assert.equal(withoutResult.status, 'CONFIRMED');

  const legacyWarning = classify({
    Warning: [{ Message: 'Supplier informational note.' }],
  });
  assert.equal(legacyWarning.status, 'CONFIRMED');

  const typedWarning = classify({
    '@type': 'Result',
    Warning: [{
      '@type': 'Warning',
      StatusCode: 99,
      Message: 'Supplier informational note.',
    }],
  });
  assert.equal(typedWarning.status, 'CONFIRMED');

  assert.equal(
    parseTravelportStaysReservationResponse(retrieveResponse({
      '@type': 'Result',
      Warning: [{
        '@type': 'Warning',
        StatusCode: 99,
        Message: 'Supplier informational note.',
      }],
    }), {
      expectedProviderReservationReference: '0GQ9HS',
      requireConfirmedTravelportReceipt: true,
    }).providerReservationReference,
    '0GQ9HS',
  );
});

test('present malformed Result and Warning discriminators fail closed in Create and Retrieve', () => {
  const malformedValues = [
    null,
    '',
    'Other',
    'Result\nshadow',
    'x'.repeat(65),
    42,
  ] as const;

  for (const value of malformedValues) {
    const result = {
      '@type': value,
      Warning: [{ Message: 'Supplier informational note.' }],
    };
    assertCreateInvalid(result, `Create Result @type ${String(value)}`);
    assertRetrieveInvalid(result, `Retrieve Result @type ${String(value)}`);
  }

  for (const value of malformedValues) {
    const result = {
      '@type': 'Result',
      Warning: [{
        '@type': value,
        Message: 'Supplier informational note.',
      }],
    };
    assertCreateInvalid(result, `Create Warning @type ${String(value)}`);
    assertRetrieveInvalid(result, `Retrieve Warning @type ${String(value)}`);
  }
});

test('present malformed warning status and explicit empty warning collections fail closed', () => {
  for (const statusCode of [null, '99', -1, 1000, 1.5, Number.NaN]) {
    const result = {
      '@type': 'Result',
      Warning: [{
        '@type': 'Warning',
        StatusCode: statusCode,
        Message: 'Supplier informational note.',
      }],
    };
    assertCreateInvalid(result, `Create warning status ${String(statusCode)}`);
    assertRetrieveInvalid(result, `Retrieve warning status ${String(statusCode)}`);
  }

  for (const result of [
    { Warning: [] },
    { Warnings: [] },
  ]) {
    assertCreateInvalid(result, 'Create empty warning collection');
    assertRetrieveInvalid(result, 'Retrieve empty warning collection');
  }
});

test('warning messages reject control-character normalization before commercial authority', () => {
  for (const message of [
    `Supplier\tinformational note.`,
    `Supplier\u0000informational note.`,
    `Supplier\u001finformational note.`,
    `Supplier\u007finformational note.`,
  ]) {
    const result = {
      '@type': 'Result',
      Warning: [{
        '@type': 'Warning',
        StatusCode: 99,
        Message: message,
      }],
    };
    assertCreateInvalid(result, 'Create control-character warning');
    assertRetrieveInvalid(result, 'Retrieve control-character warning');
  }
});

test('the supplier-confirmed recovery warning still retains Sync authority with canonical warning evidence', () => {
  const outcome = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: createResponse({
      '@type': 'Result',
      Warning: [{
        '@type': 'Warning',
        StatusCode: 99,
        Message: documentedWarning,
      }],
    }, false),
    expectedReservation,
  });

  assert.equal(outcome.status, 'AMBIGUOUS');
  if (outcome.status === 'AMBIGUOUS') {
    assert.equal(outcome.failureCode, 'TRAVELPORT_SYNC_REQUIRED');
    assert.equal(outcome.supplierConfirmationReference, 'T9RY0-WQ842');
    assert.equal(outcome.providerRecoveryReference, 'travelport-stays-sync-v1:BKNG:BO');
  }
});

test('internal whitespace cannot be normalized into the supplier-confirmed recovery warning', () => {
  const outcome = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: 200,
    body: createResponse({
      '@type': 'Result',
      Warning: [{
        '@type': 'Warning',
        StatusCode: 99,
        Message: documentedWarning.replace('supplier. Travelport', 'supplier.  Travelport'),
      }],
    }),
    expectedReservation,
  });

  assert.equal(outcome.status, 'CONFIRMED');
});
