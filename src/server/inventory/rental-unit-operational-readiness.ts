import type { Prisma } from '../../generated/prisma/client.ts';

export type RentalUnitOperationalReadinessBlocker =
  | 'OUT_OF_SERVICE'
  | 'PENDING_RETURN_INSPECTION'
  | 'UNRESOLVED_NON_CLEAR_INSPECTION';

export function rentalUnitOperationalReadinessWhere(organizationId: string): Prisma.RentalUnitWhereInput {
  return {
    AND: [
      {
        OR: [
          { operationalState: { is: null } },
          { operationalState: { is: { status: 'AVAILABLE' } } },
        ],
      },
      {
        fulfillmentEvents: {
          none: {
            organizationId,
            kind: 'RETURNED',
            returnInspection: { is: null },
          },
        },
      },
      {
        returnInspections: {
          none: {
            organizationId,
            outcome: { in: ['DAMAGE_REPORTED', 'UNSAFE'] },
            OR: [
              { damageCase: { is: null } },
              {
                damageCase: {
                  is: {
                    status: { in: ['OPEN', 'ASSESSED'] },
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
}

export async function findRentalUnitOperationalReadinessBlocker(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    organizationId: string;
    unitId: string;
  }>,
): Promise<RentalUnitOperationalReadinessBlocker | null> {
  const [operationalState, pendingReturnInspection, unresolvedNonClearInspection] = await Promise.all([
    transaction.rentalUnitOperationalState.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: input.unitId,
        status: 'OUT_OF_SERVICE',
      },
      select: { id: true },
    }),
    transaction.rentalBookingFulfillmentEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: input.unitId,
        kind: 'RETURNED',
        returnInspection: { is: null },
      },
      select: { id: true },
    }),
    transaction.rentalReturnInspection.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: input.unitId,
        outcome: { in: ['DAMAGE_REPORTED', 'UNSAFE'] },
        OR: [
          { damageCase: { is: null } },
          {
            damageCase: {
              is: {
                status: { in: ['OPEN', 'ASSESSED'] },
              },
            },
          },
        ],
      },
      select: { id: true },
    }),
  ]);

  if (operationalState) return 'OUT_OF_SERVICE';
  if (pendingReturnInspection) return 'PENDING_RETURN_INSPECTION';
  if (unresolvedNonClearInspection) return 'UNRESOLVED_NON_CLEAR_INSPECTION';
  return null;
}
