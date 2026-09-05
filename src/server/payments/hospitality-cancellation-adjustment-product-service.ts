import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalityAdjustmentNoteConflictError,
  HospitalityAdjustmentNotePersistenceError,
  HospitalityAdjustmentNoteUnavailableError,
  getHospitalityCancellationAdjustmentNoteAvailability,
  issueHospitalityCancellationAdjustmentNote,
} from './hospitality-adjustment-note-service.ts';
import {
  issueHospitalityCancellationAfterAmendmentAdjustmentNote,
} from './hospitality-cancellation-after-amendment-adjustment-note-service.ts';
import {
  getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability,
} from './hospitality-cancellation-after-amendment-adjustment-service.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

type CancellationAdjustmentProductInput = Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}>;

type CancellationAdjustmentPath =
  | 'UNADJUSTED'
  | 'AFTER_COMMERCIAL_AMENDMENT'
  | 'EXISTING_UNADJUSTED'
  | 'EXISTING_AFTER_COMMERCIAL_AMENDMENT'
  | 'BLOCKED';

function normalizeSourceInvoiceNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(normalized)) {
    throw new HospitalityAdjustmentNoteUnavailableError();
  }
  return normalized;
}

function schemaVersion(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).schemaVersion
    : undefined;
}

async function requireCancellationManageAccess(input: CancellationAdjustmentProductInput) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });
}

async function inspectCancellationAdjustmentPath(
  input: CancellationAdjustmentProductInput,
  sourceInvoiceDocumentNumber: string,
): Promise<Readonly<{ path: CancellationAdjustmentPath; documentNumber?: string; refundTransactionId?: string }>> {
  return db.$transaction(async (transaction) => {
    const sourceInvoice = await transaction.hospitalityIssuedInvoice.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
        documentNumber: sourceInvoiceDocumentNumber,
      },
      select: { id: true },
    });
    if (!sourceInvoice) throw new HospitalityAdjustmentNoteUnavailableError();

    const existingCancellation = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
        adjustmentReason: 'BOOKING_CANCELLATION',
      },
      orderBy: [{ sourceAdjustmentOrdinal: 'desc' }, { issuedAt: 'desc' }, { id: 'desc' }],
      select: { documentNumber: true, documentSnapshot: true, refundTransactionId: true },
    });
    if (existingCancellation) {
      const version = schemaVersion(existingCancellation.documentSnapshot);
      if (version === 1) {
        if (!existingCancellation.refundTransactionId) {
          throw new HospitalityAdjustmentNotePersistenceError(
            'Existing unadjusted cancellation is missing refund authority.',
          );
        }
        return Object.freeze({
          path: 'EXISTING_UNADJUSTED' as const,
          documentNumber: existingCancellation.documentNumber,
          refundTransactionId: existingCancellation.refundTransactionId,
        });
      }
      if (version === 6) {
        return Object.freeze({
          path: 'EXISTING_AFTER_COMMERCIAL_AMENDMENT' as const,
          documentNumber: existingCancellation.documentNumber,
        });
      }
      throw new HospitalityAdjustmentNotePersistenceError(
        'Cancellation adjustment note uses an unsupported evidence schema.',
      );
    }

    const nonCommercial = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
        adjustmentReason: { not: 'COMMERCIAL_AMENDMENT' },
      },
      select: { id: true },
    });
    if (nonCommercial) return Object.freeze({ path: 'BLOCKED' as const });

    const commercial = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
        adjustmentReason: 'COMMERCIAL_AMENDMENT',
      },
      select: { id: true },
    });
    return Object.freeze({
      path: commercial ? 'AFTER_COMMERCIAL_AMENDMENT' as const : 'UNADJUSTED' as const,
    });
  }, { isolationLevel: 'Serializable' });
}

export async function getHospitalityCancellationAdjustmentNoteProductAvailability(
  input: CancellationAdjustmentProductInput,
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireCancellationManageAccess(input);

  const state = await inspectCancellationAdjustmentPath(input, sourceInvoiceDocumentNumber);

  if (state.path === 'BLOCKED') {
    return Object.freeze({
      available: false as const,
      reason: 'A different legal adjustment already exists for this tax invoice.',
    });
  }

  if (state.path === 'UNADJUSTED' || state.path === 'EXISTING_UNADJUSTED') {
    const availability = await getHospitalityCancellationAdjustmentNoteAvailability({
      ...input,
      sourceInvoiceDocumentNumber,
    });
    if (state.path === 'EXISTING_UNADJUSTED') {
      if (
        availability.available
        || !('documentNumber' in availability)
        || availability.documentNumber !== state.documentNumber
      ) {
        throw new HospitalityAdjustmentNotePersistenceError(
          'Existing unadjusted cancellation no longer matches the server-selected cancellation authority.',
        );
      }
      return availability;
    }
    if (!availability.available) return availability;
    return Object.freeze({
      available: true as const,
      sourceAdjustmentOrdinal: 1,
    });
  }

  const availability = await getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability({
    ...input,
    sourceInvoiceDocumentNumber,
  });
  if (state.path === 'EXISTING_AFTER_COMMERCIAL_AMENDMENT') {
    if (
      availability.available
      || !('documentNumber' in availability)
      || availability.documentNumber !== state.documentNumber
    ) {
      throw new HospitalityAdjustmentNotePersistenceError(
        'Existing terminal cancellation no longer matches the server-selected cancellation authority.',
      );
    }
    return availability;
  }
  if (!availability.available) return availability;
  return Object.freeze({
    available: true as const,
    sourceAdjustmentOrdinal: availability.sourceAdjustmentOrdinal,
  });
}

export async function issueHospitalityCancellationAdjustmentNoteForSource(
  input: CancellationAdjustmentProductInput,
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireCancellationManageAccess(input);

  const state = await inspectCancellationAdjustmentPath(input, sourceInvoiceDocumentNumber);
  if (state.path === 'BLOCKED') {
    throw new HospitalityAdjustmentNoteConflictError(
      'A different legal adjustment already exists for this tax invoice.',
    );
  }

  if (state.path === 'EXISTING_UNADJUSTED') {
    if (!state.refundTransactionId) {
      throw new HospitalityAdjustmentNotePersistenceError(
        'Existing unadjusted cancellation is missing refund authority.',
      );
    }
    return issueHospitalityCancellationAdjustmentNote({
      ...input,
      sourceInvoiceDocumentNumber,
      refundTransactionId: state.refundTransactionId,
    });
  }

  if (state.path === 'UNADJUSTED') {
    const availability = await getHospitalityCancellationAdjustmentNoteAvailability({
      ...input,
      sourceInvoiceDocumentNumber,
    });
    if (!availability.available) {
      throw new HospitalityAdjustmentNoteConflictError(availability.reason);
    }
    return issueHospitalityCancellationAdjustmentNote({
      ...input,
      sourceInvoiceDocumentNumber,
      refundTransactionId: availability.refundTransactionId,
    });
  }

  return issueHospitalityCancellationAfterAmendmentAdjustmentNote({
    ...input,
    sourceInvoiceDocumentNumber,
  });
}
