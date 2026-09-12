import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { assertTravelportStaysReservationResponseMachineAuthority } from './travelport-stays-reservation-response-authority.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

function successResponse() {
  return {
    ReservationResponse: {
      traceId,
      Result: {
        '@type': 'Result',
        Warning: [{ '@type': 'Warning', StatusCode: 99, Message: 'Rates unavailable for one property.' }],
      },
      Reservation: {
        '@type': 'ReservationDetail',
        Offer: [{
          '@type': 'Offer',
          id: 'O1',
          Identifier: { authority: 'BKNG', value: 'offer-token' },
          Product: [{
            '@type': 'ProductHospitality',
            PropertyKey: { '@type': 'PropertyKey', chainCode: 'CN', propertyCode: 'B6381' },
            DateRange: { start: '2026-10-10', end: '2026-10-12' },
          }],
        }],
        Receipt: [{
          '@type': 'ReceiptConfirmation',
          OfferRef: ['O1'],
          Confirmation: {
            '@type': 'ConfirmationHold',
            Locator: {
              value: 'T9RY0-WQ842',
              locatorType: 'Confirmation Number',
              source: 'BO',
              sourceContext: 'Supplier',
            },
            OfferStatus: { '@type': 'OfferStatusHospitality', code: 'HK', Status: 'Confirmed' },
          },
        }],
      },
    },
  };
}

function errorResponse() {
  return {
    ErrorResponse: {
      traceId,
      Result: {
        '@type': 'Result',
        Error: [{
          '@type': 'ErrorDetail',
          StatusCode: 400,
          SourceCode: '13020',
          category: 'VALIDATION',
          SourceID: 'API',
          Message: 'HOTEL RATE PRICE HAS BECOME',
        }],
      },
    },
  };
}

function assertInvalid(body: unknown) {
  assert.throws(
    () => assertTravelportStaysReservationResponseMachineAuthority(body),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('accepts exact documented reservation success and error machine evidence', () => {
  assert.doesNotThrow(() => assertTravelportStaysReservationResponseMachineAuthority(successResponse()));
  assert.doesNotThrow(() => assertTravelportStaysReservationResponseMachineAuthority(errorResponse()));
});

test('rejects normalization-confusable reservation identity and offer authority', () => {
  const mutations = [
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation['@type'] = ' ReservationDetail'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Offer[0]!['@type'] = 'Offer '; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Offer[0]!.id = ' O1'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Offer[0]!.Identifier.authority = ' BKNG'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!['@type'] = 'ProductHospitality '; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.PropertyKey.chainCode = ' CN'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.PropertyKey.propertyCode = 'B6381\t'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Offer[0]!.Product[0]!.DateRange.start = '2026-10-10 '; },
  ];

  for (const mutate of mutations) {
    const body = successResponse();
    mutate(body);
    assertInvalid(body);
  }
});

test('rejects normalization-confusable receipt identity and lifecycle evidence', () => {
  const mutations = [
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Receipt[0]!.OfferRef[0] = ' O1'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Receipt[0]!.Confirmation.Locator.value = ' T9RY0-WQ842'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Receipt[0]!.Confirmation.Locator.locatorType = 'Confirmation Number '; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Receipt[0]!.Confirmation.Locator.sourceContext = 'Supplier\u007f'; },
    (body: ReturnType<typeof successResponse>) => { body.ReservationResponse.Reservation.Receipt[0]!.Confirmation.OfferStatus.Status = ' Confirmed'; },
  ];

  for (const mutate of mutations) {
    const body = successResponse();
    mutate(body);
    assertInvalid(body);
  }
});

test('rejects padded, control-bearing, or recased commercial error classification tokens', () => {
  const mutations = [
    (body: ReturnType<typeof errorResponse>) => { body.ErrorResponse.Result['@type'] = ' Result'; },
    (body: ReturnType<typeof errorResponse>) => { body.ErrorResponse.Result.Error[0]!['@type'] = 'ErrorDetail '; },
    (body: ReturnType<typeof errorResponse>) => { body.ErrorResponse.Result.Error[0]!.SourceCode = ' 13020'; },
    (body: ReturnType<typeof errorResponse>) => { body.ErrorResponse.Result.Error[0]!.SourceCode = '13020\u0000'; },
    (body: ReturnType<typeof errorResponse>) => { body.ErrorResponse.Result.Error[0]!.category = ' VALIDATION'; },
    (body: ReturnType<typeof errorResponse>) => { body.ErrorResponse.Result.Error[0]!.category = 'validation'; },
    (body: ReturnType<typeof errorResponse>) => { body.ErrorResponse.Result.Error[0]!.SourceID = 'API\t'; },
  ];

  for (const mutate of mutations) {
    const body = errorResponse();
    mutate(body);
    assertInvalid(body);
  }
});

test('rejects warning text aliases before warning text can become Sync recovery authority', () => {
  for (const message of [
    ' Hotel sell confirmed from supplier. Travelport PNR processing did not complete.',
    'Hotel sell confirmed from supplier.\nTravelport PNR processing did not complete.',
    `${'x'.repeat(513)}`,
  ]) {
    const body = successResponse();
    body.ReservationResponse.Result.Warning[0]!.Message = message;
    assertInvalid(body);
  }
});

test('rejects alternate result and response trace aliases before commercial classification', () => {
  const alternateSuccessResult = successResponse();
  alternateSuccessResult.ReservationResponse.Result['@type'] = 'OtherResult';
  assertInvalid(alternateSuccessResult);

  const alternateErrorResult = errorResponse();
  alternateErrorResult.ErrorResponse.Result['@type'] = 'OtherResult';
  assertInvalid(alternateErrorResult);

  const nullSuccessResultType = successResponse();
  (nullSuccessResultType.ReservationResponse.Result as Record<string, unknown>)['@type'] = null;
  assertInvalid(nullSuccessResultType);

  const pluralErrors = errorResponse();
  (pluralErrors.ErrorResponse.Result as Record<string, unknown>).Errors = [];
  assertInvalid(pluralErrors);

  const legacySuccessTrace = successResponse();
  (legacySuccessTrace.ReservationResponse as Record<string, unknown>).traceID = traceId;
  assertInvalid(legacySuccessTrace);

  const legacyErrorTrace = errorResponse();
  (legacyErrorTrace.ErrorResponse as Record<string, unknown>).traceID = traceId;
  assertInvalid(legacyErrorTrace);
});

test('rejects malformed error discriminators, status authority, and category aliases', () => {
  const invalidStatusCodes: readonly unknown[] = [undefined, 99, 600, 400.5, '400'];
  for (const statusCode of invalidStatusCodes) {
    const body = errorResponse();
    (body.ErrorResponse.Result.Error[0] as Record<string, unknown>).StatusCode = statusCode;
    assertInvalid(body);
  }

  const alternateErrorType = errorResponse();
  alternateErrorType.ErrorResponse.Result.Error[0]!['@type'] = 'OtherError';
  assertInvalid(alternateErrorType);

  const categoryAlias = errorResponse();
  (categoryAlias.ErrorResponse.Result.Error[0] as Record<string, unknown>).Category = 'VALIDATION';
  assertInvalid(categoryAlias);

  for (const field of ['SourceID', 'SourceCode', 'category', 'Message'] as const) {
    for (const missingValue of [undefined, null]) {
      const body = errorResponse();
      (body.ErrorResponse.Result.Error[0] as Record<string, unknown>)[field] = missingValue;
      assertInvalid(body);
    }
  }

  const conflictingWarning = errorResponse();
  (conflictingWarning.ErrorResponse.Result as Record<string, unknown>).Warning = [{
    '@type': 'Warning',
    StatusCode: 99,
    Message: 'Conflicting result evidence.',
  }];
  assertInvalid(conflictingWarning);

  const emptyErrors = errorResponse();
  emptyErrors.ErrorResponse.Result.Error = [];
  assertInvalid(emptyErrors);
});

test('rejects malformed warning discriminators, status authority, and empty warning collections', () => {
  const alternateWarningType = successResponse();
  alternateWarningType.ReservationResponse.Result.Warning[0]!['@type'] = 'OtherWarning';
  assertInvalid(alternateWarningType);

  const nullWarningType = successResponse();
  (nullWarningType.ReservationResponse.Result.Warning[0] as Record<string, unknown>)['@type'] = null;
  assertInvalid(nullWarningType);

  for (const statusCode of [-1, 1_000, 1.5, '99'] as readonly unknown[]) {
    const body = successResponse();
    (body.ReservationResponse.Result.Warning[0] as Record<string, unknown>).StatusCode = statusCode;
    assertInvalid(body);
  }

  for (const missingMessage of [undefined, null]) {
    const body = successResponse();
    (body.ReservationResponse.Result.Warning[0] as Record<string, unknown>).Message = missingMessage;
    assertInvalid(body);
  }

  const emptyWarnings = successResponse();
  emptyWarnings.ReservationResponse.Result.Warning = [];
  assertInvalid(emptyWarnings);
});

test('bounds commercial authority collections before downstream traversal', () => {
  const tooManyOffers = successResponse();
  tooManyOffers.ReservationResponse.Reservation.Offer = Array.from({ length: 33 }, () => ({
    '@type': 'Offer',
    id: 'O1',
    Identifier: { authority: 'BKNG', value: 'offer-token' },
    Product: [],
  })) as typeof tooManyOffers.ReservationResponse.Reservation.Offer;
  assertInvalid(tooManyOffers);

  const tooManyErrors = errorResponse();
  tooManyErrors.ErrorResponse.Result.Error = Array.from({ length: 33 }, () => ({
    '@type': 'ErrorDetail',
    StatusCode: 400,
    SourceCode: '13020',
    category: 'VALIDATION',
    SourceID: 'API',
    Message: 'HOTEL RATE PRICE HAS BECOME',
  }));
  assertInvalid(tooManyErrors);
});
