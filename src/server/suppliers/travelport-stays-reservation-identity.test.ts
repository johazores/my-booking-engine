import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  decodeTravelportStaysPropertyReference,
  normalizeTravelportStaysReservationExpectation,
} from './travelport-stays-reservation-identity.ts';

const propertyReference = Buffer.from(JSON.stringify({
  authority: 'TVPT',
  chainCode: 'HI',
  propertyCode: 'ABC12',
}), 'utf8').toString('base64url');

test('decodes only bounded Travelport property identity evidence', () => {
  assert.deepEqual(decodeTravelportStaysPropertyReference(propertyReference), {
    chainCode: 'HI',
    propertyCode: 'ABC12',
  });
  for (const value of [
    '',
    'not-base64!',
    Buffer.from(JSON.stringify({ authority: 'OTHER', chainCode: 'HI', propertyCode: 'ABC12' })).toString('base64url'),
    Buffer.from(JSON.stringify({ authority: 'TVPT', chainCode: 'bad code', propertyCode: 'ABC12' })).toString('base64url'),
  ]) {
    assert.throws(() => decodeTravelportStaysPropertyReference(value), HospitalitySupplierProviderError);
  }
});

test('normalizes the supported single-room reservation expectation', () => {
  assert.deepEqual(normalizeTravelportStaysReservationExpectation({
    supplierPropertyReference: propertyReference,
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-12',
    rooms: 1,
    adults: 2,
    childAges: [7],
  }), {
    chainCode: 'HI',
    propertyCode: 'ABC12',
    arrivalDateLocal: '2026-10-10',
    departureDateLocal: '2026-10-12',
    rooms: 1,
    guests: 3,
  });
});

test('rejects unsupported occupancy and date evidence', () => {
  for (const input of [
    { arrivalDateLocal: '2026-10-12', departureDateLocal: '2026-10-10', rooms: 1, adults: 1, childAges: [] },
    { arrivalDateLocal: '2026-10-10', departureDateLocal: '2026-10-12', rooms: 2, adults: 1, childAges: [] },
    { arrivalDateLocal: '2026-10-10', departureDateLocal: '2026-10-12', rooms: 1, adults: 0, childAges: [] },
    { arrivalDateLocal: '2026-10-10', departureDateLocal: '2026-10-12', rooms: 1, adults: 2, childAges: [1,2,3,4,5,6,7,8] },
  ]) {
    assert.throws(() => normalizeTravelportStaysReservationExpectation({
      supplierPropertyReference: propertyReference,
      ...input,
    }), HospitalitySupplierProviderError);
  }
});
