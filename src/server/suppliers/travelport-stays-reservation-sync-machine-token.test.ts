import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTravelportStaysReservationSyncRequest } from './travelport-stays-reservation-sync-domain.ts';

const traveler = Object.freeze({
  firstName: 'Mary',
  lastName: 'Smith',
  email: 'mary@example.com',
  telephone: Object.freeze({
    countryCallingCode: '61',
    areaCode: '2',
    subscriberNumber: '91234567',
  }),
});

test('Travelport Sync rejects ASCII controls in durable supplier confirmation machine evidence', () => {
  for (const supplierConfirmationReference of [
    'T9R\u0000Y0-WQ842',
    'T9RY0\t-WQ842',
    'T9RY0-WQ842\u001f',
    'T9RY0-WQ842\u007f',
  ]) {
    assert.throws(
      () => buildTravelportStaysReservationSyncRequest({
        providerRecoveryReference: 'travelport-stays-sync-v1:BKNG:BO',
        supplierConfirmationReference,
        traveler,
      }),
      /supplier confirmation is invalid/i,
    );
  }
});
