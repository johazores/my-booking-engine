import type { Prisma } from '../../generated/prisma/client.ts';
import type { HospitalityLegalPaymentEvidenceTransaction } from './hospitality-legal-payment-evidence-history.ts';

export const HOSPITALITY_COMMERCIAL_SETTLEMENT_EVIDENCE_SCHEMA_VERSION = 1;
export const HOSPITALITY_COMMERCIAL_SETTLEMENT_EVIDENCE_TRANSACTION_LIMIT = 5_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAYMENT_KINDS = new Set(['OFFLINE_PAYMENT', 'AUTHORIZATION', 'CAPTURE', 'REFUND']);
const PAYMENT_STATUSES = new Set(['PENDING', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS']);

type SettlementEvidenceHeaderRow = Readonly<{
  adjustmentNoteId: string;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  commercialAmendmentId: string;
  sourceAdjustmentOrdinal: number;
  schemaVersion: number;
  issuedAt: Date;
  transactionCount: number;
}>;

type SettlementEvidenceTransactionRow = Readonly<{
  settlementEvidenceId: string;
  paymentTransactionId: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  sourceCreatedAt: Date;
}>;

type CommercialAdjustmentNoteIdentity = Readonly<{
  id: string;
  commercialAmendmentId: string | null;
  sourceAdjustmentOrdinal: number;
  issuedAt: Date;
}>;

export type HospitalityFrozenCommercialSettlementEvidence =
  ReadonlyMap<string, readonly HospitalityLegalPaymentEvidenceTransaction[]>;

export class HospitalityCommercialSettlementEvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCommercialSettlementEvidenceIntegrityError';
  }
}

function fail(message: string): never {
  throw new HospitalityCommercialSettlementEvidenceIntegrityError(message);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function validateTransactionRow(input: {
  row: SettlementEvidenceTransactionRow;
  header: SettlementEvidenceHeaderRow;
  allowedAmendmentIds: ReadonlySet<string>;
}) {
  const { row, header, allowedAmendmentIds } = input;
  if (
    row.settlementEvidenceId !== header.adjustmentNoteId
    || row.organizationId !== header.organizationId
    || row.bookingId !== header.bookingId
    || !UUID_PATTERN.test(row.paymentTransactionId)
    || (row.commercialAmendmentId !== null && !allowedAmendmentIds.has(row.commercialAmendmentId))
    || !PAYMENT_KINDS.has(row.kind)
    || !PAYMENT_STATUSES.has(row.status)
    || !row.providerCode.trim()
    || !row.providerReference.trim()
    || (row.sourceProviderReference !== null && !row.sourceProviderReference.trim())
    || !/^[A-Z]{3}$/.test(row.currency)
    || row.amountMinor <= 0n
    || !validDate(row.sourceCreatedAt)
    || row.sourceCreatedAt.getTime() > header.issuedAt.getTime()
  ) {
    fail('Frozen commercial settlement evidence contains an invalid payment transaction.');
  }

  return Object.freeze({
    id: row.paymentTransactionId,
    organizationId: row.organizationId,
    bookingId: row.bookingId,
    commercialAmendmentId: row.commercialAmendmentId,
    kind: row.kind as HospitalityLegalPaymentEvidenceTransaction['kind'],
    status: row.status as HospitalityLegalPaymentEvidenceTransaction['status'],
    providerCode: row.providerCode,
    providerReference: row.providerReference,
    sourceProviderReference: row.sourceProviderReference,
    currency: row.currency,
    amountMinor: row.amountMinor,
    createdAt: row.sourceCreatedAt,
  });
}

export function buildHospitalityFrozenCommercialSettlementEvidence(input: {
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  adjustmentNotes: readonly CommercialAdjustmentNoteIdentity[];
  headers: readonly SettlementEvidenceHeaderRow[];
  transactionRows: readonly SettlementEvidenceTransactionRow[];
}): HospitalityFrozenCommercialSettlementEvidence {
  if (input.adjustmentNotes.length === 0) {
    if (input.headers.length > 0 || input.transactionRows.length > 0) {
      fail('Frozen commercial settlement evidence exists without a legal adjustment-note chain.');
    }
    return new Map();
  }

  const noteById = new Map(input.adjustmentNotes.map((note) => [note.id, note]));
  const headerByNoteId = new Map<string, SettlementEvidenceHeaderRow>();
  for (const header of input.headers) {
    const note = noteById.get(header.adjustmentNoteId);
    if (
      !note
      || note.commercialAmendmentId === null
      || header.organizationId !== input.organizationId
      || header.bookingId !== input.bookingId
      || header.sourceInvoiceId !== input.sourceInvoiceId
      || header.commercialAmendmentId !== note.commercialAmendmentId
      || header.sourceAdjustmentOrdinal !== note.sourceAdjustmentOrdinal
      || header.schemaVersion !== HOSPITALITY_COMMERCIAL_SETTLEMENT_EVIDENCE_SCHEMA_VERSION
      || !validDate(header.issuedAt)
      || header.issuedAt.getTime() !== note.issuedAt.getTime()
      || !Number.isSafeInteger(header.transactionCount)
      || header.transactionCount < 1
      || header.transactionCount > HOSPITALITY_COMMERCIAL_SETTLEMENT_EVIDENCE_TRANSACTION_LIMIT
      || headerByNoteId.has(header.adjustmentNoteId)
    ) {
      fail('Frozen commercial settlement evidence header does not match its immutable adjustment note.');
    }
    headerByNoteId.set(header.adjustmentNoteId, header);
  }

  const rowsByEvidenceId = new Map<string, SettlementEvidenceTransactionRow[]>();
  for (const row of input.transactionRows) {
    if (!headerByNoteId.has(row.settlementEvidenceId)) {
      fail('Frozen commercial settlement transaction has no matching evidence header.');
    }
    const current = rowsByEvidenceId.get(row.settlementEvidenceId) ?? [];
    current.push(row);
    rowsByEvidenceId.set(row.settlementEvidenceId, current);
  }

  const result = new Map<string, readonly HospitalityLegalPaymentEvidenceTransaction[]>();
  const orderedNotes = [...input.adjustmentNotes].sort((left, right) => {
    if (left.sourceAdjustmentOrdinal !== right.sourceAdjustmentOrdinal) {
      return left.sourceAdjustmentOrdinal - right.sourceAdjustmentOrdinal;
    }
    return left.id.localeCompare(right.id);
  });

  for (const note of orderedNotes) {
    const header = headerByNoteId.get(note.id);
    if (!header) continue;

    const allowedAmendmentIds = new Set(
      orderedNotes
        .filter((candidate) => candidate.sourceAdjustmentOrdinal <= note.sourceAdjustmentOrdinal)
        .map((candidate) => candidate.commercialAmendmentId)
        .filter((value): value is string => value !== null),
    );
    const rows = rowsByEvidenceId.get(note.id) ?? [];
    if (rows.length !== header.transactionCount) {
      fail('Frozen commercial settlement evidence transaction count does not match its immutable header.');
    }

    const seenPaymentIds = new Set<string>();
    const transactions = [...rows]
      .sort((left, right) => {
        const chronology = left.sourceCreatedAt.getTime() - right.sourceCreatedAt.getTime();
        if (chronology !== 0) return chronology;
        return left.paymentTransactionId.localeCompare(right.paymentTransactionId);
      })
      .map((row) => {
        if (seenPaymentIds.has(row.paymentTransactionId)) {
          fail('Frozen commercial settlement evidence contains a duplicate payment transaction identity.');
        }
        seenPaymentIds.add(row.paymentTransactionId);
        return validateTransactionRow({ row, header, allowedAmendmentIds });
      });

    result.set(note.id, Object.freeze(transactions));
  }

  return result;
}

export async function loadHospitalityFrozenCommercialSettlementEvidence(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  adjustmentNotes: readonly CommercialAdjustmentNoteIdentity[];
}): Promise<HospitalityFrozenCommercialSettlementEvidence> {
  if (input.adjustmentNotes.length === 0) return new Map();

  const headers = await input.transaction.$queryRaw<SettlementEvidenceHeaderRow[]>`
    SELECT
      evidence."adjustmentNoteId",
      evidence."organizationId",
      evidence."bookingId",
      evidence."sourceInvoiceId",
      evidence."commercialAmendmentId",
      evidence."sourceAdjustmentOrdinal",
      evidence."schemaVersion",
      evidence."issuedAt",
      evidence."transactionCount"
    FROM "hospitality_commercial_settlement_evidence" evidence
    WHERE evidence."organizationId" = ${input.organizationId}::uuid
      AND evidence."bookingId" = ${input.bookingId}::uuid
      AND evidence."sourceInvoiceId" = ${input.sourceInvoiceId}::uuid
    ORDER BY evidence."sourceAdjustmentOrdinal" ASC, evidence."adjustmentNoteId" ASC
  `;

  const transactionRows = headers.length > 0
    ? await input.transaction.$queryRaw<SettlementEvidenceTransactionRow[]>`
        SELECT
          frozen."settlementEvidenceId",
          frozen."paymentTransactionId",
          frozen."organizationId",
          frozen."bookingId",
          frozen."commercialAmendmentId",
          frozen."kind"::text AS "kind",
          frozen."status"::text AS "status",
          frozen."providerCode",
          frozen."providerReference",
          frozen."sourceProviderReference",
          frozen."currency",
          frozen."amountMinor",
          frozen."sourceCreatedAt"
        FROM "hospitality_commercial_settlement_evidence_transactions" frozen
        INNER JOIN "hospitality_commercial_settlement_evidence" evidence
          ON evidence."adjustmentNoteId" = frozen."settlementEvidenceId"
         AND evidence."organizationId" = frozen."organizationId"
         AND evidence."bookingId" = frozen."bookingId"
        WHERE evidence."organizationId" = ${input.organizationId}::uuid
          AND evidence."bookingId" = ${input.bookingId}::uuid
          AND evidence."sourceInvoiceId" = ${input.sourceInvoiceId}::uuid
        ORDER BY frozen."settlementEvidenceId" ASC, frozen."sourceCreatedAt" ASC, frozen."paymentTransactionId" ASC
      `
    : [];

  return buildHospitalityFrozenCommercialSettlementEvidence({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    sourceInvoiceId: input.sourceInvoiceId,
    adjustmentNotes: input.adjustmentNotes,
    headers,
    transactionRows,
  });
}
