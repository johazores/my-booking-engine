import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  isCanonicalTravelportStaysReservationReferencePathSegment,
  normalizeTravelportStaysReservationReference,
} from './travelport-stays-reservation-reference.ts';
import { assertTravelportStaysReservationResponseMachineAuthority } from './travelport-stays-reservation-response-authority.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

function invalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

function invalidResponse(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE';
}

function responseWithMachineValue(locatorValue: string, warningMessage: string) {
  return {
    ReservationResponse: {
      traceId,
      Result: {
        '@type': 'Result',
        Warning: [{
          '@type': 'Warning',
          StatusCode: 99,
          Message: warningMessage,
        }],
      },
      Reservation: {
        '@type': 'ReservationDetail',
        Receipt: [{
          '@type': 'ReceiptConfirmation',
          Confirmation: {
            '@type': 'ConfirmationHold',
            Locator: {
              value: locatorValue,
              locatorType: 'PNR Locator',
              sourceContext: 'Travelport',
            },
            OfferStatus: {
              '@type': 'OfferStatusHospitality',
              code: 'HK',
              Status: 'Confirmed',
            },
          },
        }],
      },
    },
  };
}

test('reservation reference authority rejects ill-formed Unicode before path serialization', () => {
  const valid = 'D6🚀VBHL';
  assert.equal(normalizeTravelportStaysReservationReference(valid), valid);
  assert.equal(
    isCanonicalTravelportStaysReservationReferencePathSegment('D6%F0%9F%9A%80VBHL'),
    true,
  );

  for (const value of ['D6\uD800VBHL', 'D6\uDC00VBHL']) {
    assert.equal(value.isWellFormed(), false);
    assert.throws(() => normalizeTravelportStaysReservationReference(value), invalidRequest);
    assert.doesNotThrow(() => JSON.stringify({ reference: value }));
    assert.throws(() => encodeURIComponent(value), URIError);
  }
});

test('reservation response machine authority rejects ill-formed Unicode before replay or durable identity parsing', () => {
  const valid = responseWithMachineValue('D6🚀VBHL', 'Supplier returned a valid non-BMP character 🚀.');
  assert.doesNotThrow(() => assertTravelportStaysReservationResponseMachineAuthority(valid));

  const malformedLocator = responseWithMachineValue('D6\uD800VBHL', 'Supplier warning.');
  assert.throws(
    () => assertTravelportStaysReservationResponseMachineAuthority(malformedLocator),
    invalidResponse,
  );

  const malformedWarning = responseWithMachineValue('D6VBHL', 'Supplier warning \uDC00');
  assert.throws(
    () => assertTravelportStaysReservationResponseMachineAuthority(malformedWarning),
    invalidResponse,
  );

  const malformedError = {
    ErrorResponse: {
      traceId,
      Result: {
        '@type': 'Result',
        Error: [{
          '@type': 'ErrorDetail',
          StatusCode: 400,
          SourceCode: '13020',
          category: 'VALIDATION',
          SourceID: 'API\uD800',
          Message: 'Malformed machine authority.',
        }],
      },
    },
  };
  assert.throws(
    () => assertTravelportStaysReservationResponseMachineAuthority(malformedError),
    invalidResponse,
  );
});
