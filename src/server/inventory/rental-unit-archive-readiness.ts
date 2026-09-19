import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryDependencyError,
} from './rental-service.ts';

type RentalUnitArchiveReadiness = Readonly<{
  pendingReturnInspection: boolean;
  activeMaintenance: boolean;
  unresolvedDamageCase: boolean;
  unresolvedNonClearInspection: boolean;
}>;

export async function assertRentalUnitArchiveOperationalReadiness(input: Readonly<{
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

  const [readiness] = await db.$queryRaw<RentalUnitArchiveReadiness[]>`
    SELECT
      EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" return_event
         WHERE return_event."organizationId" = ${input.organizationId}::uuid
           AND return_event."unitId" = ${input.unitId}::uuid
           AND return_event."kind" = 'RETURNED'
           AND NOT EXISTS (
             SELECT 1
               FROM "rental_return_inspections" inspection
              WHERE inspection."organizationId" = return_event."organizationId"
                AND inspection."returnEventId" = return_event."id"
                AND inspection."unitId" = return_event."unitId"
           )
      ) AS "pendingReturnInspection",
      EXISTS (
        SELECT 1
          FROM "rental_maintenance_work_orders" work_order
         WHERE work_order."organizationId" = ${input.organizationId}::uuid
           AND work_order."unitId" = ${input.unitId}::uuid
           AND work_order."status" IN ('OPEN', 'IN_PROGRESS')
      ) AS "activeMaintenance",
      EXISTS (
        SELECT 1
          FROM "rental_damage_cases" damage_case
         WHERE damage_case."organizationId" = ${input.organizationId}::uuid
           AND damage_case."unitId" = ${input.unitId}::uuid
           AND damage_case."status" IN ('OPEN', 'ASSESSED')
      ) AS "unresolvedDamageCase",
      EXISTS (
        SELECT 1
          FROM "rental_return_inspections" inspection
         WHERE inspection."organizationId" = ${input.organizationId}::uuid
           AND inspection."unitId" = ${input.unitId}::uuid
           AND inspection."outcome" IN ('DAMAGE_REPORTED', 'UNSAFE')
           AND NOT EXISTS (
             SELECT 1
               FROM "rental_damage_cases" damage_case
              WHERE damage_case."organizationId" = inspection."organizationId"
                AND damage_case."inspectionId" = inspection."id"
                AND damage_case."unitId" = inspection."unitId"
                AND damage_case."status" IN ('WAIVED', 'CLOSED')
           )
      ) AS "unresolvedNonClearInspection"
  `;

  if (!readiness) {
    throw new RentalInventoryConflictError(
      'Rental unit archive readiness could not be verified.',
    );
  }
  if (readiness.pendingReturnInspection) {
    throw new RentalInventoryConflictError(
      'Record the pending rental return inspection before archiving this rental unit.',
    );
  }
  if (readiness.activeMaintenance) {
    throw new RentalInventoryDependencyError(
      'Complete or cancel active rental maintenance before archiving this rental unit.',
    );
  }
  if (readiness.unresolvedNonClearInspection) {
    throw new RentalInventoryDependencyError(
      'Resolve non-clear rental return inspection evidence before archiving this rental unit.',
    );
  }
  if (readiness.unresolvedDamageCase) {
    throw new RentalInventoryDependencyError(
      'Waive or close the unresolved rental damage case before archiving this rental unit.',
    );
  }
}
