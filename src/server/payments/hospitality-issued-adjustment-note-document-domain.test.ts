import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot,
} from './hospitality-commercial-amendment-adjustment-note-domain.ts';
import {
  createHospitalityIssuedAdjustmentNoteDocument,
} from './hospitality-issued-adjustment-note-document-domain.ts';
import {
  createHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';
import {
  createHospitalityInvoiceRecipientSnapshot,
  hospitalityInvoiceRecipientFingerprint,
} from './hospitality-invoice-recipient-domain.ts';
import {
  createInvoiceIssuerProfileSnapshot,
  invoiceIssuerProfileFingerprint,
} from './invoice-issuer-domain.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  bookingId: '22222222-2222-4222-8222-222222222222',
  sourceInvoiceId: '33333333-3333-4333-8333-333333333333',
};

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
const issuerFingerprint = invoiceIssuerProfileFingerprint(issuer);
const recipientFingerprint = hospitalityInvoiceRecipientFingerprint(recipient);

function cancellationSnapshot() {
  return createHospitalityIssuedCancellationAdjustmentNoteSnapshot({
    ...ids,
    refundTransactionId: '44444444-4444-4444-8444-444444444444',
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    documentNumber: 'AU-ADJ-00000001',
    sequenceValue: 1n,
    issuedAt: new Date('2026-09-04T02:00:00.000Z'),
    currency: 'AUD',
    decreaseTotalMinor: 11_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    issuerFingerprint,
    recipientFingerprint,
    issuer,
    recipient,
    supplierAbn: '51824753556',
  });
}

function commercialSnapshot() {
  return createHospitalityIssuedCommercialAmendmentAdjustmentNoteSnapshot({
    ...ids,
    commercialAmendmentId: '44444444-4444-4444-8444-444444444444',
    targetPricingEvidenceId: '55555555-5555-4555-8555-555555555555',
    sourceInvoiceDocumentNumber: 'AU-TAX-00000001',
    sourceInvoiceIssuedAt: new Date('2026-09-04T01:00:00.000Z'),
    commercialAmendmentAppliedAt: new Date('2026-09-04T02:00:00.000Z'),
    sourceAdjustmentOrdinal: 1,
    documentNumber: 'AU-ADJ-00000002',
    sequenceValue: 2n,
    issuedAt: new Date('2026-09-04T03:00:00.000Z'),
    currency: 'AUD',
    beforeTaxMinor: 10_000n,
    beforeTotalMinor: 110_000n,
    afterTaxMinor: 8_000n,
    afterTotalMinor: 88_000n,
    sourceInvoiceFingerprint: 'a'.repeat(64),
    beforePricingFingerprint: 'b'.repeat(64),
    afterPricingFingerprint: 'c'.repeat(64),
    issuerFingerprint,
    recipientFingerprint,
    issuer,
    recipient,
    supplierAbn: '51824753556',
  });
}

test('projects cancellation and commercial-amendment evidence through one legal document contract', () => {
  const cancellation = createHospitalityIssuedAdjustmentNoteDocument(cancellationSnapshot());
  const commercial = createHospitalityIssuedAdjustmentNoteDocument(commercialSnapshot());

  assert.equal(cancellation.adjustmentReason, 'Booking cancellation');
  assert.equal(cancellation.priceBeforeAdjustmentMinor, '11000');
  assert.equal(cancellation.priceAfterAdjustmentMinor, '0');
  assert.equal(commercial.adjustmentReason, 'Commercial booking amendment');
  assert.equal(commercial.priceBeforeAdjustmentMinor, '110000');
  assert.equal(commercial.priceAfterAdjustmentMinor, '88000');
  assert.equal(commercial.decreaseTotalMinor, '22000');
});

test('fails closed when party fingerprints do not match the frozen legal evidence', () => {
  const snapshot = commercialSnapshot();
  assert.throws(() => createHospitalityIssuedAdjustmentNoteDocument({
    ...snapshot,
    issuerFingerprint: 'f'.repeat(64),
  }), /party evidence/);
});

test('fails closed for an unknown adjustment-note authority contract', () => {
  assert.throws(() => createHospitalityIssuedAdjustmentNoteDocument({ adjustmentReason: 'OTHER' }), /Unsupported/);
});
