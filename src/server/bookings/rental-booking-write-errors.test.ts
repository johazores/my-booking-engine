import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

test('classifies serialization conflicts as retryable', () => {
  assert.equal(classifyRentalBookingWriteError({ code: 'P2034' }), 'RETRYABLE');
});

test('retries unique conflicts only for idempotent create boundaries that opt in', () => {
  assert.equal(classifyRentalBookingWriteError({ code: 'P2002' }), 'CONFLICT');
  assert.equal(
    classifyRentalBookingWriteError({ code: 'P2002' }, { retryUniqueConflict: true }),
    'RETRYABLE',
  );
});

test('classifies database relation and constraint guards as commercial conflicts', () => {
  assert.equal(classifyRentalBookingWriteError({ code: 'P2003' }), 'CONFLICT');
  assert.equal(classifyRentalBookingWriteError({ code: 'P2004' }), 'CONFLICT');
});

test('does not misclassify unknown or malformed errors', () => {
  assert.equal(classifyRentalBookingWriteError({ code: 'P2025' }), 'UNKNOWN');
  assert.equal(classifyRentalBookingWriteError(new Error('network failure')), 'UNKNOWN');
  assert.equal(classifyRentalBookingWriteError(null), 'UNKNOWN');
});
