import assert from 'node:assert/strict';
import test from 'node:test';

import { BookingDomainValidationError } from './booking-domain.ts';
import {
  assertHospitalityBookingGuestCapacity,
  hospitalityBookingGuestFingerprint,
  normalizeHospitalityBookingGuestModificationInput,
} from './booking-guest-modification-domain.ts';

test('normalizes guest edits and canonicalizes guest email', () => {
  const normalized = normalizeHospitalityBookingGuestModificationInput({
    idempotencyKey: 'guest-edit:12345678',
    guests: [{ firstName: ' Ada ', lastName: ' Lovelace ', email: ' ADA@EXAMPLE.COM ' }],
  });
  assert.deepEqual(normalized.guests, [{ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }]);
});

test('guest fingerprint is stable for equivalent normalized input and changes with payload', () => {
  const left = hospitalityBookingGuestFingerprint([{ firstName: 'Ada', lastName: 'Lovelace', email: 'ADA@example.com' }]);
  const equivalent = hospitalityBookingGuestFingerprint([{ firstName: ' Ada ', lastName: 'Lovelace', email: 'ada@example.com' }]);
  const changed = hospitalityBookingGuestFingerprint([{ firstName: 'Grace', lastName: 'Hopper', email: null }]);
  assert.equal(left, equivalent);
  assert.notEqual(left, changed);
});

test('rejects guest counts beyond reserved room occupancy', () => {
  assert.equal(assertHospitalityBookingGuestCapacity({ guests: [{ firstName: 'A', lastName: 'One' }], quantity: 1, maxOccupancy: 2 }), 2);
  assert.throws(() => assertHospitalityBookingGuestCapacity({
    guests: [{ firstName: 'A', lastName: 'One' }, { firstName: 'B', lastName: 'Two' }, { firstName: 'C', lastName: 'Three' }],
    quantity: 1,
    maxOccupancy: 2,
  }), /cannot exceed the reserved occupancy of 2/);
});

test('guest occupancy input errors are typed but corrupt persisted capacity stays internal', () => {
  const guests = [{ firstName: 'A', lastName: 'One' }, { firstName: 'B', lastName: 'Two' }];
  assert.throws(() => assertHospitalityBookingGuestCapacity({ guests, quantity: 1, maxOccupancy: 1 }), BookingDomainValidationError);
  assert.throws(() => assertHospitalityBookingGuestCapacity({ guests, quantity: 0, maxOccupancy: 1 }), (error: unknown) => {
    assert.equal(error instanceof BookingDomainValidationError, false);
    assert.match((error as Error).message, /Persisted booking occupancy configuration/);
    return true;
  });
});
