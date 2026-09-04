import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  createHospitalityIssuedCancellationAdjustmentNoteDocument,
  HospitalityIssuedAdjustmentNoteDocumentValidationError,
} from './hospitality-issued-adjustment-note-document-domain.ts';
import {
  hospitalityIssuedAdjustmentNoteFingerprint,
  parseHospitalityIssuedCancellationAdjustmentNoteSnapshot,
} from './hospitality-issued-adjustment-note-domain.ts';

const AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN = /^AU-ADJ-[0-9]{8,}$/;

export class HospitalityIssuedAdjustmentNoteUnavailableError extends Error {
  constructor(message = 'Issued adjustment note is not available.') {
    super(message);
    this.name = 'HospitalityIssuedAdjustmentNoteUnavailableError';
  }
}

export class HospitalityIssuedAdjustmentNotePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityIssuedAdjustmentNotePersistenceError';
  }
}

type PersistedAdjustmentNote = {
  organizationId: string;
  bookingId: string;
  sourceInvoiceId: string;
  refundTransactionId: string;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  adjustmentReason: string;
  decreaseSubtotalMinor: bigint;
  decreaseTaxMinor: bigint;
  decreaseTotalMinor: bigint;
  sourceInvoiceFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  documentSnapshot: Prisma.JsonValue;
};

async function requireAdjustmentNoteReadAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' });
}

function validatePersistedAdjustmentNote(row: PersistedAdjustmentNote) {
  try {
    const snapshot = parseHospitalityIssuedCancellationAdjustmentNoteSnapshot(row.documentSnapshot);
    if (
      row.jurisdictionCode !== 'AU'
      || row.documentType !== 'ADJUSTMENT_NOTE'
      || row.adjustmentReason !== 'BOOKING_CANCELLATION'
      || snapshot.organizationId !== row.organizationId
      || snapshot.bookingId !== row.bookingId
      || snapshot.sourceInvoiceId !== row.sourceInvoiceId
      || snapshot.refundTransactionId !== row.refundTransactionId
      || snapshot.documentNumber !== row.documentNumber
      || BigInt(snapshot.sequenceValue) !== row.sequenceValue
      || new Date(snapshot.issuedAt).getTime() !== row.issuedAt.getTime()
      || snapshot.currency !== row.currency
      || BigInt(snapshot.decreaseSubtotalMinor) !== row.decreaseSubtotalMinor
      || BigInt(snapshot.decreaseTaxMinor) !== row.decreaseTaxMinor
      || BigInt(snapshot.decreaseTotalMinor) !== row.decreaseTotalMinor
      || snapshot.sourceInvoiceFingerprint !== row.sourceInvoiceFingerprint
      || snapshot.issuerFingerprint !== row.issuerFingerprint
      || snapshot.recipientFingerprint !== row.recipientFingerprint
      || hospitalityIssuedAdjustmentNoteFingerprint(snapshot) !== row.documentFingerprint
    ) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError('Persisted adjustment note failed integrity validation.');
    }
    return { snapshot, document: createHospitalityIssuedCancellationAdjustmentNoteDocument(snapshot) };
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) throw error;
    if (error instanceof HospitalityIssuedAdjustmentNoteDocumentValidationError || error instanceof Error) {
      throw new HospitalityIssuedAdjustmentNotePersistenceError(error.message);
    }
    throw new HospitalityIssuedAdjustmentNotePersistenceError('Persisted adjustment note is invalid.');
  }
}

export async function getHospitalityIssuedCancellationAdjustmentNoteDocument(input: {
  organizationId: string;
  actorUserId: string;
  documentNumber: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  const documentNumber = input.documentNumber.trim().toUpperCase();
  if (!AUSTRALIAN_ADJUSTMENT_NOTE_NUMBER_PATTERN.test(documentNumber)) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  await requireAdjustmentNoteReadAccess(input);

  const row = await db.hospitalityIssuedAdjustmentNote.findFirst({
    where: { organizationId: input.organizationId, jurisdictionCode: 'AU', documentType: 'ADJUSTMENT_NOTE', documentNumber },
  });
  if (!row) throw new HospitalityIssuedAdjustmentNoteUnavailableError();
  const validated = validatePersistedAdjustmentNote(row);

  const sourceInvoice = await db.hospitalityIssuedInvoice.findFirst({
    where: { id: row.sourceInvoiceId, organizationId: input.organizationId, bookingId: row.bookingId, jurisdictionCode: 'AU', documentType: 'TAX_INVOICE' },
    select: { documentNumber: true, issuedAt: true, documentFingerprint: true },
  });
  if (
    !sourceInvoice
    || sourceInvoice.documentFingerprint !== row.sourceInvoiceFingerprint
    || sourceInvoice.documentNumber !== validated.snapshot.sourceInvoiceDocumentNumber
    || sourceInvoice.issuedAt.getTime() !== new Date(validated.snapshot.sourceInvoiceIssuedAt).getTime()
  ) {
    throw new HospitalityIssuedAdjustmentNotePersistenceError('Adjustment-note source tax invoice failed integrity validation.');
  }
  return validated.document;
}
