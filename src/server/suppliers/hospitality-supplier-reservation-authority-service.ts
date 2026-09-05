import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import type { HospitalitySupplierReservationAuthorityInput } from './hospitality-supplier-reservation-authority.ts';

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
