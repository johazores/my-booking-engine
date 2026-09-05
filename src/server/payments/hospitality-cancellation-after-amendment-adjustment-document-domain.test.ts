import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
} from './hospitality-cancellation-after-amendment-adjustment-note-domain.ts';
import {
  createHospitalityIssuedAdjustmentNoteDocument,
} from './hospitality-issued-adjustment-note-document-domain.ts';
import {
  createHospitalityInvoiceRecipientSnapshot,
  hospitalityInvoiceRecipientFingerprint,
} from './hospitality-invoice-recipient-domain.ts';
import {
  createInvoiceIssuerProfileSnapshot,
  invoiceIssuerProfileFingerprint,
} from './invoice-issuer-domain.ts';

const issuer = createInvoiceIssuerProfileSnapshot({
  legalName: 'SF Hotels Pty Ltd',
  addressLine1: '1 Example Street',
  city: 'Sydney',
  region: 'NSW',
  postalCode: '2000',
  countryCode: 'AU',
  contactEmail: 'billing@example.com',
  registrations: [{ scheme: 'ABN', identifier: '51824753556', countryCode: 'AU' }],
});
const recipient = createHospitalityInvoiceRecipientSnapshot({
  recipientType: 'INDIVIDUAL',
  legalName: 'Guest Example',
  email: 'guest@example.com',
  addressLine1: '2 Guest Road',
  city: 'Melbourne',
  region: 'VIC',
  postalCode: '3000',
  countryCode: 'AU',
});

function snapshot() {
  return createHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot({
    organizationId: '11111111-1111-4111-8111-111111111111',
    bookingId: '22222222-2222-4222-8222-222222222222',
    sourceInvoiceId: '33333333-3333-4333-8333-333333333333',
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-05T01:00:00.000Z'),
    sourceAdjustmentOrdinal: 3,
    predecessorAdjustmentNoteId: '44444444-4444-4444-8444-444444444444',
    predecessorAdjustmentDocumentNumber: 'AU-ADJ-00000002',
    predecessorAdjustmentIssuedAt: new Date('2026-09-05T02:00:00.000Z'),
    predecessorAdjustmentDocumentFingerprint: 'a'.repeat(64),
    predecessorAfterPricingFingerprint: 'b'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    beforeTaxMinor: 1_000n,
    beforeTotalMinor: 11_000n,
    refundAuthorities: [
      {
        refundTransactionId: '55555555-5555-4555-8555-555555555555',
        refundOrdinal: 1,
        amountMinor: 8_800n,
        createdAt: new Date('2026-09-05T03:00:00.000Z'),
      },
      {
        refundTransactionId: '66666666-6666-4666-8666-666666666666',
        refundOrdinal: 2,
        amountMinor: 2_200n,
        createdAt: new Date('2026-09-05T03:10:00.000Z'),
      },
    ],
    documentNumber: 'AU-ADJ-00000003',
    sequenceValue: 3n,
    issuedAt: new Date('2026-09-05T04:00:00.000Z'),
    currency: 'AUD',
    sourceInvoiceFingerprint: 'c'.repeat(64),
    issuerFingerprint: invoiceIssuerProfileFingerprint(issuer),
    recipientFingerprint: hospitalityInvoiceRecipientFingerprint(recipient),
    issuer,
    recipient,
    supplierAbn: '51824753556',
  });
}

test('projects schema-version-6 terminal cancellation through the shared adjustment document contract', () => {
  const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot());
  assert.equal(document.adjustmentType, 'Decreasing adjustment');
  assert.equal(document.adjustmentReason, 'Booking cancellation');
  assert.equal(document.priceBeforeAdjustmentMinor, '11000');
  assert.equal(document.priceAfterAdjustmentMinor, '0');
  assert.equal(document.decreaseSubtotalMinor, '10000');
  assert.equal(document.decreaseGstMinor, '1000');
  assert.equal(document.decreaseTotalMinor, '11000');
  assert.equal(document.increaseTotalMinor, '0');
});
