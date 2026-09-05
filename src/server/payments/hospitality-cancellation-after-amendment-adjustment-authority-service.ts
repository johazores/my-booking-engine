import type { Prisma } from '../../generated/prisma/client.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness,
} from './hospitality-cancellation-after-amendment-adjustment-domain.ts';
import {
  hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot,
} from './hospitality-cancellation-after-amendment-adjustment-note-domain.ts';
import {
  loadVerifiedHospitalityCommercialAmendmentAdjustmentChain,
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';

export type HospitalityCancellationAfterAmendmentAdjustmentAuthorityRow = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  refundTransactionId: string | null;
  commercialAmendmentId: string | null;
  targetPricingEvidenceId: string | null;
  predecessorAdjustmentNoteId: string | null;
  predecessorSourceAdjustmentOrdinal: number | null;
  sourceAdjustmentOrdinal: number;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  adjustmentType: string;
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseTaxMinor: bigint;
  decreaseTotalMinor: bigint;
  increaseSubtotalMinor: bigint;
  increaseTaxMinor: bigint;
  increaseTotalMinor: bigint;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  documentSnapshot: Prisma.JsonValue;
}>;

export class HospitalityCancellationAfterAmendmentAdjustmentAuthorityError extends Error {
  constructor(message = 'Cancellation-after-amendment adjustment-note authority failed integrity validation.') {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentAuthorityError';
  }
}

function fail(message: string): never {
  throw new HospitalityCancellationAfterAmendmentAdjustmentAuthorityError(message);
}

function timestamp(value: Date | string) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function sameTime(left: Date | string, right: Date | string) {
  return timestamp(left) === timestamp(right);
}

function verifyFrozenRefundAuthorities(input: {
  expected: readonly Readonly<{
    refundTransactionId: string;
    refundOrdinal: number;
    amountMinor: bigint;
    createdAt: Date;
  }>[];
  frozen: readonly Readonly<{
    refundTransactionId: string;
    refundOrdinal: string;
    amountMinor: string;
    createdAt: string;
  }>[];
}) {
  if (input.expected.length !== input.frozen.length) {
    fail('Cancellation refund authority count no longer matches payment truth at issue time.');
  }
  for (let index = 0; index < input.expected.length; index += 1) {
    const expected = input.expected[index]!;
    const frozen = input.frozen[index]!;
    if (
      expected.refundTransactionId !== frozen.refundTransactionId
      || expected.refundOrdinal.toString() !== frozen.refundOrdinal
      || expected.amountMinor.toString() !== frozen.amountMinor
      || !sameTime(expected.createdAt, frozen.createdAt)
    ) {
      fail('Cancellation refund authority no longer matches payment truth at issue time.');
    }
  }
}

async function verifyRow(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  row: HospitalityCancellationAfterAmendmentAdjustmentAuthorityRow;
}) {
  const snapshot = parseHospitalityIssuedCancellationAfterAmendmentAdjustmentNoteSnapshot(input.row.documentSnapshot);
  if (
    snapshot.organizationId !== input.organizationId
    || snapshot.organizationId !== input.row.organizationId
    || snapshot.bookingId !== input.row.bookingId
    || snapshot.sourceInvoiceId !== input.row.sourceInvoiceId
    || snapshot.documentNumber !== input.row.documentNumber
    || BigInt(snapshot.sequenceValue) !== input.row.sequenceValue
    || !sameTime(snapshot.issuedAt, input.row.issuedAt)
    || snapshot.currency !== input.row.currency
    || Number(snapshot.sourceAdjustmentOrdinal) !== input.row.sourceAdjustmentOrdinal
    || snapshot.predecessorAdjustmentNoteId !== input.row.predecessorAdjustmentNoteId
    || Number(snapshot.sourceAdjustmentOrdinal) - 1 !== input.row.predecessorSourceAdjustmentOrdinal
    || BigInt(snapshot.decreaseSubtotalMinor) !== input.row.decreaseSubtotalMinor
    || BigInt(snapshot.decreaseTaxMinor) !== input.row.decreaseTaxMinor
    || BigInt(snapshot.decreaseTotalMinor) !== input.row.decreaseTotalMinor
    || input.row.increaseSubtotalMinor !== 0n
    || input.row.increaseTaxMinor !== 0n
    || input.row.increaseTotalMinor !== 0n
    || snapshot.sourceInvoiceFingerprint !== input.row.sourceInvoiceFingerprint
    || snapshot.issuerFingerprint !== input.row.issuerFingerprint
    || snapshot.recipientFingerprint !== input.row.recipientFingerprint
    || hospitalityIssuedCancellationAfterAmendmentAdjustmentNoteFingerprint(snapshot) !== input.row.documentFingerprint
  ) {
    fail('Cancellation-after-amendment row does not match its immutable schema-version-6 evidence.');
  }

  const chain = await loadVerifiedHospitalityCommercialAmendmentAdjustmentChain({
    transaction: input.transaction,
    organizationId: input.organizationId,
    bookingId: input.row.bookingId,
    sourceInvoiceId: input.row.sourceInvoiceId,
    allowTerminalCancellation: true,
  });
  const head = chain.head;
  const priorHead = chain.priorAdjustments[chain.priorAdjustments.length - 1];
  if (!head || !priorHead) {
    fail('Cancellation-after-amendment requires a verified commercial predecessor chain.');
  }
  if (
    head.adjustmentNoteId !== snapshot.predecessorAdjustmentNoteId
    || head.sourceAdjustmentOrdinal !== input.row.sourceAdjustmentOrdinal - 1
    || head.sourceAdjustmentOrdinal !== input.row.predecessorSourceAdjustmentOrdinal
    || head.documentNumber !== snapshot.predecessorAdjustmentDocumentNumber
    || !sameTime(head.issuedAt, snapshot.predecessorAdjustmentIssuedAt)
    || head.documentFingerprint !== snapshot.predecessorAdjustmentDocumentFingerprint
    || head.afterPricingFingerprint !== snapshot.predecessorAfterPricingFingerprint
    || head.afterPricingFingerprint !== snapshot.beforePricingFingerprint
    || priorHead.after.taxTotalMinor.toString() !== snapshot.beforeTaxMinor
    || priorHead.after.totalMinor.toString() !== snapshot.beforeTotalMinor
    || priorHead.after.currency !== snapshot.currency
  ) {
    fail('Cancellation-after-amendment predecessor authority does not match the verified commercial chain head.');
  }

  const [sourceInvoice, booking, transactions] = await Promise.all([
    input.transaction.hospitalityIssuedInvoice.findFirst({
      where: {
        id: input.row.sourceInvoiceId,
        organizationId: input.organizationId,
        bookingId: input.row.bookingId,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
      },
      select: {
        documentNumber: true,
        issuedAt: true,
        documentFingerprint: true,
        issuerFingerprint: true,
        recipientFingerprint: true,
      },
    }),
    input.transaction.hospitalityBooking.findFirst({
      where: { id: input.row.bookingId, organizationId: input.organizationId },
      select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
    }),
    input.transaction.paymentTransaction.findMany({
      where: { organizationId: input.organizationId, bookingId: input.row.bookingId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        commercialAmendmentId: true,
        kind: true,
        status: true,
        providerCode: true,
        providerReference: true,
        sourceProviderReference: true,
        currency: true,
        amountMinor: true,
        createdAt: true,
      },
    }),
  ]);
  if (!sourceInvoice || !booking) fail('Cancellation-after-amendment tenant authority is incomplete.');
  if (
    sourceInvoice.documentNumber !== snapshot.sourceInvoiceDocumentNumber
    || !sameTime(sourceInvoice.issuedAt, snapshot.sourceInvoiceIssuedAt)
    || sourceInvoice.documentFingerprint !== snapshot.sourceInvoiceFingerprint
    || sourceInvoice.issuerFingerprint !== snapshot.issuerFingerprint
    || sourceInvoice.recipientFingerprint !== snapshot.recipientFingerprint
  ) {
    fail('Cancellation-after-amendment source tax-invoice authority has drifted.');
  }

  const transactionsAtIssue = transactions.filter(
    (transaction) => transaction.createdAt.getTime() <= input.row.issuedAt.getTime(),
  );
  const readiness = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness({
    bookingStatus: booking.status,
    bookingPaymentStatus: booking.paymentStatus,
    bookingCurrency: booking.currency,
    bookingTotalMinor: booking.totalMinor,
    chainHead: {
      adjustmentNoteId: head.adjustmentNoteId,
      sourceAdjustmentOrdinal: head.sourceAdjustmentOrdinal,
      documentNumber: head.documentNumber,
      issuedAt: head.issuedAt,
      documentFingerprint: head.documentFingerprint,
      afterPricingFingerprint: head.afterPricingFingerprint,
      currency: priorHead.after.currency,
      accommodationSubtotalMinor: priorHead.after.accommodationSubtotalMinor,
      taxTotalMinor: priorHead.after.taxTotalMinor,
      feeTotalMinor: priorHead.after.feeTotalMinor,
      addonTotalMinor: priorHead.after.addonTotalMinor,
      totalMinor: priorHead.after.totalMinor,
    },
    transactions: transactionsAtIssue,
  });
  if (!readiness.ready) {
    fail(`Cancellation-after-amendment settlement authority failed at issue time: ${readiness.reason}`);
  }
  if (
    readiness.sourceAdjustmentOrdinal !== input.row.sourceAdjustmentOrdinal
    || readiness.predecessorAdjustmentNoteId !== snapshot.predecessorAdjustmentNoteId
    || readiness.predecessorSourceAdjustmentOrdinal !== input.row.predecessorSourceAdjustmentOrdinal
    || readiness.predecessorAdjustmentDocumentNumber !== snapshot.predecessorAdjustmentDocumentNumber
    || !sameTime(readiness.predecessorAdjustmentIssuedAt, snapshot.predecessorAdjustmentIssuedAt)
    || readiness.predecessorAdjustmentDocumentFingerprint !== snapshot.predecessorAdjustmentDocumentFingerprint
    || readiness.predecessorAfterPricingFingerprint !== snapshot.predecessorAfterPricingFingerprint
    || readiness.currency !== snapshot.currency
    || readiness.decreaseSubtotalMinor.toString() !== snapshot.decreaseSubtotalMinor
    || readiness.decreaseTaxMinor.toString() !== snapshot.decreaseTaxMinor
    || readiness.decreaseTotalMinor.toString() !== snapshot.decreaseTotalMinor
  ) {
    fail('Cancellation-after-amendment legal effect no longer matches independently derived issue-time authority.');
  }
  verifyFrozenRefundAuthorities({ expected: readiness.refundAuthorities, frozen: snapshot.refundAuthorities });
}

export async function verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  row: HospitalityCancellationAfterAmendmentAdjustmentAuthorityRow;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.row.id, 'adjustmentNoteId');
  assertUuidIdentifier(input.row.bookingId, 'bookingId');
  assertUuidIdentifier(input.row.sourceInvoiceId, 'sourceInvoiceId');
  if (input.row.organizationId !== input.organizationId) {
    fail('Cancellation-after-amendment row is outside the requested tenant scope.');
  }
  await verifyRow(input);
}

export async function verifyHospitalityCancellationAfterAmendmentAdjustmentRows(input: {
  organizationId: string;
  rows: readonly HospitalityCancellationAfterAmendmentAdjustmentAuthorityRow[];
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  for (const row of input.rows) {
    assertUuidIdentifier(row.id, 'adjustmentNoteId');
    assertUuidIdentifier(row.bookingId, 'bookingId');
    assertUuidIdentifier(row.sourceInvoiceId, 'sourceInvoiceId');
    await db.$transaction((transaction) => verifyHospitalityCancellationAfterAmendmentAdjustmentRowInTransaction({
      transaction,
      organizationId: input.organizationId,
      row,
    }));
  }
}
