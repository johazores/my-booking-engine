import type { Prisma } from '../../generated/prisma/client.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  verifyHospitalityCommercialAmendmentAdjustmentRows,
} from './hospitality-commercial-amendment-adjustment-chain-read-service.ts';
import {
  createHospitalityIssuedAdjustmentNoteDocument,
} from './hospitality-issued-adjustment-note-document-domain.ts';
import {
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';
import {
  createHospitalityIssuedTaxInvoiceDocument,
} from './hospitality-issued-invoice-document-domain.ts';
import {
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

export type HospitalityIssuedAdjustmentNoteReadRow = Readonly<{
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

export class HospitalityIssuedAdjustmentNoteAuthorityError extends Error {
  constructor(message = 'Stored adjustment-note evidence failed integrity validation.') {
    super(message);
    this.name = 'HospitalityIssuedAdjustmentNoteAuthorityError';
  }
}

type AdjustmentDocument = ReturnType<typeof createHospitalityIssuedAdjustmentNoteDocument>;

type ValidatedAdjustmentNote = Readonly<{
  kind: 'BOOKING_CANCELLATION' | 'COMMERCIAL_AMENDMENT';
  row: HospitalityIssuedAdjustmentNoteReadRow;
  document: AdjustmentDocument;
}>;

function fail(message: string): never {
  throw new HospitalityIssuedAdjustmentNoteAuthorityError(message);
}

function zeroIncrease(row: HospitalityIssuedAdjustmentNoteReadRow) {
  return row.increaseSubtotalMinor === 0n
    && row.increaseTaxMinor === 0n
    && row.increaseTotalMinor === 0n;
}

function zeroDecrease(row: HospitalityIssuedAdjustmentNoteReadRow) {
  return row.decreaseSubtotalMinor === 0n
    && row.decreaseTaxMinor === 0n
    && row.decreaseTotalMinor === 0n;
}

function validateCommonDocumentMaterial(row: HospitalityIssuedAdjustmentNoteReadRow, document: AdjustmentDocument) {
  if (
    row.jurisdictionCode !== 'AU'
    || row.documentType !== 'ADJUSTMENT_NOTE'
    || document.documentNumber !== row.documentNumber
    || new Date(document.issuedAt).getTime() !== row.issuedAt.getTime()
    || document.currency !== row.currency
    || document.documentFingerprint !== row.documentFingerprint
  ) {
    fail('Persisted adjustment-note material does not match its immutable document projection.');
  }
}

function validateCancellation(row: HospitalityIssuedAdjustmentNoteReadRow): ValidatedAdjustmentNote {
  try {
    const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(row.documentSnapshot);
    const document = createHospitalityIssuedAdjustmentNoteDocument(snapshot);
    validateCommonDocumentMaterial(row, document);
    if (
      row.adjustmentType !== 'DECREASING'
      || row.adjustmentReason !== 'BOOKING_CANCELLATION'
      || row.refundTransactionId === null
      || row.commercialAmendmentId !== null
      || row.targetPricingEvidenceId !== null
      || row.predecessorAdjustmentNoteId !== null
      || row.predecessorSourceAdjustmentOrdinal !== null
      || row.sourceAdjustmentOrdinal !== 1
      || !zeroIncrease(row)
      || snapshot.organizationId !== row.organizationId
      || snapshot.bookingId !== row.bookingId
      || snapshot.sourceInvoiceId !== row.sourceInvoiceId
      || snapshot.refundTransactionId !== row.refundTransactionId
      || BigInt(snapshot.sequenceValue) !== row.sequenceValue
      || BigInt(snapshot.decreaseSubtotalMinor) !== row.decreaseSubtotalMinor
      || BigInt(snapshot.decreaseTaxMinor) !== row.decreaseTaxMinor
      || BigInt(snapshot.decreaseTotalMinor) !== row.decreaseTotalMinor
      || snapshot.sourceInvoiceFingerprint !== row.sourceInvoiceFingerprint
      || snapshot.issuerFingerprint !== row.issuerFingerprint
      || snapshot.recipientFingerprint !== row.recipientFingerprint
      || hospitalityIssuedAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
      || document.adjustmentType !== 'Decreasing adjustment'
      || document.adjustmentReason !== 'Booking cancellation'
    ) {
      fail('Persisted cancellation adjustment note failed integrity validation.');
    }
    return Object.freeze({ kind: 'BOOKING_CANCELLATION', row, document });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError) throw error;
    fail(error instanceof Error ? error.message : 'Persisted cancellation adjustment note is invalid.');
  }
}

function validateCommercial(row: HospitalityIssuedAdjustmentNoteReadRow): ValidatedAdjustmentNote {
  try {
    const document = createHospitalityIssuedAdjustmentNoteDocument(row.documentSnapshot);
    validateCommonDocumentMaterial(row, document);
    if (
      row.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
      || row.refundTransactionId !== null
      || row.commercialAmendmentId === null
      || row.targetPricingEvidenceId === null
      || row.sourceAdjustmentOrdinal < 1
      || document.adjustmentReason !== 'Commercial booking amendment'
    ) {
      fail('Persisted commercial adjustment note failed material authority validation.');
    }
    if (row.adjustmentType === 'DECREASING') {
      if (
        !zeroIncrease(row)
        || document.adjustmentType !== 'Decreasing adjustment'
        || BigInt(document.decreaseSubtotalMinor) !== row.decreaseSubtotalMinor
        || BigInt(document.decreaseGstMinor) !== row.decreaseTaxMinor
        || BigInt(document.decreaseTotalMinor) !== row.decreaseTotalMinor
      ) {
        fail('Persisted decreasing commercial adjustment note failed effect validation.');
      }
    } else if (row.adjustmentType === 'INCREASING') {
      if (
        !zeroDecrease(row)
        || document.adjustmentType !== 'Increasing adjustment'
        || BigInt(document.increaseSubtotalMinor) !== row.increaseSubtotalMinor
        || BigInt(document.increaseGstMinor) !== row.increaseTaxMinor
        || BigInt(document.increaseTotalMinor) !== row.increaseTotalMinor
      ) {
        fail('Persisted increasing commercial adjustment note failed effect validation.');
      }
    } else {
      fail('Persisted commercial adjustment note has an unsupported direction.');
    }
    return Object.freeze({ kind: 'COMMERCIAL_AMENDMENT', row, document });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError) throw error;
    fail(error instanceof Error ? error.message : 'Persisted commercial adjustment note is invalid.');
  }
}

function validateRow(row: HospitalityIssuedAdjustmentNoteReadRow): ValidatedAdjustmentNote {
  assertUuidIdentifier(row.id, 'adjustmentNoteId');
  assertUuidIdentifier(row.organizationId, 'organizationId');
  assertUuidIdentifier(row.bookingId, 'bookingId');
  assertUuidIdentifier(row.sourceInvoiceId, 'sourceInvoiceId');
  if (row.adjustmentReason === 'BOOKING_CANCELLATION') return validateCancellation(row);
  if (row.adjustmentReason === 'COMMERCIAL_AMENDMENT') return validateCommercial(row);
  return fail('Persisted adjustment note has an unsupported legal reason.');
}

async function verifyCancellationAuthorities(
  organizationId: string,
  items: readonly ValidatedAdjustmentNote[],
) {
  const cancellations = items.filter((item) => item.kind === 'BOOKING_CANCELLATION');
  if (cancellations.length === 0) return;
  const sourceInvoiceIds = [...new Set(cancellations.map((item) => item.row.sourceInvoiceId))];
  const refundIds = [...new Set(cancellations.map((item) => item.row.refundTransactionId!))];
  const [sourceInvoices, refunds] = await Promise.all([
    db.hospitalityIssuedInvoice.findMany({
      where: {
        id: { in: sourceInvoiceIds },
        organizationId,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
      },
    }),
    db.paymentTransaction.findMany({
      where: { id: { in: refundIds }, organizationId },
      select: {
        id: true,
        bookingId: true,
        commercialAmendmentId: true,
        kind: true,
        status: true,
        currency: true,
        amountMinor: true,
        sourceProviderReference: true,
        createdAt: true,
      },
    }),
  ]);
  const sourceById = new Map(sourceInvoices.map((row) => [row.id, row]));
  const refundById = new Map(refunds.map((row) => [row.id, row]));

  for (const item of cancellations) {
    const sourceInvoice = sourceById.get(item.row.sourceInvoiceId);
    const refund = item.row.refundTransactionId ? refundById.get(item.row.refundTransactionId) : undefined;
    if (!sourceInvoice || !refund) fail('Cancellation adjustment-note authority is incomplete.');
    try {
      const sourceSnapshot = parseHospitalityIssuedTaxInvoiceSnapshot(sourceInvoice.documentSnapshot);
      const sourceDocument = createHospitalityIssuedTaxInvoiceDocument(sourceSnapshot);
      if (
        sourceInvoice.organizationId !== item.row.organizationId
        || sourceInvoice.bookingId !== item.row.bookingId
        || hospitalityIssuedInvoiceFingerprint(sourceSnapshot) !== sourceInvoice.documentFingerprint
        || sourceDocument.documentFingerprint !== sourceInvoice.documentFingerprint
        || sourceInvoice.documentFingerprint !== item.row.sourceInvoiceFingerprint
        || sourceInvoice.issuerFingerprint !== item.row.issuerFingerprint
        || sourceInvoice.recipientFingerprint !== item.row.recipientFingerprint
        || sourceInvoice.documentNumber !== item.document.sourceTaxInvoiceNumber
        || sourceInvoice.issuedAt.getTime() !== new Date(item.document.sourceTaxInvoiceIssuedAt).getTime()
        || refund.bookingId !== item.row.bookingId
        || refund.commercialAmendmentId !== null
        || refund.kind !== 'REFUND'
        || refund.status !== 'SUCCEEDED'
        || refund.currency !== item.document.currency
        || refund.amountMinor !== BigInt(item.document.decreaseTotalMinor)
        || refund.sourceProviderReference === null
        || refund.createdAt.getTime() < sourceInvoice.issuedAt.getTime()
        || refund.createdAt.getTime() > item.row.issuedAt.getTime()
      ) {
        fail('Cancellation adjustment-note source/refund authority failed integrity validation.');
      }
    } catch (error) {
      if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError) throw error;
      fail(error instanceof Error ? error.message : 'Cancellation adjustment-note authority is invalid.');
    }
  }
}

async function verifyCommercialAuthorities(
  organizationId: string,
  items: readonly ValidatedAdjustmentNote[],
) {
  const commercial = items.filter((item) => item.kind === 'COMMERCIAL_AMENDMENT');
  if (commercial.length === 0) return;
  await verifyHospitalityCommercialAmendmentAdjustmentRows({
    organizationId,
    rows: commercial.map((item) => ({
      id: item.row.id,
      bookingId: item.row.bookingId,
      sourceInvoiceId: item.row.sourceInvoiceId,
    })),
  });
}

export async function validateHospitalityIssuedAdjustmentNoteRows(input: {
  organizationId: string;
  rows: readonly HospitalityIssuedAdjustmentNoteReadRow[];
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  for (const row of input.rows) {
    if (row.organizationId !== input.organizationId) {
      fail('Adjustment-note row is outside the requested tenant scope.');
    }
  }
  const validated = input.rows.map(validateRow);
  try {
    await Promise.all([
      verifyCancellationAuthorities(input.organizationId, validated),
      verifyCommercialAuthorities(input.organizationId, validated),
    ]);
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteAuthorityError) throw error;
    fail(error instanceof Error ? error.message : 'Adjustment-note authority verification failed.');
  }
  return Object.freeze(validated);
}
