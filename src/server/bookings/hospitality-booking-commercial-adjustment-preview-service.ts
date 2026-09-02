import { formatAvailabilityDate } from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { moneyMinorToMajorString } from '../pricing/money.ts';
import { quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  createHospitalityBookingCommercialAdjustmentPreview,
  type HospitalityBookingCommercialPriceSnapshot,
} from './booking-commercial-adjustment-domain.ts';
import {
  hospitalityBookingCommercialModificationFingerprint,
  normalizeHospitalityBookingCommercialModificationInput,
  type HospitalityBookingCommercialModificationInput,
} from './booking-commercial-modification-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

function displayMinor(amountMinor: string, currency: string) {
  return `${currency} ${moneyMinorToMajorString(BigInt(amountMinor), currency)}`;
}

function displaySignedMinor(amountMinor: string, currency: string) {
  const amount = BigInt(amountMinor);
  const absolute = amount < 0n ? -amount : amount;
  const sign = amount > 0n ? '+' : amount < 0n ? '-' : '';
  return `${sign}${currency} ${moneyMinorToMajorString(absolute, currency)}`;
}

export async function previewHospitalityBookingCommercialAdjustment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  change: HospitalityBookingCommercialModificationInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });

  const change = normalizeHospitalityBookingCommercialModificationInput(input.change);
  const selectionFingerprint = hospitalityBookingCommercialModificationFingerprint(change);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      include: { allocation: true, _count: { select: { guests: true } } },
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (booking.status !== 'CONFIRMED' || !booking.allocation) {
      throw new HospitalityBookingConflictError(
        'Only confirmed bookings with an active allocation can be reviewed for commercial changes.',
      );
    }

    const activePayment = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        status: { in: ['PENDING', 'AMBIGUOUS'] },
      },
      select: { id: true },
    });
    if (activePayment) {
      throw new HospitalityBookingConflictError(
        'Booking has an unresolved payment operation. Resolve the payment attempt before reviewing commercial terms.',
      );
    }

    const assignment = await transaction.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: booking.propertyId,
        roomTypeId: change.roomTypeId,
        ratePlanId: change.ratePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
      },
      select: { roomType: { select: { maxOccupancy: true } } },
    });
    if (!assignment) {
      throw new HospitalityBookingUnavailableError(
        'The requested room type and rate plan are no longer active and assigned.',
      );
    }
    if (booking._count.guests > change.quantity * assignment.roomType.maxOccupancy) {
      throw new HospitalityBookingConflictError(
        'The current traveler count exceeds the requested room quantity and room-type occupancy.',
      );
    }

    const latestPrice = await quoteHospitalityPriceFromReader({
      reader: transaction,
      organizationId: input.organizationId,
      request: {
        propertyId: booking.propertyId,
        roomTypeId: change.roomTypeId,
        ratePlanId: change.ratePlanId,
        arrivalDate: formatAvailabilityDate(booking.arrivalDate),
        departureDate: formatAvailabilityDate(booking.departureDate),
        quantity: change.quantity,
      },
      addonSelections: change.addonSelections,
    });

    const before: HospitalityBookingCommercialPriceSnapshot = {
      currency: booking.currency,
      accommodationSubtotalMinor: booking.accommodationSubtotalMinor.toString(),
      taxTotalMinor: booking.taxTotalMinor.toString(),
      feeTotalMinor: booking.feeTotalMinor.toString(),
      addonTotalMinor: booking.addonTotalMinor.toString(),
      totalMinor: booking.totalMinor.toString(),
      pricingFingerprint: booking.pricingFingerprint,
    };
    const after: HospitalityBookingCommercialPriceSnapshot = {
      currency: latestPrice.currency,
      accommodationSubtotalMinor: latestPrice.accommodationSubtotalMinor,
      taxTotalMinor: latestPrice.taxTotalMinor,
      feeTotalMinor: latestPrice.feeTotalMinor,
      addonTotalMinor: latestPrice.addonTotalMinor,
      totalMinor: latestPrice.totalMinor,
      pricingFingerprint: latestPrice.fingerprint,
    };
    const preview = createHospitalityBookingCommercialAdjustmentPreview({
      bookingId: booking.id,
      bookingVersion: booking.updatedAt.toISOString(),
      selectionFingerprint,
      before,
      after,
    });

    return {
      ...preview,
      currentTotalDisplay: displayMinor(preview.before.totalMinor, preview.currency),
      proposedTotalDisplay: displayMinor(preview.after.totalMinor, preview.currency),
      adjustmentDisplay: displaySignedMinor(preview.deltaMinor, preview.currency),
      componentDeltaDisplays: {
        accommodationSubtotal: displaySignedMinor(preview.componentDeltas.accommodationSubtotalMinor, preview.currency),
        taxes: displaySignedMinor(preview.componentDeltas.taxTotalMinor, preview.currency),
        fees: displaySignedMinor(preview.componentDeltas.feeTotalMinor, preview.currency),
        addons: displaySignedMinor(preview.componentDeltas.addonTotalMinor, preview.currency),
      },
    };
  }, { isolationLevel: 'Serializable' });
}
