import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HospitalityIssuedInvoiceValidationError,
  canonicalHospitalityIssuedInvoiceJson,
  createHospitalityIssuedTaxInvoiceSnapshot,
  formatAustralianTaxInvoiceDocumentNumber,
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  preparationId: '33333333-3333-4333-8333-333333333333',
  pricingEvidenceId: '44444444-4444-4444-8444-444444444444',
  issuerProfileId: '55555555-5555-4555-8555-555555555555',
};

function createSnapshot(overrides: Record<string, unknown> = {}) {
  return createHospitalityIssuedTaxInvoiceSnapshot({
    ...ids,
    documentNumber: 'AU-TAX-00000001',
    sequenceValue: 1n,
    issuedAt: new Date('2026-09-04T00:00:00.000Z'),
    currency: 'AUD',
    accommodationSubtotalMinor: 10000n,
    taxTotalMinor: 1100n,
    feeTotalMinor: 0n,
    addonTotalMinor: 0n,
    totalMinor: 11100n,
    preparationFingerprint: 'a'.repeat(64),
    pricingFingerprint: 'b'.repeat(64),
    issuerFingerprint: 'c'.repeat(64),
    recipientFingerprint: 'd'.repeat(64),
    issuer: { schemaVersion: 1, legalName: 'SF Hotel Pty Ltd', registrations: [{ scheme: 'ABN', identifier: '51824753556' }] },
    recipient: { schemaVersion: 1, recipientType: 'INDIVIDUAL', legalName: 'Guest One', registrations: [] },
    pricing: { schemaVersion: 1, charges: [{ code: 'GST', amountMinor: '1100' }] },
    supplierAbn: '51824753556',
    buyerIdentityRequired: false,
    buyerIdentity: 'Guest One',
    buyerAbn: null,
    ...overrides,
  });
}

test('formats stable tenant-local Australian tax invoice document numbers', () => {
  assert.equal(formatAustralianTaxInvoiceDocumentNumber(1n), 'AU-TAX-00000001');
  assert.equal(formatAustralianTaxInvoiceDocumentNumber(123456789n), 'AU-TAX-123456789');
  assert.throws(() => formatAustralianTaxInvoiceDocumentNumber(0n), HospitalityIssuedInvoiceValidationError);
});

test('freezes sequence and money as JSON-safe strings', () => {
  const snapshot = createSnapshot();
  assert.equal(snapshot.sequenceValue, '1');
  assert.equal(snapshot.totalMinor, '11100');
  assert.equal(snapshot.kind, 'TAX_INVOICE');
  assert.equal(snapshot.jurisdictionCode, 'AU');
});

test('rejects document numbers that do not match the allocated sequence', () => {
  assert.throws(() => createSnapshot({ documentNumber: 'AU-TAX-00000002' }), /allocated/i);
});

test('rejects unreconciled money', () => {
  assert.throws(() => createSnapshot({ totalMinor: 11101n }), /reconcile/i);
});

test('requires verified buyer identity when the Australian threshold applies', () => {
  assert.throws(() => createSnapshot({ buyerIdentityRequired: true, buyerIdentity: null, buyerAbn: null }), /buyer identity/i);
});

test('canonical JSON and fingerprint do not depend on nested object key order', () => {
  const left = createSnapshot({ issuer: { schemaVersion: 1, legalName: 'SF Hotel Pty Ltd', countryCode: 'AU' } });
  const right = createSnapshot({ issuer: { countryCode: 'AU', legalName: 'SF Hotel Pty Ltd', schemaVersion: 1 } });
  assert.equal(canonicalHospitalityIssuedInvoiceJson(left), canonicalHospitalityIssuedInvoiceJson(right));
  assert.equal(hospitalityIssuedInvoiceFingerprint(left), hospitalityIssuedInvoiceFingerprint(right));
});

test('document fingerprint changes when frozen legal evidence changes', () => {
  const left = createSnapshot();
  const right = createSnapshot({ recipient: { schemaVersion: 1, recipientType: 'INDIVIDUAL', legalName: 'Guest Two', registrations: [] } });
  assert.notEqual(hospitalityIssuedInvoiceFingerprint(left), hospitalityIssuedInvoiceFingerprint(right));
});

test('parses and revalidates a persisted issued invoice snapshot', () => {
  const original = createSnapshot();
  const parsed = parseHospitalityIssuedTaxInvoiceSnapshot(JSON.parse(JSON.stringify(original)));
  assert.equal(hospitalityIssuedInvoiceFingerprint(parsed), hospitalityIssuedInvoiceFingerprint(original));
});
