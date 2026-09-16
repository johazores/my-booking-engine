import { isDeepStrictEqual } from 'node:util';

import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalPricingEvidence,
  RentalAvailabilityIntegrityError,
} from '../inventory/rental-availability-domain.ts';
import { findOverdueRentalCustodyUnitIds } from '../inventory/rental-custody-availability.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { RentalInventoryUnavailableError } from '../inventory/rental-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { buildRentalBookingConversionAuthorityFingerprint } from './rental-booking-authority-domain.ts';
import {
  normalizeRentalBookingConfirmationInput,
  rentalBookingConfirmationPayloadMatches,
  type RentalBookingConfirmationInput,
} from './rental-booking-domain.ts';
import { classifyRentalBookingWriteError } from './rental-booking-write-errors.ts';

export class RentalBookingConflictError extends Error {}

function bookingIdempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `sf:rental-booking:${organizationId}:idempotency:${idempotencyKey}`;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hasCompletePricingEvidence(hold: Readonly<{
  quotedCurrency: string | null;
  quotedTotalMinor: bigint | null;
  pricingFingerprint: string | null;
  pricingSnapshot: Prisma.JsonValue | null;
  pricingObservedAt: Date | null;
}>) {
  const fields = [hold.quotedCurrency, hold.quotedTotalMinor, hold.pricingFingerprint, hold.pricingSnapshot, hold.pricingObservedAt];
  const present = fields.filter((value) => value !== null).length;
  if (present !== 0 && present !== fields.length) {
    throw new RentalAvailabilityIntegrityError('Rental hold pricing evidence is incomplete.');
  }
  return present === fields.length;
}

async function runRentalBookingWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalBookingConflictError(
          'Rental booking write could not be serialized after bounded retries.',
        );
      }
      if (disposition === 'CONFLICT') {
        throw new RentalBookingConflictError(
          'Rental booking write no longer satisfies the durable inventory or lifecycle contract.',
        );
      }
      throw error;
    }
  }
  throw new RentalBookingConflictError('Rental booking write could not be serialized.');
}

export async function confirmRentalBookingFromHold(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  confirmation: RentalBookingConfirmationInput;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  const confirmation = normalizeRentalBookingConfirmationInput(input.confirmation);
  assertUuidIdentifier(confirmation.holdId, 'holdId');
  assertUuidIdentifier(confirmation.customerId, 'customerId');

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'availability:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'inventory:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'customer:read' }),
  ]);

  return runRentalBookingWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${bookingIdempotencyLockKey(input.organizationId, confirmation.idempotencyKey)}, 0)
      )
    `;

    const existing = await transaction.rentalBooking.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: confirmation.idempotencyKey } },
      include: {
        allocation: true,
        hold: {
          select: {
            id: true,
            organizationId: true,
            unitId: true,
            startsOn: true,
            endsOn: true,
            status: true,
            expiresAt: true,
            endedAt: true,
            quotedCurrency: true,
            quotedTotalMinor: true,
            pricingFingerprint: true,
            pricingSnapshot: true,
            pricingObservedAt: true,
          },
        },
      },
    });
    if (existing) {
      if (!rentalBookingConfirmationPayloadMatches({ booking: existing, requested: confirmation })) {
        throw new RentalBookingConflictError('That rental booking idempotency key was already used for a different hold, customer, or authority review.');
      }
      if (!existing.allocation) throw new RentalAvailabilityIntegrityError('Rental booking is missing its physical-unit allocation.');

      const sourceHold = existing.hold;
      const sourceHoldMatchesBooking = sourceHold.id === existing.holdId
        && sourceHold.organizationId === existing.organizationId
        && sourceHold.status === 'CONSUMED'
        && sourceHold.endedAt !== null
        && sourceHold.unitId === existing.unitId
        && sourceHold.startsOn.getTime() === existing.startsOn.getTime()
        && sourceHold.endsOn.getTime() === existing.endsOn.getTime()
        && sourceHold.quotedCurrency === existing.currency
        && sourceHold.quotedTotalMinor === existing.totalMinor
        && sourceHold.pricingFingerprint === existing.pricingFingerprint
        && isDeepStrictEqual(sourceHold.pricingSnapshot, existing.pricingSnapshot);
      if (!hasCompletePricingEvidence(sourceHold) || !sourceHoldMatchesBooking) {
        throw new RentalAvailabilityIntegrityError(
          'Rental booking replay source-hold evidence no longer matches the retained booking.',
        );
      }

      const expectedAuthorityFingerprint = buildRentalBookingConversionAuthorityFingerprint({
        organizationId: existing.organizationId,
        holdId: existing.holdId,
        customerId: existing.customerId,
        unitId: existing.unitId,
        unitTypeId: existing.unitTypeId,
        locationId: existing.locationId,
        startsOn: existing.startsOn,
        endsOn: existing.endsOn,
        holdExpiresAt: sourceHold.expiresAt,
        currency: existing.currency,
        totalMinor: existing.totalMinor,
        pricingFingerprint: existing.pricingFingerprint,
      });
      if (existing.authorityFingerprint !== expectedAuthorityFingerprint) {
        throw new RentalAvailabilityIntegrityError(
          'Rental booking replay authority no longer matches its retained source evidence.',
        );
      }

      return Object.freeze({ booking: existing, allocation: existing.allocation, idempotent: true });
    }

    const holdLocator = await transaction.rentalAvailabilityHold.findFirst({
      where: { id: confirmation.holdId, organizationId: input.organizationId },
      select: { unitId: true },
    });
    if (!holdLocator) throw new RentalInventoryUnavailableError('Rental availability hold is not available in this organization.');

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, holdLocator.unitId)}, 0)
      )
    `;

    const [databaseClock] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    if (!databaseClock?.now) throw new RentalAvailabilityIntegrityError('Database clock is unavailable for rental booking confirmation.');

    const previouslyConverted = await transaction.rentalBooking.findFirst({
      where: { organizationId: input.organizationId, holdId: confirmation.holdId },
      select: { id: true },
    });
    if (previouslyConverted) throw new RentalBookingConflictError('That rental hold has already been converted into a booking.');

    const [hold, customer] = await Promise.all([
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          id: confirmation.holdId,
          organizationId: input.organizationId,
          unitId: holdLocator.unitId,
          status: 'ACTIVE',
          expiresAt: { gt: databaseClock.now },
        },
        include: {
          unit: {
            select: {
              id: true,
              status: true,
              unitTypeId: true,
              locationId: true,
              unitType: { select: { id: true, status: true, currency: true, defaultDailyRateMinor: true } },
              location: { select: { id: true, status: true } },
            },
          },
        },
      }),
      transaction.customer.findFirst({
        where: { id: confirmation.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      }),
    ]);
    if (!hold) throw new RentalInventoryUnavailableError('Rental availability hold is no longer active in this organization.');
    if (!customer) throw new RentalInventoryUnavailableError('Rental booking customer is not active in this organization.');
    if (
      hold.unit.status !== 'ACTIVE'
      || hold.unit.unitType.status !== 'ACTIVE'
      || !hold.unit.location
      || hold.unit.location.status !== 'ACTIVE'
      || hold.unit.unitTypeId !== hold.unit.unitType.id
      || hold.unit.locationId !== hold.unit.location.id
    ) {
      throw new RentalBookingConflictError('The held rental unit is no longer active at its original operating location.');
    }

    const [blockOverlap, competingHold, bookingOverlap, overdueCustodyUnitIds, ratePeriods] = await Promise.all([
      transaction.rentalAvailabilityBlock.findFirst({
        where: { organizationId: input.organizationId, unitId: hold.unitId, startsOn: { lt: hold.endsOn }, endsOn: { gt: hold.startsOn } },
        select: { id: true },
      }),
      transaction.rentalAvailabilityHold.findFirst({
        where: {
          organizationId: input.organizationId,
          unitId: hold.unitId,
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
          unitId: hold.unitId,
          startsOn: { lt: hold.endsOn },
          endsOn: { gt: hold.startsOn },
          booking: { is: { organizationId: input.organizationId, status: { not: 'CANCELLED' } } },
        },
        select: { id: true },
      }),
      findOverdueRentalCustodyUnitIds(transaction, {
        organizationId: input.organizationId,
        observedAt: databaseClock.now,
        unitId: hold.unitId,
      }),
      transaction.rentalRatePeriod.findMany({
        where: { organizationId: input.organizationId, unitTypeId: hold.unit.unitType.id, startsOn: { lt: hold.endsOn }, endsOn: { gt: hold.startsOn } },
        orderBy: [{ startsOn: 'asc' }, { id: 'asc' }],
        select: { startsOn: true, endsOn: true, dailyRateMinor: true },
      }),
    ]);
    if (blockOverlap || competingHold || bookingOverlap || overdueCustodyUnitIds.length > 0) {
      throw new RentalBookingConflictError('The held rental unit now conflicts with another inventory commitment or overdue open custody.');
    }
    if (!hasCompletePricingEvidence(hold)) {
      throw new RentalBookingConflictError('Legacy rental holds without complete pricing evidence cannot be converted into bookings.');
    }

    const currentPricing = buildRentalPricingEvidence({
      unitTypeId: hold.unit.unitType.id,
      currency: hold.unit.unitType.currency,
      startsOn: hold.startsOn,
      endsOn: hold.endsOn,
      defaultDailyRateMinor: hold.unit.unitType.defaultDailyRateMinor,
      ratePeriods,
    });
    const quotedCurrency = hold.quotedCurrency as string;
    const quotedTotalMinor = hold.quotedTotalMinor as bigint;
    const quotedFingerprint = hold.pricingFingerprint as string;
    if (quotedCurrency !== currentPricing.currency || quotedTotalMinor !== BigInt(currentPricing.totalMinor) || quotedFingerprint !== currentPricing.fingerprint) {
      throw new RentalBookingConflictError('Rental pricing changed after the hold was created. Review current pricing before confirming.');
    }

    const expectedAuthorityFingerprint = buildRentalBookingConversionAuthorityFingerprint({
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
    });
    if (confirmation.authorityFingerprint !== expectedAuthorityFingerprint) {
      throw new RentalBookingConflictError('Rental booking authority changed. Review the hold and customer again before confirming.');
    }

    const consumed = await transaction.rentalAvailabilityHold.updateMany({
      where: {
        id: hold.id,
        organizationId: input.organizationId,
        unitId: hold.unitId,
        status: 'ACTIVE',
        startsOn: hold.startsOn,
        endsOn: hold.endsOn,
        expiresAt: hold.expiresAt,
        idempotencyKey: hold.idempotencyKey,
        quotedCurrency,
        quotedTotalMinor,
        pricingFingerprint: quotedFingerprint,
      },
      data: { status: 'CONSUMED', endedAt: databaseClock.now },
    });
    if (consumed.count !== 1) throw new RentalBookingConflictError('Rental hold changed before booking confirmation could consume it.');

    const booking = await transaction.rentalBooking.create({
      data: {
        organizationId: input.organizationId,
        customerId: customer.id,
        customerFirstName: customer.firstName,
        customerLastName: customer.lastName,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        holdId: hold.id,
        unitId: hold.unit.id,
        unitTypeId: hold.unit.unitType.id,
        locationId: hold.unit.location.id,
        idempotencyKey: confirmation.idempotencyKey,
        status: 'CONFIRMED',
        startsOn: hold.startsOn,
        endsOn: hold.endsOn,
        currency: currentPricing.currency,
        totalMinor: BigInt(currentPricing.totalMinor),
        pricingFingerprint: currentPricing.fingerprint,
        pricingSnapshot: toJsonInput(currentPricing.snapshot),
        pricingObservedAt: databaseClock.now,
        authorityFingerprint: expectedAuthorityFingerprint,
        confirmedAt: databaseClock.now,
      },
    });
    const allocation = await transaction.rentalBookingAllocation.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        unitId: hold.unit.id,
        startsOn: hold.startsOn,
        endsOn: hold.endsOn,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.confirmed',
        resourceType: 'rental-booking',
        resourceId: booking.id,
        afterData: {
          customerId: customer.id,
          holdId: hold.id,
          unitId: hold.unit.id,
          unitTypeId: hold.unit.unitType.id,
          locationId: hold.unit.location.id,
          startsOn: hold.startsOn.toISOString(),
          endsOn: hold.endsOn.toISOString(),
          currency: currentPricing.currency,
          totalMinor: BigInt(currentPricing.totalMinor).toString(),
          pricingFingerprint: currentPricing.fingerprint,
          authorityFingerprint: expectedAuthorityFingerprint,
        },
      },
    });

    return Object.freeze({ booking, allocation, idempotent: false });
  }, { isolationLevel: 'Serializable' }));
}
