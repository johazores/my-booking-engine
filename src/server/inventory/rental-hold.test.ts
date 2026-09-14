import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_RENTAL_HOLD_MINUTES,
  normalizeRentalAvailabilityHoldInput,
  rentalAvailabilityHoldPayloadMatches,
} from './rental-hold-domain.ts';
import { RentalInventoryValidationError } from './rental-domain.ts';

test('rental hold input normalizes bounded dates, duration, and idempotency', () => {
  const normalized = normalizeRentalAvailabilityHoldInput({
    unitId: ' 6bd59ab8-85aa-4472-8ac3-2c69d72cb77d ',
    startsOn: '2026-10-01',
    endsOn: '2026-10-05',
    idempotencyKey: ' rental-hold:test-123 ',
    expiresInMinutes: '20',
  });

  assert.equal(normalized.unitId, '6bd59ab8-85aa-4472-8ac3-2c69d72cb77d');
  assert.equal(normalized.idempotencyKey, 'rental-hold:test-123');
  assert.equal(normalized.expiresInMinutes, 20);
  assert.equal(normalized.startsOn.toISOString().slice(0, 10), '2026-10-01');
  assert.equal(normalized.endsOn.toISOString().slice(0, 10), '2026-10-05');
});

test('rental hold input rejects unsafe idempotency, duration, and oversized date windows', () => {
  assert.throws(
    () => normalizeRentalAvailabilityHoldInput({
      unitId: '6bd59ab8-85aa-4472-8ac3-2c69d72cb77d',
      startsOn: '2026-10-01',
      endsOn: '2026-10-05',
      idempotencyKey: 'short',
    }),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalAvailabilityHoldInput({
      unitId: '6bd59ab8-85aa-4472-8ac3-2c69d72cb77d',
      startsOn: '2026-10-01',
      endsOn: '2026-10-05',
      idempotencyKey: 'rental-hold:test-123',
      expiresInMinutes: MAX_RENTAL_HOLD_MINUTES + 1,
    }),
    /Hold duration/,
  );
  assert.throws(
    () => normalizeRentalAvailabilityHoldInput({
      unitId: '6bd59ab8-85aa-4472-8ac3-2c69d72cb77d',
      startsOn: '2026-10-01',
      endsOn: '2027-01-01',
      idempotencyKey: 'rental-hold:test-123',
    }),
    /cannot exceed 90 days/,
  );
});

test('rental hold idempotency payload comparison binds unit, dates, and requested duration', () => {
  const createdAt = new Date('2026-09-14T15:00:00.000Z');
  const hold = {
    unitId: 'unit-a',
    startsOn: new Date('2026-10-01T00:00:00.000Z'),
    endsOn: new Date('2026-10-05T00:00:00.000Z'),
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
  };
  const requested = {
    unitId: hold.unitId,
    startsOn: hold.startsOn,
    endsOn: hold.endsOn,
    expiresInMinutes: 15,
  };

  assert.equal(rentalAvailabilityHoldPayloadMatches({ hold, requested }), true);
  assert.equal(rentalAvailabilityHoldPayloadMatches({
    hold,
    requested: { ...requested, unitId: 'unit-b' },
  }), false);
  assert.equal(rentalAvailabilityHoldPayloadMatches({
    hold,
    requested: { ...requested, endsOn: new Date('2026-10-06T00:00:00.000Z') },
  }), false);
  assert.equal(rentalAvailabilityHoldPayloadMatches({
    hold,
    requested: { ...requested, expiresInMinutes: 20 },
  }), false);
});
