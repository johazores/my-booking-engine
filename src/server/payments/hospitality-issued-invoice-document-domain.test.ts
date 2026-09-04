import assert from 'node:assert/strict';
import test from 'node:test';

import { createHospitalityPricingBreakdownSnapshot } from '../bookings/booking-domain.ts';
import { createHospitalityIssuedTaxInvoiceSnapshot } from './hospitality-issued-invoice-domain.ts';
import {
  HospitalityIssuedInvoiceDocumentValidationError,
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import { createHospitalityInvoiceRecipientSnapshot, hospitalityInvoiceRecipientFingerprint } from './hospitality-invoice-recipient-domain.ts';
import { createInvoiceIssuerProfileSnapshot, invoiceIssuerProfileFingerprint } from './invoice-issuer-domain.ts';

const issuer = createInvoiceIssuerProfileSnapshot({
  legalName: 'SF Hotel Pty Ltd',
  addressLine1: '1 Harbour Street',
  city: 'Sydney',
  region: 'NSW',
  postalCode: '2000',
  countryCode: 'AU',
  registrations: [
    { scheme: 'ABN', identifier: '51824753556', countryCode: 'AU' },
    { scheme: 'GST', identifier: '51824753556', countryCode: 'AU' },
  ],
});
const recipient = createHospitalityInvoiceRecipientSnapshot({
  recipientType: 'INDIVIDUAL',
  legalName: 'Guest One',
  email: 'guest@example.com',
});
const pricing = createHospitalityPricingBreakdownSnapshot({
  currency: 'AUD',
  quantity: 2,
  accommodationSubtotalMinor: '90000',
  taxTotalMinor: '10000',
  feeTotalMinor: '10000',
  addonTotalMinor: '0',
  totalMinor: '110000',
  pricingFingerprint: 'b'.repeat(64),
  nightly: [
    { date: '2026-09-10', amountMinor: '22500' },
    { date: '2026-09-11', amountMinor: '22500' },
  ],
  charges: [
    { id: '11111111-1111-4111-8111-111111111111', code: 'GST', name: 'GST', kind: 'TAX', calculation: 'PERCENTAGE', amountMinor: '10000' },
    { id: '22222222-2222-4222-8222-222222222222', code: 'SERVICE_FEE', name: 'Service fee', kind: 'FEE', calculation: 'FIXED_PER_BOOKING', amountMinor: '10000' },
  ],
  addons: [],
});

function issuedSnapshot() {
  return createHospitalityIssuedTaxInvoiceSnapshot({
    organizationId: '33333333-3333-4333-8333-333333333333',
    bookingId: '44444444-4444-4444-8444-444444444444',
    preparationId: '55555555-5555-4555-8555-555555555555',
    pricingEvidenceId: '66666666-6666-4666-8666-666666666666',
    issuerProfileId: '77777777-7777-4777-8777-777777777777',
    documentNumber: 'AU-TAX-00000001',
    sequenceValue: 1n,
    issuedAt: new Date('2026-09-04T00:00:00.000Z'),
    currency: 'AUD',
    accommodationSubtotalMinor: 90000n,
    taxTotalMinor: 10000n,
    feeTotalMinor: 10000n,
    addonTotalMinor: 0n,
    totalMinor: 110000n,
    preparationFingerprint: 'a'.repeat(64),
    pricingFingerprint: pricing.pricingFingerprint,
    issuerFingerprint: invoiceIssuerProfileFingerprint(issuer),
    recipientFingerprint: hospitalityInvoiceRecipientFingerprint(recipient),
    issuer,
    recipient,
    pricing,
    supplierAbn: '51824753556',
    buyerIdentityRequired: true,
    buyerIdentity: 'Guest One',
    buyerAbn: null,
  });
}

test('builds customer-safe Australian tax invoice supply lines from immutable evidence', () => {
  const document = createHospitalityIssuedTaxInvoiceDocument(issuedSnapshot());
  assert.equal(document.documentTitle, 'Tax invoice');
  assert.equal(document.documentNumber, 'AU-TAX-00000001');
  assert.equal(document.issuedAt, '2026-09-04T00:00:00.000Z');
  assert.equal(document.lines.length, 3);
  assert.deepEqual(document.lines.map((line) => line.amountMinor), ['45000', '45000', '10000']);
  assert.equal(document.subtotalBeforeGstMinor, '100000');
  assert.equal(document.gstMinor, '10000');
  assert.equal(document.totalMinor, '110000');
  assert.equal(document.supplierAbn, '51824753556');
});

test('fails closed when nested issuer evidence drifts from its frozen fingerprint', () => {
  const snapshot = issuedSnapshot();
  assert.throws(
    () => createHospitalityIssuedTaxInvoiceDocument({ ...snapshot, issuer: { ...issuer, legalName: 'Changed Hotel Pty Ltd' } }),
    HospitalityIssuedInvoiceDocumentValidationError,
  );
});

test('fails closed when frozen pricing no longer satisfies the Australian invoice contract', () => {
  const snapshot = issuedSnapshot();
  const changedPricing = { ...pricing, taxTotalMinor: '9999' };
  assert.throws(
    () => createHospitalityIssuedTaxInvoiceDocument({ ...snapshot, pricing: changedPricing }),
    HospitalityIssuedInvoiceDocumentValidationError,
  );
});
