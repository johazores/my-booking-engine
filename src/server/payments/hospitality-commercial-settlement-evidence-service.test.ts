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
const secondPaymentId = '99999999-9999-4999-8999-999999999999';
const issuedAt = new Date('2026-09-24T12:00:00.000Z');
const secondIssuedAt = new Date('2026-09-24T13:00:00.000Z');

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
    issuedAt: secondIssuedAt,
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

function secondHeader(overrides: Record<string, unknown> = {}) {
  return {
    adjustmentNoteId: secondNoteId,
    organizationId,
    bookingId,
    sourceInvoiceId,
    commercialAmendmentId: secondAmendmentId,
    sourceAdjustmentOrdinal: 2,
    schemaVersion: 1,
    issuedAt: secondIssuedAt,
    transactionCount: 2,
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

function priorPaymentInSecondEvidence(overrides: Record<string, unknown> = {}) {
  return payment({
    settlementEvidenceId: secondNoteId,
    ...overrides,
  });
}

function secondPayment(overrides: Record<string, unknown> = {}) {
  return {
    settlementEvidenceId: secondNoteId,
    paymentTransactionId: secondPaymentId,
    organizationId,
    bookingId,
    commercialAmendmentId: secondAmendmentId,
    kind: 'CAPTURE',
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: 'pi_second',
    sourceProviderReference: null,
    currency: 'AUD',
    amountMinor: 2200n,
    sourceCreatedAt: new Date('2026-09-24T12:59:00.000Z'),
    ...overrides,
  };
}

test('frozen commercial settlement evidence preserves issue-time payment status and deterministic chronology', () => {
  const evidence = buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header(), secondHeader()],
    transactionRows: [payment(), priorPaymentInSecondEvidence(), secondPayment()],
  });

  assert.equal(evidence.size, 2);
  const transactions = evidence.get(firstNoteId);
  assert.ok(transactions);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0]!.status, 'SUCCEEDED');
  assert.equal(transactions[0]!.commercialAmendmentId, firstAmendmentId);
  assert.equal(transactions[0]!.createdAt.toISOString(), '2026-09-24T11:59:00.000Z');
  assert.equal(evidence.has(secondNoteId), true);
});

test('legacy adjustment notes may form only a leading prefix before frozen evidence begins', () => {
  const evidence = buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [secondHeader()],
    transactionRows: [priorPaymentInSecondEvidence(), secondPayment()],
  });

  assert.equal(evidence.size, 1);
  assert.equal(evidence.has(firstNoteId), false);
  assert.equal(evidence.has(secondNoteId), true);
});

test('a missing frozen header after capture begins fails closed instead of falling back to mutable payment state', () => {
  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header()],
    transactionRows: [payment()],
  }), /cannot contain gaps after capture begins/i);
});

test('later frozen evidence cannot drop payment identities captured by an earlier frozen note', () => {
  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: notes,
    headers: [header(), secondHeader({ transactionCount: 1 })],
    transactionRows: [payment(), secondPayment()],
  }), /cannot drop previously frozen payment identities/i);
});

test('fully legacy adjustment chains without frozen evidence remain supported', () => {
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
    adjustmentNotes: [notes[0]],
    headers: [header({ organizationId: '99999999-9999-4999-8999-999999999999' })],
    transactionRows: [payment()],
  }), HospitalityCommercialSettlementEvidenceIntegrityError);

  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: [notes[0]],
    headers: [header({ transactionCount: 2 })],
    transactionRows: [payment()],
  }), /transaction count/i);

  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: [notes[0]],
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
    headers: [header(), secondHeader()],
    transactionRows: [payment({ commercialAmendmentId: secondAmendmentId }), secondPayment()],
  }), /invalid payment transaction/i);
});

test('frozen evidence rejects duplicate payment identities even when row counts match', () => {
  assert.throws(() => buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId,
    bookingId,
    sourceInvoiceId,
    adjustmentNotes: [notes[0]],
    headers: [header({ transactionCount: 2 })],
    transactionRows: [
      payment(),
      payment({ providerReference: 're_duplicate' }),
    ],
  }), /duplicate payment transaction identity/i);
});
