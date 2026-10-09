import assert from 'node:assert/strict';
import test from 'node:test';

import { readHospitalityPaymentReceiptHistory, HOSPITALITY_PAYMENT_RECEIPT_PAGE_SIZE } from './hospitality-payment-receipt-history.ts';
import { readHospitalityPaymentSettlementHistory, HOSPITALITY_PAYMENT_SETTLEMENT_PAGE_SIZE } from './hospitality-payment-history.ts';
import { readHospitalityPaymentOperationHistory, HOSPITALITY_PAYMENT_OPERATION_PAGE_SIZE } from './hospitality-payment-operation-history.ts';
import { readHospitalityPaymentRecoveryHistory, HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE } from './hospitality-payment-recovery-history.ts';
import { readHospitalityLegalPaymentEvidenceHistory, HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE } from './hospitality-legal-payment-evidence-history.ts';
import { readRentalPaymentSettlementHistory, RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE } from './rental-payment-history.ts';

const readers = [
  { name: 'hospitality receipt', read: readHospitalityPaymentReceiptHistory, pageSize: HOSPITALITY_PAYMENT_RECEIPT_PAGE_SIZE, delegate: 'paymentTransaction' },
  { name: 'hospitality settlement', read: readHospitalityPaymentSettlementHistory, pageSize: HOSPITALITY_PAYMENT_SETTLEMENT_PAGE_SIZE, delegate: 'paymentTransaction' },
  { name: 'hospitality operation', read: readHospitalityPaymentOperationHistory, pageSize: HOSPITALITY_PAYMENT_OPERATION_PAGE_SIZE, delegate: 'paymentTransaction' },
  { name: 'hospitality recovery', read: readHospitalityPaymentRecoveryHistory, pageSize: HOSPITALITY_PAYMENT_RECOVERY_PAGE_SIZE, delegate: 'paymentTransaction' },
  { name: 'hospitality legal evidence', read: readHospitalityLegalPaymentEvidenceHistory, pageSize: HOSPITALITY_LEGAL_PAYMENT_EVIDENCE_PAGE_SIZE, delegate: 'paymentTransaction' },
  { name: 'rental settlement', read: readRentalPaymentSettlementHistory, pageSize: RENTAL_PAYMENT_SETTLEMENT_PAGE_SIZE, delegate: 'rentalPaymentTransaction' },
] as const;

function row(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    organizationId: 'org-a',
    bookingId: 'booking-a',
    commercialAmendmentId: null,
    idempotencyKey: `operation-${index}`,
    requestFingerprint: null,
    kind: 'CAPTURE' as const,
    status: 'SUCCEEDED' as const,
    providerCode: 'stripe',
    providerReference: `payment-${index}`,
    sourceProviderReference: null,
    currency: 'AUD',
    amountMinor: 100n,
    createdAt: new Date(Date.UTC(2026, 9, 9, 0, 0, index)),
  };
}

for (const spec of readers) {
  test(`${spec.name} rejects duplicate, repeated-cursor and oversized payment pages`, async () => {
    const first = row(1);
    const duplicate = await spec.read({
      transaction: { [spec.delegate]: { async findMany() { return [first, first]; } } } as never,
      organizationId: first.organizationId,
      bookingId: first.bookingId,
    });
    assert.equal(duplicate.complete, false);
    if (!duplicate.complete) assert.match(duplicate.reason, /duplicate, missing, or out-of-order transaction IDs/i);

    const page = Array.from({ length: spec.pageSize }, (_, index) => row(index + 1));
    let calls = 0;
    const repeated = await spec.read({
      transaction: { [spec.delegate]: { async findMany() { calls += 1; return page; } } } as never,
      organizationId: first.organizationId,
      bookingId: first.bookingId,
    });
    assert.equal(repeated.complete, false);
    if (!repeated.complete) assert.match(repeated.reason, /out-of-order transaction IDs/i);
    assert.equal(calls, 2);

    const oversized = await spec.read({
      transaction: { [spec.delegate]: { async findMany() { return [...page, row(spec.pageSize + 1)]; } } } as never,
      organizationId: first.organizationId,
      bookingId: first.bookingId,
    });
    assert.equal(oversized.complete, false);
    if (!oversized.complete) assert.match(oversized.reason, /oversized transaction page/i);
  });
}

test('legal payment history rejects evidence later than the requested issue time', async () => {
  const result = await readHospitalityLegalPaymentEvidenceHistory({
    transaction: { paymentTransaction: { async findMany() { return [row(2)]; } } } as never,
    organizationId: 'org-a',
    bookingId: 'booking-a',
    through: row(1).createdAt,
  });
  assert.equal(result.complete, false);
  if (!result.complete) assert.match(result.reason, /issue-time horizon/i);
});
