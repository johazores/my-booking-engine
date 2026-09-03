import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvoiceIssuerValidationError,
  createInvoiceIssuerProfile,
  parseInvoiceIssuerProfileSnapshot,
} from './invoice-issuer-domain.ts';

const base = {
  legalName: '  SF Hospitality Pty Ltd  ',
  addressLine1: '  12  Example Street ',
  addressLine2: '',
  city: ' Sydney ',
  region: ' NSW ',
  postalCode: '2000',
  countryCode: 'au',
  contactEmail: ' BILLING@EXAMPLE.COM ',
  registrations: [
    { scheme: 'abn', identifier: '12 345 678 901', countryCode: 'au' },
    { scheme: 'gst', identifier: 'GST-123', countryCode: 'au' },
  ],
};

test('canonicalizes immutable issuer identity before fingerprinting', () => {
  const profile = createInvoiceIssuerProfile(base);
  assert.equal(profile.snapshot.legalName, 'SF Hospitality Pty Ltd');
  assert.equal(profile.snapshot.addressLine1, '12 Example Street');
  assert.equal(profile.snapshot.addressLine2, null);
  assert.equal(profile.snapshot.countryCode, 'AU');
  assert.equal(profile.snapshot.contactEmail, 'billing@example.com');
  assert.deepEqual(profile.snapshot.registrations.map((entry) => entry.scheme), ['ABN', 'GST']);
  assert.match(profile.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(profile.snapshot), true);
});

test('same semantic issuer input produces the same deterministic fingerprint', () => {
  const first = createInvoiceIssuerProfile(base);
  const second = createInvoiceIssuerProfile({
    ...base,
    legalName: 'SF Hospitality Pty Ltd',
    countryCode: 'AU',
    registrations: [...base.registrations].reverse(),
  });
  assert.equal(second.fingerprint, first.fingerprint);
  assert.deepEqual(second.snapshot, first.snapshot);
});

test('strict parser rejects unsupported or malformed persisted profiles', () => {
  const profile = createInvoiceIssuerProfile(base);
  assert.deepEqual(parseInvoiceIssuerProfileSnapshot(JSON.parse(JSON.stringify(profile.snapshot))), profile.snapshot);
  assert.throws(
    () => parseInvoiceIssuerProfileSnapshot({ ...profile.snapshot, schemaVersion: 2 }),
    InvoiceIssuerValidationError,
  );
  assert.throws(() => createInvoiceIssuerProfile({ ...base, countryCode: 'AUS' }), InvoiceIssuerValidationError);
  assert.throws(() => createInvoiceIssuerProfile({ ...base, contactEmail: 'not-an-email' }), InvoiceIssuerValidationError);
});

test('rejects duplicate and malformed registration identity', () => {
  assert.throws(
    () => createInvoiceIssuerProfile({ ...base, registrations: [base.registrations[0], base.registrations[0]] }),
    /duplicate/i,
  );
  assert.throws(
    () => createInvoiceIssuerProfile({ ...base, registrations: [{ scheme: 'bad scheme', identifier: '123', countryCode: 'AU' }] }),
    InvoiceIssuerValidationError,
  );
});
