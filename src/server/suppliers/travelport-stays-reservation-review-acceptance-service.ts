import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import { materializeHospitalitySupplierReservationCommercialReviewAcceptanceInput } from './hospitality-supplier-reservation-input-authority.ts';
import {
  materializeHospitalitySupplierBookingTermsResult,
  materializeHospitalitySupplierOfferRevalidationResult,
  materializeHospitalitySupplierReservationAuthorityResult,
} from './hospitality-supplier-reservation-provider-result-authority.ts';
import { createHospitalitySupplierReservationReviewAcceptance } from './hospitality-supplier-reservation-review-acceptance.ts';
import { assertHospitalitySupplierReservationReviewAttemptAuthority } from './hospitality-supplier-reservation-review-attempt-authority.ts';
import { hospitalitySupplierReservationAuthorityInputFromOperation } from './hospitality-supplier-reservation-submission-authority.ts';
import {
  assertHospitalitySupplierReservationTravelerPayloadAuthority,
  type HospitalitySupplierReservationTravelerPayloadInput,
} from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  HospitalitySupplierReservationConflictError,
} from './hospitality-supplier-reservation-domain.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

async function requireReviewAcceptanceAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'pricing:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });
}

function reviewConflict(message: string) {
  return new HospitalitySupplierReservationConflictError(message);
}

function assertReviewOperation(reservation: Readonly<{
  status: string;
  providerCode: string;
  rooms: number;
  requestFingerprintVersion: number | null;
  lastFailureCode: string | null;
  reviewAcceptedAt: Date | null;
}>) {
  if (reservation.status !== 'REVIEW_REQUIRED') {
    throw reviewConflict('Supplier reservation is not waiting for an explicit commercial review decision.');
  }
  if (reservation.providerCode !== 'travelport-stays' || reservation.rooms !== 1 || reservation.requestFingerprintVersion !== 2) {
    throw reviewConflict('Supplier reservation review requires a current single-room Travelport reservation request.');
  }
  if (reservation.reviewAcceptedAt) {
    throw reviewConflict('Supplier reservation review was already accepted and cannot be overwritten.');
  }
}

function assertIntegrationMatches(
  integration: Readonly<{ id: string; providerCode: string; credentialVersion: number; capabilities: readonly string[]; status?: string }>,
  reservation: Readonly<{ integrationId: string; providerCode: string; integrationCredentialVersion: number }>,
) {
  if (
    integration.id !== reservation.integrationId
    || integration.providerCode !== reservation.providerCode
    || integration.credentialVersion !== reservation.integrationCredentialVersion
    || (integration.status !== undefined && integration.status !== 'ACTIVE')
    || !integration.capabilities.includes('reservation')
  ) {
    throw reviewConflict(
      'Supplier integration changed after the reservation review became pending. Review the supplier offer again.',
    );
  }
}

function assertCurrentCommercialAuthority(input: Readonly<{
  reservation: Readonly<{
    supplierPropertyReference: string;
    supplierOfferReference: string;
    currency: string;
    expectedTotalMinor: bigint;
    offerFingerprint: string;
    termsFingerprint: string;
  }>;
  requirements: Readonly<{ acceptPriceChange: boolean; acceptGuaranteeChange: boolean }>;
  offer: Readonly<{
    supplierPropertyReference: string;
    supplierOfferReference: string;
    offerFingerprint: string;
    price: Readonly<{ currency: string; totalMinor: bigint }>;
  }>;
}>) {
  if (
    input.offer.supplierPropertyReference !== input.reservation.supplierPropertyReference
    || input.offer.supplierOfferReference !== input.reservation.supplierOfferReference
    || input.offer.price.currency !== input.reservation.currency
  ) {
    throw reviewConflict('Fresh supplier offer no longer matches the reservation review scope.');
  }
  const priceChanged = input.offer.price.totalMinor !== input.reservation.expectedTotalMinor;
  if (priceChanged !== input.requirements.acceptPriceChange) {
    throw reviewConflict(
      'Fresh supplier price no longer matches the commercial change that was presented for acceptance.',
    );
  }
}

export async function acceptTravelportStaysReservationCommercialReview(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
  acceptPriceChange: unknown;
  acceptGuaranteeChange: unknown;
}>) {
  input = materializeHospitalitySupplierReservationCommercialReviewAcceptanceInput(input) as typeof input;
  await requireReviewAcceptanceAuthority(input);
  assertUuidIdentifier(input.reservationId, 'reservationId');

  const reservation = await db.hospitalitySupplierReservationOperation.findFirst({
    where: { id: input.reservationId, organizationId: input.organizationId },
  });
  if (!reservation) {
    throw new HospitalitySupplierReservationUnavailableError(
      'Supplier reservation operation is not available in this organization.',
    );
  }
  assertReviewOperation(reservation);
  const reviewAttempt = await db.hospitalitySupplierReservationAttempt.findFirst({
    where: {
      organizationId: input.organizationId,
      reservationId: reservation.id,
      sequence: reservation.attemptCount,
    },
  });
  const requirements = assertHospitalitySupplierReservationReviewAttemptAuthority({ reservation, attempt: reviewAttempt });
  if (
    input.acceptPriceChange !== requirements.acceptPriceChange
    || input.acceptGuaranteeChange !== requirements.acceptGuaranteeChange
  ) {
    throw reviewConflict('Supplier reservation review acceptance must explicitly match the pending commercial change.');
  }

  let travelerAuthority;
  try {
    travelerAuthority = assertHospitalitySupplierReservationTravelerPayloadAuthority({
      expectedFingerprint: reservation.reservationPayloadFingerprint,
      traveler: input.traveler,
    });
  } catch {
    throw reviewConflict(
      'Primary traveler details changed after the supplier reservation request was prepared. Start a newly reviewed reservation request.',
    );
  }

  const current = await loadTravelportStaysIntegration(input.organizationId);
  assertIntegrationMatches(current.integration, reservation);

  const priorAuthorityInput = hospitalitySupplierReservationAuthorityInputFromOperation(reservation);
  const offerReview = materializeHospitalitySupplierOfferRevalidationResult(
    await current.provider.revalidatePropertyOffer(priorAuthorityInput),
  );
  if (!offerReview.offer || offerReview.status === 'UNAVAILABLE' || offerReview.status === 'OFFER_CHANGED') {
    throw reviewConflict('Supplier offer is no longer available for the pending commercial review.');
  }
  assertCurrentCommercialAuthority({ reservation, requirements, offer: offerReview.offer });

  const refreshedOfferInput = Object.freeze({
    supplierPropertyReference: reservation.supplierPropertyReference,
    supplierOfferReference: reservation.supplierOfferReference,
    expectedOfferFingerprint: offerReview.offer.offerFingerprint,
    expectedTotalMinor: offerReview.offer.price.totalMinor,
    currency: reservation.currency,
    checkInDateLocal: priorAuthorityInput.checkInDateLocal,
    checkOutDateLocal: priorAuthorityInput.checkOutDateLocal,
    rooms: reservation.rooms,
    adults: reservation.adults,
    childAges: Object.freeze([...reservation.childAges]),
  });

  const termsReview = materializeHospitalitySupplierBookingTermsResult(
    await current.bookingTermsProvider.retrieveBookingTerms(refreshedOfferInput),
  );
  if (
    termsReview.status !== 'READY'
    || !termsReview.offer
    || !termsReview.bookingTerms
    || termsReview.bookingTerms.completeForReservationReview !== true
    || termsReview.bookingTerms.revalidationRequired !== true
    || termsReview.bookingTerms.customerLoyaltyRequiredAtReservation !== false
    || termsReview.bookingTerms.supplierPropertyReference !== reservation.supplierPropertyReference
    || termsReview.bookingTerms.supplierOfferReference !== reservation.supplierOfferReference
    || termsReview.bookingTerms.price.currency !== reservation.currency
    || termsReview.bookingTerms.price.totalMinor !== offerReview.offer.price.totalMinor
    || termsReview.offer.supplierPropertyReference !== reservation.supplierPropertyReference
    || termsReview.offer.supplierOfferReference !== reservation.supplierOfferReference
    || termsReview.offer.offerFingerprint !== offerReview.offer.offerFingerprint
    || termsReview.offer.price.currency !== reservation.currency
    || termsReview.offer.price.totalMinor !== offerReview.offer.price.totalMinor
  ) {
    throw reviewConflict('Fresh supplier Rules authority is not stable enough to accept the pending commercial change.');
  }

  const finalAuthority = materializeHospitalitySupplierReservationAuthorityResult(
    await current.reservationAuthorityProvider.verifyReservationAuthority({
      ...refreshedOfferInput,
      expectedTermsFingerprint: termsReview.bookingTerms.termsFingerprint,
    }),
  );
  if (
    finalAuthority.status !== 'READY'
    || finalAuthority.revalidationRequired !== true
    || !finalAuthority.offer
    || !finalAuthority.bookingTerms
    || finalAuthority.bookingTerms.completeForReservationReview !== true
    || finalAuthority.bookingTerms.revalidationRequired !== true
    || finalAuthority.bookingTerms.customerLoyaltyRequiredAtReservation !== false
    || finalAuthority.bookingTerms.supplierPropertyReference !== reservation.supplierPropertyReference
    || finalAuthority.bookingTerms.supplierOfferReference !== reservation.supplierOfferReference
    || finalAuthority.bookingTerms.price.currency !== reservation.currency
    || finalAuthority.bookingTerms.price.totalMinor !== termsReview.offer.price.totalMinor
    || finalAuthority.offer.supplierPropertyReference !== reservation.supplierPropertyReference
    || finalAuthority.offer.supplierOfferReference !== reservation.supplierOfferReference
    || finalAuthority.offer.offerFingerprint !== termsReview.offer.offerFingerprint
    || finalAuthority.offer.price.currency !== reservation.currency
    || finalAuthority.offer.price.totalMinor !== termsReview.offer.price.totalMinor
    || finalAuthority.bookingTerms.termsFingerprint !== termsReview.bookingTerms.termsFingerprint
    || typeof finalAuthority.authorityFingerprint !== 'string'
    || !/^[0-9a-f]{64}$/.test(finalAuthority.authorityFingerprint)
    || typeof finalAuthority.providerSubmissionReference !== 'string'
    || !finalAuthority.providerSubmissionReference
  ) {
    throw reviewConflict('Fresh supplier availability authority changed before the commercial review could be accepted.');
  }

  const paymentAuthority = deriveHospitalitySupplierReservationPaymentAuthority({
    bookingTerms: finalAuthority.bookingTerms,
    currency: reservation.currency,
    expectedTotalMinor: finalAuthority.offer.price.totalMinor,
  });
  if (!paymentAuthority) {
    throw reviewConflict('Fresh supplier payment or guarantee authority is not supported for reservation acceptance.');
  }

  const accepted = createHospitalitySupplierReservationReviewAcceptance({
    reservationId: reservation.id,
    actorUserId: input.actorUserId,
    reservationPayloadFingerprint: reservation.reservationPayloadFingerprint,
    attemptSequence: reservation.attemptCount,
    failureCode: reservation.lastFailureCode,
    acceptPriceChange: input.acceptPriceChange,
    acceptGuaranteeChange: input.acceptGuaranteeChange,
    currency: reservation.currency,
    acceptedTotalMinor: finalAuthority.offer.price.totalMinor,
    acceptedOfferFingerprint: finalAuthority.offer.offerFingerprint,
    acceptedTermsFingerprint: finalAuthority.bookingTerms.termsFingerprint,
    acceptedAuthorityFingerprint: finalAuthority.authorityFingerprint,
  });

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-reservation:${input.organizationId}:operation:${input.reservationId}`}, 0))`;

    const latest = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (
      !latest
      || latest.status !== 'REVIEW_REQUIRED'
      || latest.lastFailureCode !== reservation.lastFailureCode
      || latest.attemptCount !== reservation.attemptCount
      || latest.requestFingerprint !== reservation.requestFingerprint
      || latest.reviewAcceptedAt
    ) {
      throw reviewConflict('Supplier reservation review changed while fresh commercial authority was being verified.');
    }

    const latestReviewAttempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        organizationId: input.organizationId,
        reservationId: latest.id,
        sequence: latest.attemptCount,
      },
    });
    assertHospitalitySupplierReservationReviewAttemptAuthority({ reservation: latest, attempt: latestReviewAttempt });
    if (!reviewAttempt || !latestReviewAttempt || latestReviewAttempt.id !== reviewAttempt.id) {
      throw reviewConflict('Supplier reservation review attempt changed while fresh commercial authority was being verified.');
    }

    const integration = await transaction.integration.findFirst({
      where: { id: latest.integrationId, organizationId: input.organizationId },
      select: { id: true, providerCode: true, credentialVersion: true, capabilities: true, status: true },
    });
    if (!integration) throw reviewConflict('Supplier integration is no longer available for reservation acceptance.');
    assertIntegrationMatches(integration, latest);

    const [databaseClock] = await transaction.$queryRaw<Array<{ currentTime: Date }>>`SELECT clock_timestamp() AS "currentTime"`;
    if (!databaseClock) throw reviewConflict('Supplier reservation acceptance time is unavailable.');
    const acceptedAt = databaseClock.currentTime;
    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: latest.id, organizationId: input.organizationId },
      data: {
        reviewAcceptedAt: acceptedAt,
        reviewAcceptedByUserId: input.actorUserId,
        reviewAcceptedAttemptSequence: latest.attemptCount,
        reviewAcceptedPriceChange: accepted.acceptPriceChange,
        reviewAcceptedGuaranteeChange: accepted.acceptGuaranteeChange,
        reviewAcceptedCurrency: accepted.currency,
        reviewAcceptedTotalMinor: accepted.acceptedTotalMinor,
        reviewAcceptedOfferFingerprint: accepted.acceptedOfferFingerprint,
        reviewAcceptedTermsFingerprint: accepted.acceptedTermsFingerprint,
        reviewAcceptedAuthorityFingerprint: accepted.acceptedAuthorityFingerprint,
        reviewAcceptanceFingerprint: accepted.acceptanceFingerprint,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-review-accepted',
        resourceType: 'supplier-reservation-operation',
        resourceId: latest.id,
        afterData: {
          providerCode: latest.providerCode,
          reviewReason: accepted.reason,
          acceptedPriceChange: accepted.acceptPriceChange,
          acceptedGuaranteeChange: accepted.acceptGuaranteeChange,
          acceptedCurrency: accepted.currency,
          acceptedTotalMinor: accepted.acceptedTotalMinor.toString(),
          reviewAttemptSequence: latest.attemptCount,
          acceptanceFingerprint: accepted.acceptanceFingerprint,
        },
      },
    });

    return Object.freeze({
      reservation: updated,
      acceptance: accepted,
      travelerAuthority,
      paymentAuthority,
    });
  }, { isolationLevel: 'Serializable' });
}
