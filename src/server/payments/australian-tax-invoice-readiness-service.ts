import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { parseHospitalityBookingPricingEvidenceBreakdown } from '../bookings/booking-pricing-evidence-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { assessAustralianTaxInvoiceReadiness } from './australian-tax-invoice-domain.ts';
import {
  hospitalityInvoicePreparationFingerprint,
  parseHospitalityInvoicePreparationSnapshot,
} from './hospitality-invoice-preparation-domain.ts';
import { hospitalityInvoiceRecipientFingerprint } from './hospitality-invoice-recipient-domain.ts';
import {
  invoiceIssuerProfileFingerprint,
  parseInvoiceIssuerProfileSnapshot,
} from './invoice-issuer-domain.ts';

export class AustralianTaxInvoiceReadinessUnavailableError extends Error {
  constructor(message = 'Australian tax-invoice readiness is not available for this invoice preparation.') {
    super(message);
    this.name = 'AustralianTaxInvoiceReadinessUnavailableError';
  }
}

export class AustralianTaxInvoiceReadinessPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AustralianTaxInvoiceReadinessPersistenceError';
  }
}

export async function verifyHospitalityAustralianTaxInvoicePreparation(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  preparationId: string;
}) {
  const preparation = await input.transaction.hospitalityInvoicePreparation.findFirst({
    where: { id: input.preparationId, organizationId: input.organizationId },
  });
  if (!preparation) throw new AustralianTaxInvoiceReadinessUnavailableError();

  let preparationSnapshot;
  try {
    preparationSnapshot = parseHospitalityInvoicePreparationSnapshot(preparation.preparationSnapshot);
  } catch (error) {
    throw new AustralianTaxInvoiceReadinessPersistenceError(
      error instanceof Error ? error.message : 'Persisted invoice preparation is invalid.',
    );
  }
  if (preparationSnapshot.schemaVersion !== 2) {
    throw new AustralianTaxInvoiceReadinessPersistenceError(
      'Legacy invoice preparation is missing immutable recipient evidence and cannot be used for Australian tax-invoice readiness.',
    );
  }
  if (
    preparationSnapshot.pricingEvidenceId !== preparation.pricingEvidenceId
    || preparationSnapshot.issuerProfileId !== preparation.issuerProfileId
    || preparationSnapshot.currency !== preparation.currency
    || BigInt(preparationSnapshot.accommodationSubtotalMinor) !== preparation.accommodationSubtotalMinor
    || BigInt(preparationSnapshot.taxTotalMinor) !== preparation.taxTotalMinor
    || BigInt(preparationSnapshot.feeTotalMinor) !== preparation.feeTotalMinor
    || BigInt(preparationSnapshot.addonTotalMinor) !== preparation.addonTotalMinor
    || BigInt(preparationSnapshot.totalMinor) !== preparation.totalMinor
    || preparationSnapshot.pricingFingerprint !== preparation.pricingFingerprint
    || preparationSnapshot.issuerFingerprint !== preparation.issuerFingerprint
    || preparationSnapshot.recipientFingerprint !== preparation.recipientFingerprint
    || hospitalityInvoiceRecipientFingerprint(preparationSnapshot.recipient) !== preparationSnapshot.recipientFingerprint
    || hospitalityInvoicePreparationFingerprint(preparationSnapshot) !== preparation.documentFingerprint
  ) {
    throw new AustralianTaxInvoiceReadinessPersistenceError(
      'Persisted invoice preparation failed Australian readiness integrity validation.',
    );
  }

  const [booking, issuer, evidence] = await Promise.all([
    input.transaction.hospitalityBooking.findFirst({
      where: { id: preparation.bookingId, organizationId: input.organizationId },
      select: {
        id: true,
        status: true,
        currency: true,
        accommodationSubtotalMinor: true,
        taxTotalMinor: true,
        feeTotalMinor: true,
        addonTotalMinor: true,
        totalMinor: true,
        pricingFingerprint: true,
      },
    }),
    input.transaction.invoiceIssuerProfile.findFirst({
      where: { id: preparation.issuerProfileId, organizationId: input.organizationId },
    }),
    input.transaction.hospitalityBookingPricingEvidence.findFirst({
      where: {
        id: preparation.pricingEvidenceId,
        bookingId: preparation.bookingId,
        organizationId: input.organizationId,
      },
    }),
  ]);
  if (!booking || !issuer || !evidence) {
    throw new AustralianTaxInvoiceReadinessPersistenceError(
      'Invoice preparation dependencies are missing or outside the tenant boundary.',
    );
  }
  if (
    !['CONFIRMED', 'CANCELLED'].includes(booking.status)
    || booking.currency !== preparation.currency
    || booking.accommodationSubtotalMinor !== preparation.accommodationSubtotalMinor
    || booking.taxTotalMinor !== preparation.taxTotalMinor
    || booking.feeTotalMinor !== preparation.feeTotalMinor
    || booking.addonTotalMinor !== preparation.addonTotalMinor
    || booking.totalMinor !== preparation.totalMinor
    || booking.pricingFingerprint !== preparation.pricingFingerprint
  ) {
    throw new AustralianTaxInvoiceReadinessPersistenceError(
      'Invoice preparation no longer represents the booking current accepted commercial state.',
    );
  }

  let issuerSnapshot;
  let pricingBreakdown;
  try {
    issuerSnapshot = parseInvoiceIssuerProfileSnapshot(issuer.profileSnapshot);
    pricingBreakdown = parseHospitalityBookingPricingEvidenceBreakdown(evidence.pricingBreakdown);
  } catch (error) {
    throw new AustralianTaxInvoiceReadinessPersistenceError(
      error instanceof Error ? error.message : 'Persisted legal invoice evidence is invalid.',
    );
  }
  if (
    invoiceIssuerProfileFingerprint(issuerSnapshot) !== issuer.fingerprint
    || issuer.fingerprint !== preparation.issuerFingerprint
    || evidence.currency !== preparation.currency
    || evidence.accommodationSubtotalMinor !== preparation.accommodationSubtotalMinor
    || evidence.taxTotalMinor !== preparation.taxTotalMinor
    || evidence.feeTotalMinor !== preparation.feeTotalMinor
    || evidence.addonTotalMinor !== preparation.addonTotalMinor
    || evidence.totalMinor !== preparation.totalMinor
    || evidence.pricingFingerprint !== preparation.pricingFingerprint
    || pricingBreakdown.currency !== preparation.currency
    || BigInt(pricingBreakdown.accommodationSubtotalMinor) !== preparation.accommodationSubtotalMinor
    || BigInt(pricingBreakdown.taxTotalMinor) !== preparation.taxTotalMinor
    || BigInt(pricingBreakdown.feeTotalMinor) !== preparation.feeTotalMinor
    || BigInt(pricingBreakdown.addonTotalMinor) !== preparation.addonTotalMinor
    || BigInt(pricingBreakdown.totalMinor) !== preparation.totalMinor
    || pricingBreakdown.pricingFingerprint !== preparation.pricingFingerprint
  ) {
    throw new AustralianTaxInvoiceReadinessPersistenceError(
      'Issuer or pricing evidence no longer matches the immutable invoice preparation.',
    );
  }

  const assessment = assessAustralianTaxInvoiceReadiness({
    issuer: issuerSnapshot,
    pricing: pricingBreakdown,
    buyer: preparationSnapshot.recipient,
  });

  return Object.freeze({
    preparation,
    preparationSnapshot,
    booking,
    issuerSnapshot,
    pricingBreakdown,
    assessment,
  });
}

export async function assessHospitalityAustralianTaxInvoiceReadiness(input: {
  organizationId: string;
  actorUserId: string;
  preparationId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.preparationId, 'preparationId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });

  return db.$transaction(async (transaction) => {
    const verified = await verifyHospitalityAustralianTaxInvoicePreparation({
      transaction,
      organizationId: input.organizationId,
      preparationId: input.preparationId,
    });
    const { preparation, preparationSnapshot, booking, assessment } = verified;

    return Object.freeze({
      preparationId: preparation.id,
      bookingId: booking.id,
      jurisdictionCode: assessment.contract.jurisdictionCode,
      contentReady: assessment.contentReady,
      supplierAbn: assessment.supplierAbn,
      buyerIdentityRequired: assessment.buyerIdentityRequired,
      buyerIdentity: assessment.buyerIdentity,
      buyerAbn: assessment.buyerAbn,
      recipientType: preparationSnapshot.recipient.recipientType,
      recipientFingerprint: preparationSnapshot.recipientFingerprint,
      requirements: assessment.requirements,
    });
  }, { isolationLevel: 'Serializable' });
}
