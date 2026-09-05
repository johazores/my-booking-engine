import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness,
} from './hospitality-cancellation-after-amendment-adjustment-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainIntegrityError,
} from './hospitality-commercial-amendment-adjustment-chain-domain.ts';
import {
  HospitalityCommercialAmendmentAdjustmentChainLimitError,
  HospitalityCommercialAmendmentAdjustmentChainUnavailableError,
  loadVerifiedHospitalityCommercialAmendmentAdjustmentChain,
} from './hospitality-commercial-amendment-adjustment-chain-service.ts';

const AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN = /^AU-TAX-[0-9]{8,}$/;

export class HospitalityCancellationAfterAmendmentAdjustmentUnavailableError extends Error {
  constructor(message = 'Cancellation-after-amendment adjustment note is not available.') {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentUnavailableError';
  }
}

export class HospitalityCancellationAfterAmendmentAdjustmentPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityCancellationAfterAmendmentAdjustmentPersistenceError';
  }
}

function normalizeSourceInvoiceNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!AUSTRALIAN_TAX_INVOICE_NUMBER_PATTERN.test(normalized)) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentUnavailableError();
  }
  return normalized;
}

function mapChainError(error: unknown): never {
  if (
    error instanceof HospitalityCommercialAmendmentAdjustmentChainUnavailableError
    || error instanceof HospitalityCommercialAmendmentAdjustmentChainIntegrityError
    || error instanceof HospitalityCommercialAmendmentAdjustmentChainLimitError
  ) {
    throw new HospitalityCancellationAfterAmendmentAdjustmentPersistenceError(error.message);
  }
  throw error;
}

async function loadVerifiedReadiness(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}) {
  const sourceInvoice = await input.transaction.hospitalityIssuedInvoice.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      jurisdictionCode: 'AU',
      documentType: 'TAX_INVOICE',
      documentNumber: input.sourceInvoiceDocumentNumber,
    },
    select: { id: true },
  });
  if (!sourceInvoice) throw new HospitalityCancellationAfterAmendmentAdjustmentUnavailableError();

  const existingCancellation = await input.transaction.hospitalityIssuedAdjustmentNote.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
      adjustmentReason: 'BOOKING_CANCELLATION',
    },
    orderBy: [{ sourceAdjustmentOrdinal: 'desc' }, { issuedAt: 'desc' }, { id: 'desc' }],
    select: { documentNumber: true },
  });
  if (existingCancellation) {
    return Object.freeze({
      available: false as const,
      reason: 'A cancellation adjustment note has already been issued for this tax invoice.',
      documentNumber: existingCancellation.documentNumber,
    });
  }

  let chain;
  try {
    chain = await loadVerifiedHospitalityCommercialAmendmentAdjustmentChain({
      transaction: input.transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      sourceInvoiceId: sourceInvoice.id,
    });
  } catch (error) {
    mapChainError(error);
  }
  if (!chain.head || chain.priorAdjustments.length === 0) {
    return Object.freeze({
      available: false as const,
      reason: 'Cancellation-after-amendment requires an existing verified commercial adjustment-note chain.',
    });
  }
  const legalHeadPrice = chain.priorAdjustments[chain.priorAdjustments.length - 1]!.after;
  const booking = await input.transaction.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: { status: true, paymentStatus: true, currency: true, totalMinor: true },
  });
  if (!booking) throw new HospitalityCancellationAfterAmendmentAdjustmentUnavailableError();

  const transactions = await input.transaction.paymentTransaction.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId },
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
  });

  const readiness = deriveHospitalityCancellationAfterAmendmentAdjustmentReadiness({
    bookingStatus: booking.status,
    bookingPaymentStatus: booking.paymentStatus,
    bookingCurrency: booking.currency,
    bookingTotalMinor: booking.totalMinor,
    chainHead: {
      adjustmentNoteId: chain.head.adjustmentNoteId,
      sourceAdjustmentOrdinal: chain.head.sourceAdjustmentOrdinal,
      documentNumber: chain.head.documentNumber,
      issuedAt: chain.head.issuedAt,
      documentFingerprint: chain.head.documentFingerprint,
      afterPricingFingerprint: chain.head.afterPricingFingerprint,
      currency: legalHeadPrice.currency,
      accommodationSubtotalMinor: legalHeadPrice.accommodationSubtotalMinor,
      taxTotalMinor: legalHeadPrice.taxTotalMinor,
      feeTotalMinor: legalHeadPrice.feeTotalMinor,
      addonTotalMinor: legalHeadPrice.addonTotalMinor,
      totalMinor: legalHeadPrice.totalMinor,
    },
    transactions,
  });
  if (!readiness.ready) {
    return Object.freeze({ available: false as const, reason: readiness.reason });
  }

  return Object.freeze({
    available: true as const,
    sourceInvoiceId: sourceInvoice.id,
    sourceAdjustmentOrdinal: readiness.sourceAdjustmentOrdinal,
    predecessorAdjustmentNoteId: readiness.predecessorAdjustmentNoteId,
    predecessorSourceAdjustmentOrdinal: readiness.predecessorSourceAdjustmentOrdinal,
    predecessorAdjustmentDocumentNumber: readiness.predecessorAdjustmentDocumentNumber,
    predecessorAdjustmentIssuedAt: readiness.predecessorAdjustmentIssuedAt,
    predecessorAdjustmentDocumentFingerprint: readiness.predecessorAdjustmentDocumentFingerprint,
    predecessorAfterPricingFingerprint: readiness.predecessorAfterPricingFingerprint,
    currency: readiness.currency,
    decreaseSubtotalMinor: readiness.decreaseSubtotalMinor,
    decreaseTaxMinor: readiness.decreaseTaxMinor,
    decreaseTotalMinor: readiness.decreaseTotalMinor,
    refundAuthorities: readiness.refundAuthorities,
  });
}

export async function getHospitalityCancellationAfterAmendmentAdjustmentNoteAvailability(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  sourceInvoiceDocumentNumber: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const sourceInvoiceDocumentNumber = normalizeSourceInvoiceNumber(input.sourceInvoiceDocumentNumber);
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });

  return db.$transaction((transaction) => loadVerifiedReadiness({
    transaction,
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    sourceInvoiceDocumentNumber,
  }), { isolationLevel: 'Serializable' });
}
