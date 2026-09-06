import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  HospitalitySupplierReservationConflictError,
  assertHospitalitySupplierReservationCanSubmit,
} from './hospitality-supplier-reservation-domain.ts';
import type { HospitalitySupplierReservationAuthorityInput } from './hospitality-supplier-reservation-authority.ts';
import {
  assertHospitalitySupplierReservationSubmissionAuthority,
  hospitalitySupplierReservationAuthorityInputFromOperation,
} from './hospitality-supplier-reservation-submission-authority.ts';
import {
  claimHospitalitySupplierReservationSubmission,
  HospitalitySupplierReservationUnavailableError,
} from './hospitality-supplier-reservation-service.ts';

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
  return reservationAuthorityProvider.verifyReservationAuthority(input.selection);
}

export async function reviewAndClaimHospitalitySupplierReservationSubmission(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
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
  assertHospitalitySupplierReservationSubmissionAuthority(reservation, review);

  return claimHospitalitySupplierReservationSubmission({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
  });
}
