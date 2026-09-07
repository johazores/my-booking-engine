import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTravelportStaysSyncRecoveryReference,
  parseTravelportStaysSyncRecoveryReference,
  TravelportStaysSyncRecoveryReferenceError,
} from './travelport-stays-sync-recovery-reference.ts';

test('round-trips only bounded Booking.com Sync authority evidence', () => {
  const reference = createTravelportStaysSyncRecoveryReference({
    offerAuthority: 'BKNG',
    supplierSource: 'BO',
  });
  assert.equal(reference, 'travelport-stays-sync-v1:BKNG:BO');
  assert.deepEqual(parseTravelportStaysSyncRecoveryReference(reference), {
    offerAuthority: 'BKNG',
    supplierSource: 'BO',
  });
});

test('rejects non-Booking.com, control-character, delimiter, and oversized authority values', () => {
  for (const input of [
    { offerAuthority: 'BKNG', supplierSource: 'XZ' },
    { offerAuthority: 'BKNG\n', supplierSource: 'BO' },
    { offerAuthority: 'BK:NG', supplierSource: 'BO' },
    { offerAuthority: 'A'.repeat(65), supplierSource: 'BO' },
    { offerAuthority: '', supplierSource: 'BO' },
  ]) {
    assert.throws(
      () => createTravelportStaysSyncRecoveryReference(input),
      TravelportStaysSyncRecoveryReferenceError,
    );
  }
});

test('rejects malformed or non-canonical durable references', () => {
  for (const value of [
    'travelport-stays-sync-v1:BKNG:XZ',
    'travelport-stays-sync-v1:BKNG:BO:extra',
    'travelport-stays-sync-v2:BKNG:BO',
    ' travelport-stays-sync-v1:BKNG:BO',
    'travelport-stays-sync-v1:BKNG\n:BO',
  ]) {
    assert.throws(() => parseTravelportStaysSyncRecoveryReference(value), TravelportStaysSyncRecoveryReferenceError);
  }
});
