import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import { materializeHospitalitySupplierReservationAcceptedReviewInput } from './hospitality-supplier-reservation-input-authority.ts';
import {
  materializeHospitalitySupplierBookingTermsResult,
  materializeHospitalitySupplierOfferRevalidationResult,
  materializeHospitalitySupplierReservationAuthorityResult,
} from './hospitality-supplier-reservation-provider-result-authority.ts';
import { assertHospitalitySupplierReservationStoredReviewAcceptance } from './hospitality-supplier-reservation-review-acceptance.ts';
import { assertHospitalitySupplierReservationReviewAttemptAuthority } from './hospitality-supplier-reservation-review-attempt-authority.ts';
import { hospitalitySupplierReservationAuthorityInputFromOperation } from './hospitality-supplier-reservation-submission-authority.ts';
import {
  assertHospitalitySupplierReservationTravelerPayloadAuthority,
  type HospitalitySupplierReservationTravelerPayloadInput,
} from './hospitality-supplier-reservation-traveler-authority.ts';
import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

async function requireReviewConsumptionAuthority(input: Readonly<{
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

function conflict(message: string): never {
  throw new HospitalitySupplierReservationConflictError(message);
}

function assertIntegrationMatches(
  integration: Readonly<{
    id: string;
    providerCode: string;
    credentialVersion: number;
    capabilities: readonly string[];
    status?: string;
  }>,
  reservation: Readonly<{
    integrationId: string;
    providerCode: string;
    integrationCredentialVersion: number;
  }>,
) {
  if (
    integration.id !== reservation.integrationId
    || integration.providerCode !== reservation.providerCode
    || integration.credentialVersion !== reservation.integrationCredentialVersion
    || (integration.status !== undefined && integration.status !== 'ACTIVE')
    || !integration.capabilities.includes('reservation')
  ) {
    conflict('Supplier integration changed after the commercial review was accepted. Review the supplier offer again.');
  }
}

/**
 * Re-establish the exact accepted commercial authority immediately before a future one-time
 * reviewed second sell is claimed. This function is deliberately read-only: it does not create
 * an attempt, clear acceptance evidence, set a provider-request marker, or call Create Reservation.
 */
export async function reviewTravelportStaysReservationAcceptedCommercialAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
  expectedAcceptanceFingerprint: unknown;
}>) {
  input = materializeHospitalitySupplierReservationAcceptedReviewInput(input) as typeof input;
  await requireReviewConsumptionAuthority(input);
  assertUuidIdentifier(input.reservationId, 'reservationId');

  const reservation = await db.hospitalitySupplierReservationOperation.findFirst({
    where: { id: input.reservationId, organizationId: input.organizationId },
  });
  if (!reservation) {
    throw new HospitalitySupplierReservationUnavailableError(
      'Supplier reservation operation is not available in this organization.',
    );
  }

  const stored = assertHospitalitySupplierReservationStoredReviewAcceptance(reservation);
  if (
    typeof input.expectedAcceptanceFingerprint !== 'string'
    || input.expectedAcceptanceFingerprint !== stored.acceptance.acceptanceFingerprint
  ) {
    conflict('Supplier reservation acceptance changed before reviewed consumption authority was requested.');
  }

  const reviewAttempt = await db.hospitalitySupplierReservationAttempt.findFirst({
    where: {
      organizationId: input.organizationId,
      reservationId: reservation.id,
      sequence: stored.reviewAttemptSequence,
    },
  });
  const requirements = assertHospitalitySupplierReservationReviewAttemptAuthority({ reservation, attempt: reviewAttempt });
  if (
    requirements.acceptPriceChange !== stored.acceptance.acceptPriceChange
    || requirements.acceptGuaranteeChange !== stored.acceptance.acceptGuaranteeChange
  ) {
    conflict('Supplier reservation review attempt no longer matches the accepted commercial decision.');
  }

  let travelerAuthority;
  try {
    travelerAuthority = assertHospitalitySupplierReservationTravelerPayloadAuthority({
      expectedFingerprint: reservation.reservationPayloadFingerprint,
      traveler: input.traveler,
    });
  } catch {
    conflict(
      'Primary traveler details changed after the commercial review was accepted. Start a newly reviewed reservation request.',
    );
  }

  const current = await loadTravelportStaysIntegration(input.organizationId);
  assertIntegrationMatches(current.integration, reservation);
  const priorAuthorityInput = hospitalitySupplierReservationAuthorityInputFromOperation(reservation);

  const offerReview = materializeHospitalitySupplierOfferRevalidationResult(
    await current.provider.revalidatePropertyOffer(priorAuthorityInput),
  );
  if (
    offerReview.status !== 'UNCHANGED'
    || !offerReview.offer
    || offerReview.offer.supplierPropertyReference !== reservation.supplierPropertyReference
    || offerReview.offer.supplierOfferReference !== reservation.supplierOfferReference
    || offerReview.offer.offerFingerprint !== stored.acceptance.acceptedOfferFingerprint
    || offerReview.offer.price.currency !== stored.acceptance.currency
    || offerReview.offer.price.totalMinor !== stored.acceptance.acceptedTotalMinor
  ) {
    conflict('Fresh supplier offer no longer matches the accepted commercial review.');
  }

  const refreshedOfferInput = Object.freeze({
    supplierPropertyReference: reservation.supplierPropertyReference,
    supplierOfferReference: reservation.supplierOfferReference,
    expectedOfferFingerprint: stored.acceptance.acceptedOfferFingerprint,
    expectedTotalMinor: stored.acceptance.acceptedTotalMinor,
    currency: stored.acceptance.currency,
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
    || termsReview.bookingTerms.price.currency !== stored.acceptance.currency
    || termsReview.bookingTerms.price.totalMinor !== stored.acceptance.acceptedTotalMinor
    || termsReview.offer.supplierPropertyReference !== reservation.supplierPropertyReference
    || termsReview.offer.supplierOfferReference !== reservation.supplierOfferReference
    || termsReview.offer.offerFingerprint !== stored.acceptance.acceptedOfferFingerprint
    || termsReview.offer.price.currency !== stored.acceptance.currency
    || termsReview.offer.price.totalMinor !== stored.acceptance.acceptedTotalMinor
    || termsReview.bookingTerms.termsFingerprint !== stored.acceptance.acceptedTermsFingerprint
  ) {
    conflict('Fresh supplier Rules authority no longer matches the accepted commercial review.');
  }

  const finalAuthority = materializeHospitalitySupplierReservationAuthorityResult(
    await current.reservationAuthorityProvider.verifyReservationAuthority({
      ...refreshedOfferInput,
      expectedTermsFingerprint: stored.acceptance.acceptedTermsFingerprint,
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
    || finalAuthority.bookingTerms.price.currency !== stored.acceptance.currency
    || finalAuthority.bookingTerms.price.totalMinor !== stored.acceptance.acceptedTotalMinor
    || finalAuthority.offer.supplierPropertyReference !== reservation.supplierPropertyReference
    || finalAuthority.offer.supplierOfferReference !== reservation.supplierOfferReference
    || finalAuthority.offer.offerFingerprint !== stored.acceptance.acceptedOfferFingerprint
    || finalAuthority.offer.price.currency !== stored.acceptance.currency
    || finalAuthority.offer.price.totalMinor !== stored.acceptance.acceptedTotalMinor
    || finalAuthority.bookingTerms.termsFingerprint !== stored.acceptance.acceptedTermsFingerprint
    || finalAuthority.authorityFingerprint !== stored.acceptance.acceptedAuthorityFingerprint
    || typeof finalAuthority.providerSubmissionReference !== 'string'
    || !finalAuthority.providerSubmissionReference
  ) {
    conflict('Fresh supplier Availability authority no longer matches the accepted commercial review.');
  }

  const paymentAuthority = deriveHospitalitySupplierReservationPaymentAuthority({
    bookingTerms: finalAuthority.bookingTerms,
    currency: stored.acceptance.currency,
    expectedTotalMinor: stored.acceptance.acceptedTotalMinor,
  });
  if (!paymentAuthority) {
    conflict('Fresh supplier payment or guarantee authority is not supported for reviewed reservation consumption.');
  }

  return Object.freeze({
    reservation,
    reviewAttempt,
    storedAcceptance: stored,
    travelerAuthority,
    paymentAuthority,
    providerSubmissionReference: finalAuthority.providerSubmissionReference,
  });
}
