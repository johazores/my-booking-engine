import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTravelportStaysReservationSyncLogRecord } from './travelport-stays-reservation-sync-observability.ts';

const requestCorrelationId = '323e4567-e89b-42d3-a456-426614174000';
const organizationId = '423e4567-e89b-42d3-a456-426614174000';

test('sync observations expose only bounded operational metadata', () => {
  const record = buildTravelportStaysReservationSyncLogRecord({
    requestCorrelationId,
    organizationId,
    durationMs: 7.6,
    result: 'CONFIRMED',
    now: () => new Date('2026-09-08T04:00:00.000Z'),
  });
  assert.deepEqual(record, {
    timestamp: '2026-09-08T04:00:00.000Z',
    level: 'info',
    event: 'supplier.reservation-sync.provider-request.completed',
    requestCorrelationId,
    organizationId,
    provider: 'travelport-stays',
    operation: 'reservation.sync',
    outcome: 'confirmed',
    durationMs: 8,
  });
});

test('unknown runtime sync outcomes fail closed as ambiguous warnings without copying the value', () => {
  const record = buildTravelportStaysReservationSyncLogRecord({
    requestCorrelationId,
    organizationId,
    durationMs: 2,
    result: 'SECRET_SHOULD_NOT_LOG' as never,
  });
  const serialized = JSON.stringify(record);
  assert.equal(record.level, 'warn');
  assert.equal(record.outcome, 'ambiguous');
  assert.equal(serialized.includes('SECRET_SHOULD_NOT_LOG'), false);
});
