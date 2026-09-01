import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertHospitalityBookingGuestCapacity,
  hospitalityBookingGuestFingerprint,
  normalizeHospitalityBookingGuestModificationInput,
  type HospitalityBookingGuestModificationInput,
} from './booking-guest-modification-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

function readGuestAuditPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  return {
    idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : null,
    guestFingerprint: typeof payload.guestFingerprint === 'string' ? payload.guestFingerprint : null,
  };
}

export async function updateHospitalityBookingGuests(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  change: HospitalityBookingGuestModificationInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });
  const change = normalizeHospitalityBookingGuestModificationInput(input.change);
  const requestedFingerprint = hospitalityBookingGuestFingerprint(change.guests);

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: {
        id: true,
        status: true,
        quantity: true,
        roomType: { select: { maxOccupancy: true } },
      },
    });
    if (!booking) throw new HospitalityBookingUnavailableError();
    if (booking.status !== 'CONFIRMED') {
      throw new HospitalityBookingConflictError('Only confirmed bookings can update traveler snapshots.');
    }
    assertHospitalityBookingGuestCapacity({
      guests: change.guests,
      quantity: booking.quantity,
      maxOccupancy: booking.roomType.maxOccupancy,
    });

    const existingRows = await transaction.hospitalityBookingGuest.findMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
      orderBy: { position: 'asc' },
      select: { firstName: true, lastName: true, email: true },
    });
    const existingGuests = existingRows.map((guest) => ({ firstName: guest.firstName, lastName: guest.lastName, email: guest.email }));
    const existingFingerprint = hospitalityBookingGuestFingerprint(existingGuests);

    const priorAttempt = await transaction.auditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        action: 'booking.guests.updated',
        afterData: { path: ['idempotencyKey'], equals: change.idempotencyKey },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { afterData: true },
    });
    if (priorAttempt) {
      const prior = readGuestAuditPayload(priorAttempt.afterData);
      if (!prior || prior.guestFingerprint !== requestedFingerprint) {
        throw new HospitalityBookingConflictError('Idempotency key was already used for a different traveler update.');
      }
      if (existingFingerprint !== requestedFingerprint) {
        throw new HospitalityBookingConflictError('This traveler update already completed, but the booking guests changed again afterward. Refresh before retrying.');
      }
      return { guests: existingGuests, maximumGuests: booking.quantity * booking.roomType.maxOccupancy };
    }

    if (existingFingerprint === requestedFingerprint) {
      return { guests: existingGuests, maximumGuests: booking.quantity * booking.roomType.maxOccupancy };
    }

    await transaction.hospitalityBookingGuest.deleteMany({
      where: { organizationId: input.organizationId, bookingId: booking.id },
    });
    await transaction.hospitalityBookingGuest.createMany({
      data: change.guests.map((guest, position) => ({
        organizationId: input.organizationId,
        bookingId: booking.id,
        position,
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
      })),
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.guests.updated',
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        beforeData: { guestCount: existingGuests.length, guestFingerprint: existingFingerprint },
        afterData: { guestCount: change.guests.length, guestFingerprint: requestedFingerprint, idempotencyKey: change.idempotencyKey },
      },
    });

    return { guests: change.guests, maximumGuests: booking.quantity * booking.roomType.maxOccupancy };
  }, { isolationLevel: 'Serializable' });
}
