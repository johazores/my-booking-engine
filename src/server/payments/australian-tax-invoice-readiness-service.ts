import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { parseHospitalityBookingPricingEvidenceBreakdown } from '../bookings/booking-pricing-evidence-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { assessAustralianTaxInvoiceReadiness } from './australian-tax-invoice-domain.ts';
import {
  hospitalityInvoicePreparationFingerprint,
  parseHospitalityInvoicePreparationSnapshot,
} from './hospitality-invoice-preparation-domain.ts';
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

function buyerIdentity(firstName: string, lastName: string) {
  const normalized = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
  return normalized || null;
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
    const preparation = await transaction.hospitalityInvoicePreparation.findFirst({
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
    if (
      preparationSnapshot.pricingEvidenceId !== preparation.pricingEvidenceId
      || preparationSnapshot.issuerProfileId !== preparation.issuerProfileId
      || preparationSnapshot.currency !== preparation.currency
      || BigInt(preparationSnapshot.taxTotalMinor) !== preparation.taxTotalMinor
      || BigInt(preparationSnapshot.totalMinor) !== preparation.totalMinor
      || preparationSnapshot.pricingFingerprint !== preparation.pricingFingerprint
      || preparationSnapshot.issuerFingerprint !== preparation.issuerFingerprint
      || hospitalityInvoicePreparationFingerprint(preparationSnapshot) !== preparation.documentFingerprint
    ) {
      throw new AustralianTaxInvoiceReadinessPersistenceError(
        'Persisted invoice preparation failed Australian readiness integrity validation.',
      );
    }

    const [booking, issuer, evidence] = await Promise.all([
      transaction.hospitalityBooking.findFirst({
        where: { id: preparation.bookingId, organizationId: input.organizationId },
        select: {
          id: true,
          customerId: true,
        },
      }),
      transaction.invoiceIssuerProfile.findFirst({
        where: { id: preparation.issuerProfileId, organizationId: input.organizationId },
      }),
      transaction.hospitalityBookingPricingEvidence.findFirst({
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

    const customer = await transaction.customer.findFirst({
      where: { id: booking.customerId, organizationId: input.organizationId },
      select: { firstName: true, lastName: true },
    });
    if (!customer) {
      throw new AustralianTaxInvoiceReadinessPersistenceError('Invoice recipient identity is unavailable.');
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
      || evidence.taxTotalMinor !== preparation.taxTotalMinor
      || evidence.totalMinor !== preparation.totalMinor
      || evidence.pricingFingerprint !== preparation.pricingFingerprint
      || pricingBreakdown.currency !== preparation.currency
      || BigInt(pricingBreakdown.taxTotalMinor) !== preparation.taxTotalMinor
      || BigInt(pricingBreakdown.totalMinor) !== preparation.totalMinor
      || pricingBreakdown.pricingFingerprint !== preparation.pricingFingerprint
    ) {
      throw new AustralianTaxInvoiceReadinessPersistenceError(
        'Issuer or pricing evidence no longer matches the immutable invoice preparation.',
      );
    }

    const recipientIdentity = buyerIdentity(customer.firstName, customer.lastName);
    const assessment = assessAustralianTaxInvoiceReadiness({
      issuer: issuerSnapshot,
      pricing: pricingBreakdown,
      buyerIdentity: recipientIdentity,
    });

    return Object.freeze({
      preparationId: preparation.id,
      bookingId: booking.id,
      jurisdictionCode: assessment.contract.jurisdictionCode,
      contentReady: assessment.contentReady,
      supplierAbn: assessment.supplierAbn,
      buyerIdentityRequired: assessment.buyerIdentityRequired,
      buyerIdentity: recipientIdentity,
      requirements: assessment.requirements,
    });
  }, { isolationLevel: 'Serializable' });
}
