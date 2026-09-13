import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  isCanonicalTravelportStaysReservationReferencePathSegment,
  normalizeTravelportStaysReservationReference,
} from './travelport-stays-reservation-reference.ts';

function invalidRequest(error: unknown) {
  return error instanceof HospitalitySupplierProviderError && error.code === 'INVALID_REQUEST';
}

test('reservation reference authority preserves the existing bounded single-line contract', () => {
  assert.equal(normalizeTravelportStaysReservationReference('D6VBHL'), 'D6VBHL');
  assert.equal(normalizeTravelportStaysReservationReference('D6 VBHL'), 'D6 VBHL');
  assert.equal(normalizeTravelportStaysReservationReference('A'.repeat(512)), 'A'.repeat(512));

  for (const value of [
    '',
    ' D6VBHL',
    'D6VBHL ',
    '\u00a0D6VBHL',
    'D6VBHL\u00a0',
    'D6\u0000VBHL',
    'D6\nVBHL',
    'A'.repeat(513),
    null,
  ]) {
    assert.throws(() => normalizeTravelportStaysReservationReference(value), invalidRequest, String(value));
  }
});

test('reservation reference path authority requires exact canonical encoding of an authorized reference', () => {
  assert.equal(isCanonicalTravelportStaysReservationReferencePathSegment('D6VBHL'), true);
  assert.equal(isCanonicalTravelportStaysReservationReferencePathSegment('D6%20VBHL'), true);
  assert.equal(isCanonicalTravelportStaysReservationReferencePathSegment('D6%2FVBHL'), true);
  assert.equal(isCanonicalTravelportStaysReservationReferencePathSegment('A'.repeat(512)), true);

  for (const value of [
    '',
    'D6VBHL/history',
    '%44%36VBHL',
    '%20D6VBHL',
    'D6VBHL%20',
    '%C2%A0D6VBHL',
    'D6%00VBHL',
    'A'.repeat(513),
    '%E0%A4%A',
  ]) {
    assert.equal(isCanonicalTravelportStaysReservationReferencePathSegment(value), false, value);
  }
});
