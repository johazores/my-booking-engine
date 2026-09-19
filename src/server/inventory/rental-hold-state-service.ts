import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { RentalAvailabilityIntegrityError } from './rental-availability-domain.ts';
import { RentalInventoryUnavailableError } from './rental-service.ts';

export async function readManagedRentalAvailabilityHoldState(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  holdId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.holdId, 'holdId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:manage',
  });

  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now || !Number.isFinite(databaseClock.now.getTime())) {
      throw new RentalAvailabilityIntegrityError(
        'Database time authority is unavailable for rental hold state review.',
      );
    }

    const hold = await transaction.rentalAvailabilityHold.findFirst({
      where: {
        id: input.holdId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        status: true,
        expiresAt: true,
      },
    });
    if (!hold) {
      throw new RentalInventoryUnavailableError(
        'Rental availability hold is not available in this organization.',
      );
    }

    return Object.freeze({
      hold,
      observedAt: databaseClock.now,
      effective: hold.status === 'ACTIVE' && hold.expiresAt > databaseClock.now,
    });
  }, { isolationLevel: 'RepeatableRead' });
}
