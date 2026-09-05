import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
} from './hospitality-commercial-amendment-adjustment-chain-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainLimitError,
  HospitalityCommercialAmendmentAdjustmentChainUnavailableError,
  loadVerifiedHospitalityCommercialAmendmentAdjustmentChain,
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';
import {
  HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError,
  HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError,
  HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError,
  HospitalityCommercialAmendmentIncreasingAdjustmentNoteWriteConflictError,
  getHospitalityCommercialAmendmentIncreasingAdjustmentNoteAvailability,
  issueHospitalityCommercialAmendmentIncreasingAdjustmentNote,
} from './hospitality-commercial-amendment-increasing-adjustment-note-service.ts';
import {
  HospitalityCommercialAmendmentAdjustmentNoteConflictError,
  HospitalityCommercialAmendmentAdjustmentNotePersistenceError,
  HospitalityCommercialAmendmentAdjustmentNoteUnavailableError,
  HospitalityCommercialAmendmentAdjustmentNoteWriteConflictError,
} from './hospitality-commercial-amendment-adjustment-note-service.ts';
import {
  getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability as getHospitalityNextDecreasingCommercialAmendmentAdjustmentNoteAvailability,
  issueHospitalityNextCommercialAmendmentAdjustmentNote as issueHospitalityNextDecreasingCommercialAmendmentAdjustmentNote,
} from './hospitality-commercial-amendment-adjustment-orchestration-service.ts';
import {
  getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability,
} from './hospitality-repeated-commercial-amendment-increasing-adjustment-availability-service.ts';
import {
  issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote,
} from './hospitality-repeated-commercial-amendment-increasing-adjustment-note-service.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

type AvailabilityInput = Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}>;

type IssueInput = AvailabilityInput & Readonly<{
  commercialAmendmentId: string;
}>;

function normalizeSourceInvoiceNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(normalized)) {
    throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();
  }
  return normalized;
}

async function requireAdjustmentManageAccess(input: { organizationId: string; actorUserId: string }) {
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });
}

function mapChainError(error: unknown): never {
  if (error instanceof HospitalityCommercialAmendmentAdjustmentChainLimitError) {
    throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(error.message);
  }
  if (
    error instanceof HospitalityCommercialAmendmentAdjustmentChainUnavailableError
    || error instanceof HospitalityCommercialAmendmentAdjustmentChainIntegrityError
  ) {
    throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(error.message);
  }
  throw error;
}

async function loadProductVerifiedChain(
  input: Parameters<typeof loadVerifiedHospitalityCommercialAmendmentAdjustmentChain>[0],
) {
  try {
    return await loadVerifiedHospitalityCommercialAmendmentAdjustmentChain(input);
  } catch (error) {
    mapChainError(error);
  }
}

async function inspectSourceAdjustmentState(input: AvailabilityInput, sourceInvoiceDocumentNumber: string) {
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
    if (!sourceInvoice) throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();

    const nonCommercial = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
        adjustmentReason: { not: 'COMMERCIAL_AMENDMENT' },
      },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      select: { documentNumber: true },
    });
    if (nonCommercial) {
      return Object.freeze({
        kind: 'OTHER_LEGAL_ADJUSTMENT' as const,
        documentNumber: nonCommercial.documentNumber,
      });
    }

    const commercialCount = await transaction.hospitalityIssuedAdjustmentNote.count({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        sourceInvoiceId: sourceInvoice.id,
        adjustmentReason: 'COMMERCIAL_AMENDMENT',
      },
    });
    if (commercialCount === 0) return Object.freeze({ kind: 'EMPTY' as const });

    const chain = await loadProductVerifiedChain({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
    });
    if (!chain.head || chain.priorAdjustmentNoteCount !== commercialCount) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Commercial adjustment-note history does not match the verified legal chain.',
      );
    }

    return Object.freeze({
      kind: 'COMMERCIAL_CHAIN' as const,
      latestDocumentNumber: chain.head.documentNumber,
    });
  }, { isolationLevel: 'Serializable' });
}

async function inspectUniqueAppliedBaselineCandidate(
  input: AvailabilityInput,
  sourceInvoiceDocumentNumber: string,
  commercialAmendmentId: string,
) {
  return db.$transaction(async (transaction) => {
    const sourceInvoice = await transaction.hospitalityIssuedInvoice.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        jurisdictionCode: 'AU',
        documentType: 'TAX_INVOICE',
        documentNumber: sourceInvoiceDocumentNumber,
      },
      select: { id: true, issuedAt: true },
    });
    if (!sourceInvoice) throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();

    const chain = await loadProductVerifiedChain({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
    });
    const legalBaselineIssuedAt = chain.head?.issuedAt ?? sourceInvoice.issuedAt;

    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        id: commercialAmendmentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        status: 'APPLIED',
        direction: { in: ['REFUND', 'ADDITIONAL_CHARGE'] },
      },
      select: {
        id: true,
        direction: true,
        currency: true,
        beforeTotalMinor: true,
        beforePricingFingerprint: true,
        appliedAt: true,
      },
    });
    if (!amendment?.appliedAt || amendment.appliedAt.getTime() < legalBaselineIssuedAt.getTime()) {
      return null;
    }

    const competingAppliedBaselineCount = await transaction.hospitalityBookingCommercialAmendment.count({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        id: { not: amendment.id },
        status: 'APPLIED',
        direction: { in: ['REFUND', 'ADDITIONAL_CHARGE'] },
        currency: amendment.currency,
        beforeTotalMinor: amendment.beforeTotalMinor,
        beforePricingFingerprint: amendment.beforePricingFingerprint,
        appliedAt: { gte: legalBaselineIssuedAt },
      },
    });

    return Object.freeze({
      direction: amendment.direction,
      unique: competingAppliedBaselineCount === 0,
    });
  }, { isolationLevel: 'Serializable' });
}

async function firstIncreasingAvailability(input: AvailabilityInput, sourceInvoiceDocumentNumber: string) {
  try {
    return await getHospitalityCommercialAmendmentIncreasingAdjustmentNoteAvailability({
      ...input,
      sourceInvoiceDocumentNumber,
    });
  } catch (error) {
    if (
      error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError
      || error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError
    ) {
      return Object.freeze({ available: false as const, reason: error.message });
    }
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(error.message);
    }
    throw error;
  }
}

async function issueIncreasingAdjustment(
  input: IssueInput,
  sourceInvoiceDocumentNumber: string,
  repeated: boolean,
) {
  try {
    return repeated
      ? await issueHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNote({
          ...input,
          sourceInvoiceDocumentNumber,
        })
      : await issueHospitalityCommercialAmendmentIncreasingAdjustmentNote({
          ...input,
          sourceInvoiceDocumentNumber,
        });
  } catch (error) {
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNoteConflictError) {
      throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(error.message);
    }
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNoteUnavailableError) {
      throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError(error.message);
    }
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNotePersistenceError) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(error.message);
    }
    if (error instanceof HospitalityCommercialAmendmentIncreasingAdjustmentNoteWriteConflictError) {
      throw new HospitalityCommercialAmendmentAdjustmentNoteWriteConflictError();
    }
    throw error;
  }
}

export async function getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability(input: AvailabilityInput) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireAdjustmentManageAccess(input);

  const sourceState = await inspectSourceAdjustmentState(input, sourceInvoiceDocumentNumber);
  if (sourceState.kind === 'OTHER_LEGAL_ADJUSTMENT') {
    return Object.freeze({
      available: false as const,
      reason: 'A different legal adjustment already exists for this tax invoice.',
      latestDocumentNumber: sourceState.documentNumber,
    });
  }

  const decreasing = await getHospitalityNextDecreasingCommercialAmendmentAdjustmentNoteAvailability({
    ...input,
    sourceInvoiceDocumentNumber,
  });
  if (decreasing.available) {
    const candidate = await inspectUniqueAppliedBaselineCandidate(
      input,
      sourceInvoiceDocumentNumber,
      decreasing.commercialAmendmentId,
    );
    if (!candidate || candidate.direction !== 'REFUND') {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Decreasing adjustment availability no longer matches persisted commercial-amendment authority.',
      );
    }
    if (!candidate.unique) {
      return Object.freeze({
        available: false as const,
        reason: 'Multiple applied commercial amendments compete for the current legal price baseline.',
        latestDocumentNumber: decreasing.latestDocumentNumber,
      });
    }
    return Object.freeze({ ...decreasing, adjustmentType: 'DECREASING' as const });
  }

  if (sourceState.kind === 'COMMERCIAL_CHAIN') {
    const repeatedIncreasing = await getHospitalityRepeatedCommercialAmendmentIncreasingAdjustmentNoteAvailability({
      ...input,
      sourceInvoiceDocumentNumber,
    });
    if (repeatedIncreasing.available) {
      return Object.freeze({
        ...repeatedIncreasing,
        adjustmentType: 'INCREASING' as const,
      });
    }

    return Object.freeze({
      available: false as const,
      reason: decreasing.reason,
      latestDocumentNumber: sourceState.latestDocumentNumber,
    });
  }

  const increasing = await firstIncreasingAvailability(input, sourceInvoiceDocumentNumber);
  if (!increasing.available) {
    const latestDocumentNumber = 'documentNumber' in increasing ? increasing.documentNumber : null;
    return Object.freeze({
      available: false as const,
      reason: increasing.reason,
      latestDocumentNumber,
    });
  }

  const candidate = await inspectUniqueAppliedBaselineCandidate(
    input,
    sourceInvoiceDocumentNumber,
    increasing.commercialAmendmentId,
  );
  if (!candidate || candidate.direction !== 'ADDITIONAL_CHARGE') {
    throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
      'Increasing adjustment availability no longer matches persisted commercial-amendment authority.',
    );
  }
  if (!candidate.unique) {
    return Object.freeze({
      available: false as const,
      reason: 'Multiple applied commercial amendments compete for the source tax-invoice baseline.',
      latestDocumentNumber: null,
    });
  }

  return Object.freeze({
    available: true as const,
    commercialAmendmentId: increasing.commercialAmendmentId,
    sourceAdjustmentOrdinal: increasing.sourceAdjustmentOrdinal,
    adjustmentType: 'INCREASING' as const,
    latestDocumentNumber: null,
  });
}

async function existingIssuedAmendment(input: IssueInput, sourceInvoiceDocumentNumber: string) {
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
    if (!sourceInvoice) throw new HospitalityCommercialAmendmentAdjustmentNoteUnavailableError();

    const existing = await transaction.hospitalityIssuedAdjustmentNote.findFirst({
      where: {
        organizationId: input.organizationId,
        commercialAmendmentId: input.commercialAmendmentId,
      },
    });
    if (!existing) return null;
    if (
      existing.bookingId !== input.bookingId
      || existing.sourceInvoiceId !== sourceInvoice.id
      || existing.adjustmentReason !== 'COMMERCIAL_AMENDMENT'
      || (existing.adjustmentType !== 'DECREASING' && existing.adjustmentType !== 'INCREASING')
    ) {
      throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
        'Commercial amendment is already bound to a different adjustment note.',
      );
    }

    const chain = await loadProductVerifiedChain({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
    });
    const verifiedExisting = chain.priorAdjustments.find(
      (entry) => entry.adjustmentNoteId === existing.id,
    );
    if (
      !verifiedExisting
      || verifiedExisting.sourceAdjustmentOrdinal !== existing.sourceAdjustmentOrdinal
    ) {
      throw new HospitalityCommercialAmendmentAdjustmentNotePersistenceError(
        'Issued commercial-amendment adjustment note no longer belongs to its verified legal chain.',
      );
    }
    return existing;
  }, { isolationLevel: 'Serializable' });
}

export async function issueHospitalityNextCommercialAmendmentAdjustmentNote(input: IssueInput) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.commercialAmendmentId, 'commercialAmendmentId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireAdjustmentManageAccess(input);

  const existing = await existingIssuedAmendment(input, sourceInvoiceDocumentNumber);
  if (existing) return existing;

  const availability = await getHospitalityNextCommercialAmendmentAdjustmentNoteAvailability({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    bookingId: input.bookingId,
    sourceInvoiceDocumentNumber,
  });
  if (!availability.available) {
    throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(availability.reason);
  }
  if (availability.commercialAmendmentId !== input.commercialAmendmentId) {
    throw new HospitalityCommercialAmendmentAdjustmentNoteConflictError(
      'The requested commercial amendment is not the unique next legal adjustment for this tax invoice.',
    );
  }

  if (availability.adjustmentType === 'INCREASING') {
    return issueIncreasingAdjustment(
      input,
      sourceInvoiceDocumentNumber,
      availability.sourceAdjustmentOrdinal > 1,
    );
  }
  return issueHospitalityNextDecreasingCommercialAmendmentAdjustmentNote({
    ...input,
    sourceInvoiceDocumentNumber,
  });
}
