import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from '../inventory/rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from '../inventory/rental-custody-availability.ts';
import { RentalInventoryUnavailableError } from '../inventory/rental-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { buildRentalBookingConversionAuthorityFingerprint } from './rental-booking-authority-domain.ts';

type RentalBookingConversionBlocker =
  | 'LEGACY_PRICING_EVIDENCE'
  | 'PRICE_CHANGED'
  | 'INVENTORY_CONFLICT';

function hasCompletePricingEvidence(hold: Readonly<{
  quotedCurrency: string | null;
  quotedTotalMinor: bigint | null;
  pricingFingerprint: string | null;
  pricingSnapshot: Prisma.JsonValue | null;
  pricingObservedAt: Date | null;
}>) {
  const fields = [
    hold.quotedCurrency,
    hold.quotedTotalMinor,
    hold.pricingFingerprint,
    hold.pricingSnapshot,
    hold.pricingObservedAt,
  ];
  const present = fields.filter((value) => value !== null).length;
  if (present !== 0 && present !== fields.length) {
    throw new RentalAvailabilityIntegrityError('Rental hold pricing evidence is incomplete.');
  }
  return present === fields.length;
}

export async function reviewRentalBookingConversionAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  holdId: string;
  customerId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.holdId, 'holdId');
  assertUuidIdentifier(input.customerId, 'customerId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'customer:read' }),
  ]);

  return db.$transaction(async (transaction) => {
    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    if (!databaseClock?.now) {
      throw new RentalAvailabilityIntegrityError('Database time authority is unavailable.');
    }

    const [hold, customer] = await Promise.all([
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          id: input.holdId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          expiresAt: { gt: databaseClock.now },
        },
        include: {
          unit: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              locationId: true,
              unitType: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  status: true,
                  currency: true,
                  defaultDailyRateMinor: true,
                },
              },
              location: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  status: true,
                },
              },
            },
          },
        },
      }),
      transaction.customer.findFirst({
        where: {
          id: input.customerId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      }),
    ]);

    if (!hold) {
      throw new RentalInventoryUnavailableError('Rental availability hold is not active in this organization.');
    }
    if (!customer) {
      throw new RentalInventoryUnavailableError('Rental booking customer is not active in this organization.');
    }
    if (
      hold.unit.status !== 'ACTIVE'
      || hold.unit.unitType.status !== 'ACTIVE'
      || !hold.unit.location
      || hold.unit.location.status !== 'ACTIVE'
      || hold.unit.locationId !== hold.unit.location.id
    ) {
      throw new RentalInventoryUnavailableError('Rental unit, unit type, or operating location is no longer active.');
    }

    const [ratePeriods, blockOverlap, competingHold, bookingOverlap, overdueCustodyUnitIds] = await Promise.all([
      transaction.rentalRatePeriod.findMany({
        where: {
          organizationId: input.organizationId,
          unitTypeId: hold.unit.unitType.id,
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
        },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: { startsOn: true, endsOn: true, dailyRateMinor: true },
      }),
      transaction.rentalAvailabilityBlock.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: hold.unit.id,
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: hold.unit.id,
          id: { not: hold.id },
          status: 'ACTIVE',
          expiresAt: { gt: databaseClock.now },
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
        },
        select: { id: true },
      }),
      transaction.rentalBookingAllocation.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: hold.unit.id,
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
          booking: {
            is: {
              organizationId: input.organizationId,
              status: { not: 'CANCELLED' },
            },
          },
        },
        select: { id: true },
      }),
      findOverdueRentalCustodyUnitIds(transaction, {
        organizationId: input.organizationId,
        observedAt: databaseClock.now,
        unitId: hold.unit.id,
      }),
    ]);

    const currentPricing = buildRentalPricingEvidence({
      unitTypeId: hold.unit.unitType.id,
      currency: hold.unit.unitType.currency,
      startsOn: hold.startsOn,
      endsOn: hold.endsOn,
      defaultDailyRateMinor: hold.unit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    const completePricingEvidence = hasCompletePricingEvidence(hold);

    let blocker: RentalBookingConversionBlocker | null = null;
    if (blockOverlap || competingHold || bookingOverlap || overdueCustodyUnitIds.length > 0) {
      blocker = 'INVENTORY_CONFLICT';
    } else if (!completePricingEvidence) {
      blocker = 'LEGACY_PRICING_EVIDENCE';
    } else if (
      hold.pricingFingerprint !== currentPricing.fingerprint
      || hold.quotedCurrency !== currentPricing.currency
      || hold.quotedTotalMinor !== BigInt(currentPricing.totalMinor)
    ) {
      blocker = 'PRICE_CHANGED';
    }

    const authorityFingerprint = blocker === null
      ? buildRentalBookingConversionAuthorityFingerprint({
          organizationId: input.organizationId,
          holdId: hold.id,
          customerId: customer.id,
          unitId: hold.unit.id,
          unitTypeId: hold.unit.unitType.id,
          locationId: hold.unit.location.id,
          startsOn: hold.startsOn,
          endsOn: hold.endsOn,
          holdExpiresAt: hold.expiresAt,
          currency: currentPricing.currency,
          totalMinor: BigInt(currentPricing.totalMinor),
          pricingFingerprint: currentPricing.fingerprint,
        })
      : null;

    return Object.freeze({
      ready: blocker === null,
      blocker,
      checkedAt: databaseClock.now,
      authorityFingerprint,
      hold: Object.freeze({ id: hold.id, startsOn: hold.startsOn, endsOn: hold.endsOn, expiresAt: hold.expiresAt }),
      customer: Object.freeze(customer),
      unit: Object.freeze({
        id: hold.unit.id,
        code: hold.unit.code,
        name: hold.unit.name,
        unitType: Object.freeze({ id: hold.unit.unitType.id, code: hold.unit.unitType.code, name: hold.unit.unitType.name }),
        location: Object.freeze({ id: hold.unit.location.id, code: hold.unit.location.code, name: hold.unit.location.name }),
      }),
      currentPricing: Object.freeze({
        currency: currentPricing.currency,
        totalMinor: BigInt(currentPricing.totalMinor),
        fingerprint: currentPricing.fingerprint,
        quote: currentPricing.quote,
      }),
    });
  }, { isolationLevel: 'Serializable' });
}
