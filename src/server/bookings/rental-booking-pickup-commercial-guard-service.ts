import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';

export async function readRentalBookingPickupCommercialGuard(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:read',
  });

  const prepared = await db.rentalBookingCommercialAmendment.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      status: 'PREPARED',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      mode: true,
      expiresAt: true,
    },
  });

  return Object.freeze({
    blocked: Boolean(prepared),
    amendmentId: prepared?.id ?? null,
    mode: prepared?.mode ?? null,
    expiresAt: prepared?.expiresAt ?? null,
  });
}
