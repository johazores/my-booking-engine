import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertHospitalitySupplierReservationTravelerPayloadAuthority,
  hospitalitySupplierReservationTravelerPayloadFingerprint,
  normalizeHospitalitySupplierReservationTravelerPayload,
} from './hospitality-supplier-reservation-traveler-authority.ts';

const traveler = {
  firstName: ' Ada ',
  lastName: ' Lovelace ',
  email: ' ADA@Example.COM ',
  telephone: {
    countryCallingCode: '61',
    areaCode: '2',
    subscriberNumber: '98765432',
  },
} as const;

test('normalizes one primary traveler without provider or payment fields', () => {
  assert.deepEqual(normalizeHospitalitySupplierReservationTravelerPayload(traveler), {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    telephone: {
      countryCallingCode: '61',
      areaCode: '2',
      subscriberNumber: '98765432',
    },
  });
});

test('fingerprint is deterministic across canonical whitespace and email casing', () => {
  const first = hospitalitySupplierReservationTravelerPayloadFingerprint(traveler);
  const second = hospitalitySupplierReservationTravelerPayloadFingerprint({
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    telephone: {
      countryCallingCode: '61',
      areaCode: '2',
      subscriberNumber: '98765432',
    },
  });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(second, first);
});

test('traveler authority rejects changed contact or identity evidence', () => {
  const expectedFingerprint = hospitalitySupplierReservationTravelerPayloadFingerprint(traveler);
  assert.deepEqual(
    assertHospitalitySupplierReservationTravelerPayloadAuthority({ expectedFingerprint, traveler }),
    normalizeHospitalitySupplierReservationTravelerPayload(traveler),
  );
  assert.throws(
    () => assertHospitalitySupplierReservationTravelerPayloadAuthority({
      expectedFingerprint,
      traveler: { ...traveler, email: 'other@example.com' },
    }),
    /changed after/i,
  );
  assert.throws(
    () => assertHospitalitySupplierReservationTravelerPayloadAuthority({
      expectedFingerprint,
      traveler: {
        ...traveler,
        telephone: { ...traveler.telephone, subscriberNumber: '12345678' },
      },
    }),
    /changed after/i,
  );
});

test('rejects malformed identity, email and telephone components', () => {
  for (const invalidTraveler of [
    null,
    [],
    { ...traveler, firstName: '' },
    { ...traveler, firstName: 'Ada\nInjected' },
    { ...traveler, lastName: 'x'.repeat(81) },
    { ...traveler, email: 'invalid' },
    { ...traveler, telephone: null },
    { ...traveler, telephone: { ...traveler.telephone, countryCallingCode: '+61' } },
    { ...traveler, telephone: { ...traveler.telephone, areaCode: '' } },
    { ...traveler, telephone: { ...traveler.telephone, subscriberNumber: '12' } },
  ]) {
    assert.throws(
      () => normalizeHospitalitySupplierReservationTravelerPayload(
        invalidTraveler as typeof traveler,
      ),
      /traveler|telephone/i,
    );
  }
});
