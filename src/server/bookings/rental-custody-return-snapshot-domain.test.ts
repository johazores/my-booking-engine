import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RentalCustodySnapshotIntegrityError,
  validateRentalCustodyReturnSnapshot,
} from './rental-custody-return-snapshot-domain.ts';

const pickup = Object.freeze({
  unitId: '11111111-1111-4111-8111-111111111111',
  startsOn: new Date('2026-09-10T00:00:00.000Z'),
  endsOn: new Date('2026-09-12T00:00:00.000Z'),
  occurredAt: new Date('2026-09-10T01:00:00.000Z'),
});

test('same committed custody snapshot remains valid at return', () => {
  assert.deepEqual(validateRentalCustodyReturnSnapshot({
    pickup,
    returned: { ...pickup, occurredAt: new Date('2026-09-11T10:00:00.000Z') },
  }), {
    committedStartsOn: pickup.startsOn,
    committedEndsOn: pickup.endsOn,
    custodyExtended: false,
  });
});

test('a supported post-pickup extension may move only the committed return end later', () => {
  const extendedEnd = new Date('2026-09-15T00:00:00.000Z');
  assert.deepEqual(validateRentalCustodyReturnSnapshot({
    pickup,
    returned: {
      ...pickup,
      endsOn: extendedEnd,
      occurredAt: new Date('2026-09-15T09:00:00.000Z'),
    },
  }), {
    committedStartsOn: pickup.startsOn,
    committedEndsOn: extendedEnd,
    custodyExtended: true,
  });
});

test('return evidence cannot shorten custody or change the pickup assignment', () => {
  assert.throws(() => validateRentalCustodyReturnSnapshot({
    pickup,
    returned: {
      ...pickup,
      endsOn: new Date('2026-09-11T00:00:00.000Z'),
      occurredAt: new Date('2026-09-11T09:00:00.000Z'),
    },
  }), /cannot shorten/);

  assert.throws(() => validateRentalCustodyReturnSnapshot({
    pickup,
    returned: {
      ...pickup,
      startsOn: new Date('2026-09-11T00:00:00.000Z'),
      occurredAt: new Date('2026-09-12T09:00:00.000Z'),
    },
  }), /committed start/);

  assert.throws(() => validateRentalCustodyReturnSnapshot({
    pickup,
    returned: {
      ...pickup,
      unitId: '22222222-2222-4222-8222-222222222222',
      occurredAt: new Date('2026-09-12T09:00:00.000Z'),
    },
  }), /physical unit/);
});

test('return chronology and date evidence fail closed', () => {
  assert.throws(() => validateRentalCustodyReturnSnapshot({
    pickup,
    returned: { ...pickup, occurredAt: new Date('2026-09-09T23:00:00.000Z') },
  }), /cannot predate pickup/);

  assert.throws(() => validateRentalCustodyReturnSnapshot({
    pickup,
    returned: { ...pickup, endsOn: new Date(Number.NaN) },
  }), RentalCustodySnapshotIntegrityError);
});
