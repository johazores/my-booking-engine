import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
  assertHospitalitySupplierReservationCanSubmit,
  type HospitalitySupplierReservationSelectionInput,
} from './hospitality-supplier-reservation-domain.ts';
import type { HospitalitySupplierReservationAuthorityInput } from './hospitality-supplier-reservation-authority.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  assertHospitalitySupplierReservationSubmissionAuthority,
  hospitalitySupplierReservationAuthorityInputFromOperation,
} from './hospitality-supplier-reservation-submission-authority.ts';
import {
  claimHospitalitySupplierReservationSubmission,
  HospitalitySupplierReservationUnavailableError,
  prepareHospitalitySupplierReservation,
} from './hospitality-supplier-reservation-service.ts';
import {
  assertHospitalitySupplierReservationTravelerPayloadAuthority,
  hospitalitySupplierReservationTravelerPayloadFingerprint,
  normalizeHospitalitySupplierReservationTravelerPayload,
  type HospitalitySupplierReservationTravelerPayloadInput,
} from './hospitality-supplier-reservation-traveler-authority.ts';
import { buildTravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';

async function requireSupplierReservationReviewAuthority(input: {
  organizationId: string;
  actorUserId: string;
}) {
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

export async function reviewHospitalitySupplierReservationAuthority(input: {
  organizationId: string;
  actorUserId: string;
  selection: HospitalitySupplierReservationAuthorityInput;
}) {
  await requireSupplierReservationReviewAuthority(input);
  const { reservationAuthorityProvider } = await loadTravelportStaysIntegration(input.organizationId);
  const review = await reservationAuthorityProvider.verifyReservationAuthority(input.selection);
  return Object.freeze({
    status: review.status,
    offer: review.offer,
    bookingTerms: review.bookingTerms,
    authorityFingerprint: review.authorityFingerprint,
    observedAt: review.observedAt,
    revalidationRequired: review.revalidationRequired,
  });
}

export async function prepareHospitalitySupplierReservationWithTravelerAuthority(input: {
  organizationId: string;
  actorUserId: string;
  integrationId: string;
  idempotencyKey: unknown;
  selection: Omit<HospitalitySupplierReservationSelectionInput, 'reservationPayloadFingerprint'>;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
}) {
  await requireSupplierReservationReviewAuthority(input);
  const traveler = normalizeHospitalitySupplierReservationTravelerPayload(input.traveler);
  const reservationPayloadFingerprint = hospitalitySupplierReservationTravelerPayloadFingerprint(traveler);

  return prepareHospitalitySupplierReservation({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    integrationId: input.integrationId,
    idempotencyKey: input.idempotencyKey,
    selection: {
      ...input.selection,
      reservationPayloadFingerprint,
    },
  });
}

export async function reviewAndClaimHospitalitySupplierReservationSubmission(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
}) {
  await requireSupplierReservationReviewAuthority(input);
  assertUuidIdentifier(input.reservationId, 'reservationId');

  const reservation = await db.hospitalitySupplierReservationOperation.findFirst({
    where: {
      id: input.reservationId,
      organizationId: input.organizationId,
    },
  });
  if (!reservation) {
    throw new HospitalitySupplierReservationUnavailableError(
      'Supplier reservation operation is not available in this organization.',
    );
  }
  assertHospitalitySupplierReservationCanSubmit(reservation);
  if (reservation.providerCode !== 'travelport-stays') {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation provider does not support the current submission authority workflow.',
    );
  }
  if (reservation.rooms !== 1) {
    throw new HospitalitySupplierReservationConflictError(
      'The current supplier reservation submission workflow supports exactly one room.',
    );
  }

  let travelerAuthority;
  try {
    travelerAuthority = assertHospitalitySupplierReservationTravelerPayloadAuthority({
      expectedFingerprint: reservation.reservationPayloadFingerprint,
      traveler: input.traveler,
    });
  } catch {
    throw new HospitalitySupplierReservationConflictError(
      'Primary traveler details changed after the supplier reservation request was prepared. Review the traveler details again.',
    );
  }

  const authorityInput = hospitalitySupplierReservationAuthorityInputFromOperation(reservation);
  const { integration, reservationAuthorityProvider } = await loadTravelportStaysIntegration(input.organizationId);
  if (
    integration.id !== reservation.integrationId
    || integration.providerCode !== reservation.providerCode
    || integration.credentialVersion !== reservation.integrationCredentialVersion
    || !integration.capabilities.includes('reservation')
  ) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier integration changed after the reservation request was prepared. Review the supplier offer and terms again.',
    );
  }

  const review = await reservationAuthorityProvider.verifyReservationAuthority(authorityInput);
  const submissionAuthority = assertHospitalitySupplierReservationSubmissionAuthority(reservation, review);
  let createRequestMaterial;
  try {
    createRequestMaterial = buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: submissionAuthority.providerSubmissionReference,
      traveler: travelerAuthority,
      paymentAuthority: submissionAuthority.paymentAuthority,
    });
  } catch (error) {
    if (!(error instanceof HospitalitySupplierProviderError)) throw error;
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation traveler or payment authority cannot be submitted to Travelport. Review the traveler and supplier terms again.',
    );
  }

  const claim = await claimHospitalitySupplierReservationSubmission({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
  });
  return Object.freeze({ claim, submissionAuthority, travelerAuthority, createRequestMaterial });
}
