import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHospitalityFrozenCommercialSettlementEvidence,
  HospitalityCommercialSettlementEvidenceIntegrityError,
} from './hospitality-commercial-settlement-evidence-service.ts';

const organizationId = '11111111-1111-4111-8111-111111111111';
const bookingId = '22222222-2222-4222-8222-222222222222';
const sourceInvoiceId = '33333333-3333-4333-8333-333333333333';
const firstNoteId = '44444444-4444-4444-8444-444444444444';
const firstAmendmentId = '55555555-5555-4555-8555-555555555555';
const secondNoteId = '66666666-6666-4666-8666-666666666666';
const secondAmendmentId = '77777777-7777-4777-8777-777777777777';
const paymentId = '88888888-8888-4888-8888-888888888888';
const issuedAt = new Date('2026-09-24T12:00:00.000Z');

const notes = [
  {
    id: firstNoteId,
    commercialAmendmentId: firstAmendmentId,
    sourceAdjustmentOrdinal: 1,
    issuedAt,
  },
  {
    id: secondNoteId,
    commercialAmendmentId: secondAmendmentId,
    sourceAdjustmentOrdinal: 2,
    issuedAt: new Date('2026-09-24T13:00:00.000Z'),
  },
] as const;

function header(overrides: Record<string, unknown> = {}) {
  return {
    adjustmentNoteId: firstNoteId,
    organizationId,
    bookingId,
    sourceInvoiceId,
    commercialAmendmentId: firstAmendmentId,
    sourceAdjustmentOrdinal: 1,
    schemaVersion: 1,
    issuedAt,
    transactionCount: 1,
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    settlementEvidenceId: firstNoteId,
    paymentTransactionId: paymentId,
    organizationId,
    bookingId,
    commercialAmendmentId: firstAmendmentId,
    kind: 'REFUND',
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 're_issue_time',
    sourceProviderReference: 'pi_original',
    currency: 'AUD',
    amountMinor: 1100n,
    sourceCreatedAt: new Date('2026-09-24T11:59:00.000Z'),
    ...overrides,
  };
}

test('frozen commercial settlement evidence preserves issue-time payment status and deterministic chronology', () => {
  const evidence = buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header()],
    transactionRows: [payment()],
  });

  assert.equal(evidence.size, 1);
  const transactions = evidence.get(firstNoteId);
  assert.ok(transactions);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0]!.status, 'SUCCEEDED');
  assert.equal(transactions[0]!.commercialAmendmentId, firstAmendmentId);
  assert.equal(transactions[0]!.createdAt.toISOString(), '2026-09-24T11:59:00.000Z');
  assert.equal(evidence.has(secondNoteId), false);
});

test('legacy adjustment notes without frozen evidence remain distinguishable from malformed evidence', () => {
  const evidence = buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [],
    transactionRows: [],
  });

  assert.equal(evidence.size, 0);
});

test('frozen evidence fails closed on tenant drift, incomplete rows, and post-issue transactions', () => {
  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header({ organizationId: '99999999-9999-4999-8999-999999999999' })],
    transactionRows: [payment()],
  }), HospitalityCommercialSettlementEvidenceIntegrityError);

  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header({ transactionCount: 2 })],
    transactionRows: [payment()],
  }), /transaction count/i);

  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header()],
    transactionRows: [payment({ sourceCreatedAt: new Date('2026-09-24T12:00:00.001Z') })],
  }), /invalid payment transaction/i);
});

test('frozen evidence rejects payment rows attributed outside the legal chain prefix', () => {
  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header()],
    transactionRows: [payment({ commercialAmendmentId: secondAmendmentId })],
  }), /invalid payment transaction/i);
});

test('frozen evidence rejects duplicate payment identities even when row counts match', () => {
  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header({ transactionCount: 2 })],
    transactionRows: [
      payment(),
      payment({ providerReference: 're_duplicate' }),
    ],
  }), /duplicate payment transaction identity/i);
});
