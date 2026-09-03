import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityInvoiceRecipientValidationError,
  createHospitalityInvoiceRecipientSnapshot,
  hospitalityInvoiceRecipientFingerprint,
  parseHospitalityInvoiceRecipientSnapshot,
} from './hospitality-invoice-recipient-domain.ts';

const business = {
  recipientType: 'BUSINESS' as const,
  legalName: ' Example Buyer Pty Ltd ',
  email: 'Accounts@Example.test',
  addressLine1: ' 10 Buyer Street ',
  city: 'Sydney',
  region: 'NSW',
  postalCode: '2000',
  countryCode: 'au',
  registrations: [{ scheme: 'abn', identifier: '51 824 753 556', countryCode: 'au' }],
};

test('normalizes and fingerprints immutable billing recipient evidence', () => {
  const snapshot = createHospitalityInvoiceRecipientSnapshot(business);
  assert.equal(snapshot.legalName, 'Example Buyer Pty Ltd');
  assert.equal(snapshot.email, 'accounts@example.test');
  assert.equal(snapshot.countryCode, 'AU');
  assert.equal(snapshot.registrations[0]?.scheme, 'ABN');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.match(hospitalityInvoiceRecipientFingerprint(snapshot), /^[a-f0-9]{64}$/);
  assert.deepEqual(parseHospitalityInvoiceRecipientSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
});

test('supports individual recipient identity without inventing a billing address', () => {
  const snapshot = createHospitalityInvoiceRecipientSnapshot({
    recipientType: 'INDIVIDUAL',
    legalName: 'Invoice Guest',
    email: 'guest@example.test',
  });
  assert.equal(snapshot.addressLine1, null);
  assert.equal(snapshot.countryCode, null);
  assert.deepEqual(snapshot.registrations, []);
});

test('rejects partial billing addresses, duplicate registrations, and malformed recipient types', () => {
  assert.throws(
    () => createHospitalityInvoiceRecipientSnapshot({ recipientType: 'BUSINESS', legalName: 'Buyer', city: 'Sydney' }),
    /addressLine1, city, and countryCode/i,
  );
  assert.throws(
    () => createHospitalityInvoiceRecipientSnapshot({
      ...business,
      registrations: [business.registrations[0], business.registrations[0]],
    }),
    /duplicate recipient registration/i,
  );
  assert.throws(
    () => createHospitalityInvoiceRecipientSnapshot({ recipientType: 'OTHER' as never, legalName: 'Buyer' }),
    HospitalityInvoiceRecipientValidationError,
  );
});
