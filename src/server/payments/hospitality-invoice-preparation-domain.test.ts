import assert from 'node:assert/strict';
import test from 'node:test';

import { createHospitalityInvoiceRecipientSnapshot } from './hospitality-invoice-recipient-domain.ts';
import {
  HospitalityInvoicePreparationValidationError,
  createHospitalityInvoicePreparationSnapshot,
  hospitalityInvoicePreparationFingerprint,
  hospitalityInvoicePreparationKey,
  parseHospitalityInvoicePreparationSnapshot,
} from './hospitality-invoice-preparation-domain.ts';

const recipient = createHospitalityInvoiceRecipientSnapshot({
  recipientType: 'INDIVIDUAL',
  legalName: 'Invoice Guest',
  email: 'guest@example.test',
});

const input = {
  pricingEvidenceId: '11111111-1111-4111-8111-111111111111',
  issuerProfileId: '22222222-2222-4222-8222-222222222222',
  currency: 'usd',
  accommodationSubtotalMinor: 40000n,
  taxTotalMinor: 4000n,
  feeTotalMinor: 1000n,
  addonTotalMinor: 1200n,
  totalMinor: 46200n,
  pricingFingerprint: 'a'.repeat(64),
  issuerFingerprint: 'b'.repeat(64),
  recipient,
};

test('builds deterministic v2 preparation evidence bound to an immutable recipient', () => {
  const snapshot = createHospitalityInvoicePreparationSnapshot(input);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.totalMinor, '46200');
  assert.equal(snapshot.recipient.legalName, 'Invoice Guest');
  assert.match(snapshot.recipientFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.match(hospitalityInvoicePreparationFingerprint(snapshot), /^[a-f0-9]{64}$/);
  const key = hospitalityInvoicePreparationKey({ organizationId: '33333333-3333-4333-8333-333333333333', bookingId: '44444444-4444-4444-8444-444444444444', snapshot });
  assert.match(key, /^invoice-preparation:v2:[a-f0-9]{64}$/);
  assert.equal(
    key,
    hospitalityInvoicePreparationKey({ organizationId: '33333333-3333-4333-8333-333333333333', bookingId: '44444444-4444-4444-8444-444444444444', snapshot }),
  );
});

test('strict parser round-trips current preparation evidence and rejects recipient drift', () => {
  const snapshot = createHospitalityInvoicePreparationSnapshot(input);
  assert.deepEqual(parseHospitalityInvoicePreparationSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.throws(
    () => parseHospitalityInvoicePreparationSnapshot({ ...snapshot, recipient: { ...snapshot.recipient, legalName: 'Changed Buyer' } }),
    /recipient fingerprint/i,
  );
});

test('continues parsing legacy v1 preparation evidence without treating it as current issuance authority', () => {
  const legacy = {
    schemaVersion: 1,
    kind: 'INVOICE',
    pricingEvidenceId: input.pricingEvidenceId,
    issuerProfileId: input.issuerProfileId,
    currency: 'USD',
    accommodationSubtotalMinor: '40000',
    taxTotalMinor: '4000',
    feeTotalMinor: '1000',
    addonTotalMinor: '1200',
    totalMinor: '46200',
    pricingFingerprint: input.pricingFingerprint,
    issuerFingerprint: input.issuerFingerprint,
  } as const;
  const parsed = parseHospitalityInvoicePreparationSnapshot(legacy);
  assert.equal(parsed.schemaVersion, 1);
  assert.match(hospitalityInvoicePreparationKey({ organizationId: '33333333-3333-4333-8333-333333333333', bookingId: '44444444-4444-4444-8444-444444444444', snapshot: parsed }), /^invoice-preparation:v1:/);
});

test('rejects aggregate money drift and malformed fingerprints', () => {
  assert.throws(
    () => createHospitalityInvoicePreparationSnapshot({ ...input, totalMinor: 46199n }),
    /do not reconcile/i,
  );
  assert.throws(
    () => createHospitalityInvoicePreparationSnapshot({ ...input, pricingFingerprint: 'not-a-fingerprint' }),
    HospitalityInvoicePreparationValidationError,
  );
});

test('rejects unsupported persisted legal-document shape', () => {
  const snapshot = createHospitalityInvoicePreparationSnapshot(input);
  assert.throws(
    () => parseHospitalityInvoicePreparationSnapshot({ ...snapshot, kind: 'CREDIT_NOTE' }),
    HospitalityInvoicePreparationValidationError,
  );
  assert.throws(
    () => parseHospitalityInvoicePreparationSnapshot({ ...snapshot, totalMinor: '-1' }),
    HospitalityInvoicePreparationValidationError,
  );
});
