import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityInvoicePreparationValidationError,
  createHospitalityInvoicePreparationSnapshot,
  hospitalityInvoicePreparationFingerprint,
  hospitalityInvoicePreparationKey,
  parseHospitalityInvoicePreparationSnapshot,
} from './hospitality-invoice-preparation-domain.ts';

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
};

test('builds a deterministic immutable invoice preparation snapshot', () => {
  const snapshot = createHospitalityInvoicePreparationSnapshot(input);
  assert.equal(snapshot.currency, 'USD');
  assert.equal(snapshot.totalMinor, '46200');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.match(hospitalityInvoicePreparationFingerprint(snapshot), /^[a-f0-9]{64}$/);
  assert.equal(
    hospitalityInvoicePreparationKey({ organizationId: '33333333-3333-4333-8333-333333333333', bookingId: '44444444-4444-4444-8444-444444444444', snapshot }),
    hospitalityInvoicePreparationKey({ organizationId: '33333333-3333-4333-8333-333333333333', bookingId: '44444444-4444-4444-8444-444444444444', snapshot }),
  );
});

test('strict parser round-trips persisted preparation evidence', () => {
  const snapshot = createHospitalityInvoicePreparationSnapshot(input);
  assert.deepEqual(parseHospitalityInvoicePreparationSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
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
