import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { RentalInventoryConflictError } from './rental-service.ts';

export async function assertRentalUnitArchiveReturnInspectionReady(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  unitId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.unitId, 'unitId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:manage',
  });

  const rows = await db.$queryRaw<Array<{ bookingId: string; returnEventId: string }>>`
    SELECT return_event."bookingId" AS "bookingId",
           return_event."id" AS "returnEventId"
      FROM "rental_booking_fulfillment_events" return_event
      LEFT JOIN "rental_return_inspections" inspection
        ON inspection."organizationId" = return_event."organizationId"
       AND inspection."returnEventId" = return_event."id"
       AND inspection."unitId" = return_event."unitId"
     WHERE return_event."organizationId" = ${input.organizationId}::uuid
       AND return_event."unitId" = ${input.unitId}::uuid
       AND return_event."kind" = 'RETURNED'
       AND inspection."id" IS NULL
     ORDER BY return_event."occurredAt" DESC, return_event."id" DESC
     LIMIT 1
  `;

  if (rows[0]) {
    throw new RentalInventoryConflictError(
      'Record the pending rental return inspection before archiving this rental unit.',
    );
  }
}
