import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { assertTravelportStaysReservationResponseMachineAuthority } from './travelport-stays-reservation-response-authority.ts';

const traceId = '9f77a0b5-2614-4f6d-9053-f3a6175343f7';

type PathSegment = string | number;

function successResponse(): unknown {
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

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function setPath(root: unknown, path: readonly PathSegment[], value: unknown) {
  assert.ok(path.length > 0);
  let cursor: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === 'number') {
      assert.ok(Array.isArray(cursor));
      cursor = cursor[segment];
    } else {
      cursor = record(cursor)[segment];
    }
  }

  const finalSegment = path[path.length - 1]!;
  if (typeof finalSegment === 'number') {
    assert.ok(Array.isArray(cursor));
    cursor[finalSegment] = value;
  } else {
    record(cursor)[finalSegment] = value;
  }
}

function deletePath(root: unknown, path: readonly PathSegment[]) {
  assert.ok(path.length > 0);
  let cursor: unknown = root;
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === 'number') {
      assert.ok(Array.isArray(cursor));
      cursor = cursor[segment];
    } else {
      cursor = record(cursor)[segment];
    }
  }

  const finalSegment = path[path.length - 1]!;
  if (typeof finalSegment === 'number') {
    assert.ok(Array.isArray(cursor));
    cursor.splice(finalSegment, 1);
  } else {
    delete record(cursor)[finalSegment];
  }
}

function assertInvalid(body: unknown) {
  assert.throws(
    () => assertTravelportStaysReservationResponseMachineAuthority(body),
    (error: unknown) => error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_RESPONSE',
  );
}

test('rejects explicit null wherever optional reservation machine evidence is present', () => {
  const nullPaths: readonly (readonly PathSegment[])[] = [
    ['ReservationResponse', 'traceId'],
    ['ReservationResponse', 'Result'],
    ['ReservationResponse', 'Reservation'],
    ['ReservationResponse', 'Reservation', '@type'],
    ['ReservationResponse', 'Reservation', 'Offer'],
    ['ReservationResponse', 'Reservation', 'Offer', 0, 'id'],
    ['ReservationResponse', 'Reservation', 'Offer', 0, 'Identifier', 'authority'],
    ['ReservationResponse', 'Reservation', 'Offer', 0, 'Product'],
    ['ReservationResponse', 'Reservation', 'Offer', 0, 'Product', 0, 'PropertyKey', 'chainCode'],
    ['ReservationResponse', 'Reservation', 'Offer', 0, 'Product', 0, 'DateRange', 'start'],
    ['ReservationResponse', 'Reservation', 'Receipt'],
    ['ReservationResponse', 'Reservation', 'Receipt', 0, 'OfferRef'],
    ['ReservationResponse', 'Reservation', 'Receipt', 0, 'Confirmation'],
    ['ReservationResponse', 'Reservation', 'Receipt', 0, 'Confirmation', 'Locator'],
    ['ReservationResponse', 'Reservation', 'Receipt', 0, 'Confirmation', 'Locator', 'value'],
    ['ReservationResponse', 'Reservation', 'Receipt', 0, 'Confirmation', 'OfferStatus'],
    ['ReservationResponse', 'Reservation', 'Receipt', 0, 'Confirmation', 'OfferStatus', 'Status'],
  ];

  for (const path of nullPaths) {
    const body = successResponse();
    setPath(body, path, null);
    assertInvalid(body);
  }
});

test('preserves genuine omission for optional machine evidence', () => {
  const omissionPaths: readonly (readonly PathSegment[])[] = [
    ['ReservationResponse', 'Result'],
    ['ReservationResponse', 'Reservation', 'Offer', 0, 'Identifier'],
    ['ReservationResponse', 'Reservation', 'Receipt', 0, 'Confirmation', 'Locator'],
  ];

  for (const path of omissionPaths) {
    const body = successResponse();
    deletePath(body, path);
    assert.doesNotThrow(() => assertTravelportStaysReservationResponseMachineAuthority(body));
  }
});

test('rejects explicit null collection members instead of silently treating them as absent evidence', () => {
  for (const path of [
    ['ReservationResponse', 'Reservation', 'Offer', 0] as const,
    ['ReservationResponse', 'Reservation', 'Offer', 0, 'Product', 0] as const,
    ['ReservationResponse', 'Reservation', 'Receipt', 0] as const,
  ]) {
    const body = successResponse();
    setPath(body, path, null);
    assertInvalid(body);
  }
});
