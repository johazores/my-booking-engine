import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTravelportStaysReservationCreateLogRecord } from './travelport-stays-reservation-create-observability.ts';

const requestCorrelationId = '123e4567-e89b-42d3-a456-426614174000';
const organizationId = '223e4567-e89b-42d3-a456-426614174000';

test('create observations expose only bounded operational metadata', () => {
  const record = buildTravelportStaysReservationCreateLogRecord({
    requestCorrelationId,
    organizationId,
    durationMs: 12.4,
    result: 'CONFIRMED',
    now: () => new Date('2026-09-07T00:00:00.000Z'),
  });
  assert.deepEqual(record, {
    timestamp: '2026-09-07T00:00:00.000Z',
    level: 'info',
    event: 'supplier.reservation-create.provider-request.completed',
    requestCorrelationId,
    organizationId,
    provider: 'travelport-stays',
    operation: 'reservation.create',
    outcome: 'confirmed',
    durationMs: 12,
  });
  assert.equal(JSON.stringify(record).includes('card'), false);
  assert.equal(JSON.stringify(record).includes('traveler'), false);
});

test('ambiguous create observations are warnings and sanitize identifiers', () => {
  const record = buildTravelportStaysReservationCreateLogRecord({
    requestCorrelationId: 'unsafe',
    organizationId: 'unsafe',
    durationMs: Number.NaN,
    result: 'AMBIGUOUS',
  });
  assert.equal(record.level, 'warn');
  assert.equal(record.outcome, 'ambiguous');
  assert.equal(record.requestCorrelationId, 'invalid-request-correlation-id');
  assert.equal(record.organizationId, 'invalid-organization-id');
  assert.equal(record.durationMs, 0);
});
