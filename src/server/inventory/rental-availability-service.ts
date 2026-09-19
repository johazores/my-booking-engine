import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalPricingEvidence,
  normalizeRentalAvailabilitySearchInput,
  RentalAvailabilityIntegrityError,
  type RentalAvailabilitySearchInput,
} from './rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from './rental-custody-availability.ts';
import { RentalInventoryUnavailableError } from './rental-service.ts';

export async function searchRentalInventoryAvailability(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  search: RentalAvailabilitySearchInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'inventory:read',
  });

  const search = normalizeRentalAvailabilitySearchInput(input.search);
  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError('Database time authority is unavailable.');
    }

    const unitType = await transaction.rentalUnitType.findFirst({
      where: {
        organizationId: input.organizationId,
        code: search.unitTypeCode,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        name: true,
        code: true,
        currency: true,
        defaultDailyRateMinor: true,
      },
    });
    if (!unitType) {
      throw new RentalInventoryUnavailableError('Rental unit type is not active in this organization.');
    }

    const location = search.locationCode
      ? await transaction.rentalLocation.findFirst({
          where: {
            organizationId: input.organizationId,
            code: search.locationCode,
            status: 'ACTIVE',
          },
          select: { id: true, name: true, code: true, timeZone: true },
        })
      : null;
    if (search.locationCode && !location) {
      throw new RentalInventoryUnavailableError('Rental location is not active in this organization.');
    }

    const overdueCustodyUnitIds = await findOverdueRentalCustodyUnitIds(transaction, {
      organizationId: input.organizationId,
      observedAt: databaseClock.now,
      unitTypeId: unitType.id,
      ...(location ? { locationId: location.id } : {}),
    });

    const unitWhere = {
      organizationId: input.organizationId,
      unitTypeId: unitType.id,
      status: 'ACTIVE' as const,
      ...(overdueCustodyUnitIds.length > 0 ? { id: { notIn: overdueCustodyUnitIds } } : {}),
      ...(location
        ? { locationId: location.id }
        : {
            location: {
              is: {
                organizationId: input.organizationId,
                status: 'ACTIVE' as const,
              },
            },
          }),
      OR: [
        { operationalState: { is: null } },
        { operationalState: { is: { status: 'AVAILABLE' as const } } },
      ],
      fulfillmentEvents: {
        none: {
          organizationId: input.organizationId,
          kind: 'RETURNED' as const,
          returnInspection: { is: null },
        },
      },
      returnInspections: {
        none: {
          organizationId: input.organizationId,
          outcome: { in: ['DAMAGE_REPORTED' as const, 'UNSAFE' as const] },
          OR: [
            { damageCase: { is: null } },
            {
              damageCase: {
                is: {
                  status: { in: ['OPEN' as const, 'ASSESSED' as const] },
                },
              },
            },
          ],
        },
      },
      availabilityBlocks: {
        none: {
          organizationId: input.organizationId,
          startsOn: { lt: search.endsOn },
          endsOn: { gt: search.startsOn },
        },
      },
      availabilityHolds: {
        none: {
          organizationId: input.organizationId,
          status: 'ACTIVE' as const,
          expiresAt: { gt: databaseClock.now },
          startsOn: { lt: search.endsOn },
          endsOn: { gt: search.startsOn },
        },
      },
      bookingAllocations: {
        none: {
          organizationId: input.organizationId,
          startsOn: { lt: search.endsOn },
          endsOn: { gt: search.startsOn },
          booking: {
            is: {
              organizationId: input.organizationId,
              status: { not: 'CANCELLED' as const },
            },
          },
        },
      },
    };

    const [total, units, ratePeriods] = await Promise.all([
      transaction.rentalUnit.count({ where: unitWhere }),
      transaction.rentalUnit.findMany({
        where: unitWhere,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          code: true,
          location: { select: { id: true, name: true, code: true, timeZone: true } },
        },
        skip: (search.page - 1) * search.pageSize,
        take: search.pageSize,
      }),
      transaction.rentalRatePeriod.findMany({
        where: {
          organizationId: input.organizationId,
          unitTypeId: unitType.id,
          startsOn: { lt: search.endsOn },
          endsOn: { gt: search.startsOn },
        },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: { startsOn: true, endsOn: true, dailyRateMinor: true },
      }),
    ]);

    const pricingEvidence = buildRentalPricingEvidence({
      unitTypeId: unitType.id,
      currency: unitType.currency,
      startsOn: search.startsOn,
      endsOn: search.endsOn,
      defaultDailyRateMinor: unitType.defaultDailyRateMinor,
      ratePeriods,
    });

    return Object.freeze({
      search,
      unitType,
      location,
      availability: Object.freeze({
        items: Object.freeze(units),
        total,
        page: search.page,
        pageSize: search.pageSize,
        totalPages: Math.max(1, Math.ceil(total / search.pageSize)),
      }),
      pricing: Object.freeze({
        ...pricingEvidence.quote,
        fingerprint: pricingEvidence.fingerprint,
      }),
    });
  }, { isolationLevel: 'Serializable' });
}
