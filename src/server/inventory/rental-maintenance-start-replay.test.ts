import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRentalMaintenanceStartReplay } from './rental-maintenance-start-replay.ts';

const startedAt = new Date('2026-09-20T08:00:00.000Z');
const startedByUserId = '11111111-1111-4111-8111-111111111111';

test('maintenance start is fresh only while the work order is still open', () => {
  assert.equal(classifyRentalMaintenanceStartReplay({
    status: 'OPEN',
    startedAt: null,
    startedByUserId: null,
  }), 'FRESH');
});

test('maintenance start remains idempotent after later terminal transitions when start evidence is retained', () => {
  for (const status of ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const) {
    assert.equal(classifyRentalMaintenanceStartReplay({
      status,
      startedAt,
      startedByUserId,
    }), 'REPLAY');
  }
});

test('direct terminal work cannot invent historical start authority', () => {
  for (const status of ['COMPLETED', 'CANCELLED'] as const) {
    assert.equal(classifyRentalMaintenanceStartReplay({
      status,
      startedAt: null,
      startedByUserId: null,
    }), 'INVALID_TRANSITION');
  }
});

test('partial retained start evidence fails closed', () => {
  assert.equal(classifyRentalMaintenanceStartReplay({
    status: 'IN_PROGRESS',
    startedAt,
    startedByUserId: null,
  }), 'INVALID_TRANSITION');

  assert.equal(classifyRentalMaintenanceStartReplay({
    status: 'IN_PROGRESS',
    startedAt: null,
    startedByUserId,
  }), 'INVALID_TRANSITION');
});
