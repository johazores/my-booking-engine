import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { formatAvailabilityDate } from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  bookingConfirmationPayloadMatches,
  createHospitalityPriceSnapshot,
  normalizeHospitalityBookingConfirmationInput,
  type HospitalityBookingConfirmationInput,
  type HospitalityBookingGuestInput,
} from './booking-domain.ts';

export class HospitalityBookingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityBookingConflictError';
  }
}

export class HospitalityBookingUnavailableError extends Error {
  constructor(message = 'Booking is not available in this organization.') {
    super(message);
    this.name = 'HospitalityBookingUnavailableError';
  }
}

export class HospitalityBookingPriceChangedError extends Error {
  constructor(message = 'The booking price changed. Refresh pricing before confirming.') {
    super(message);
    this.name = 'HospitalityBookingPriceChangedError';
  }
}

function bookingIdempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `hospitality-booking:${organizationId}:${idempotencyKey}`;
}

function normalizePagination(page: number, pageSize: number) {
  const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 25;
  return { page: safePage, pageSize: safePageSize };
}

function bookingAsConfirmationInput(booking: {
  holdId: string;
  customerId: string;
  idempotencyKey: string;
  pricingFingerprint: string;
  addonSelections: unknown;
}, guests: HospitalityBookingGuestInput[]): HospitalityBookingConfirmationInput {
  if (!Array.isArray(booking.addonSelections)) {
    throw new HospitalityBookingConflictError('Persisted booking add-on selections are invalid.');
  }
  return {
    holdId: booking.holdId,
    customerId: booking.customerId,
    idempotencyKey: booking.idempotencyKey,
    expectedPricingFingerprint: booking.pricingFingerprint,
    addonSelections: booking.addonSelections as HospitalityBookingConfirmationInput['addonSelections'],
    guests,
  };
}

async function readBookingGuests(reader: typeof db, organizationId: string, bookingId: string) {
  return reader.hospitalityBookingGuest.findMany({
    where: { organizationId, bookingId },
    orderBy: { position: 'asc' },
    select: { firstName: true, lastName: true, email: true },
  });
}

export async function confirmHospitalityBookingFromHold(input: {
  organizationId: string;
  actorUserId: string;
  confirmation: HospitalityBookingConfirmationInput;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' });

  const confirmation = normalizeHospitalityBookingConfirmationInput(input.confirmation);
  const now = input.now ?? new Date();

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bookingIdempotencyLockKey(input.organizationId, confirmation.idempotencyKey)}, 0))`;

    const existing = await transaction.hospitalityBooking.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: confirmation.idempotencyKey } },
      include: { allocation: true },
    });
    if (existing) {
      const existingGuests = await transaction.hospitalityBookingGuest.findMany({
        where: { organizationId: input.organizationId, bookingId: existing.id },
        orderBy: { position: 'asc' },
        select: { firstName: true, lastName: true, email: true },
      });
      if (!bookingConfirmationPayloadMatches(bookingAsConfirmationInput(existing, existingGuests), confirmation)) {
        throw new HospitalityBookingConflictError('Idempotency key was already used for a different booking confirmation request.');
      }
      return { ...existing, guests: existingGuests };
    }

    const initialHold = await transaction.hospitalityAvailabilityHold.findFirst({
      where: { id: confirmation.holdId, organizationId: input.organizationId },
      select: { propertyId: true, roomTypeId: true },
    });
    if (!initialHold) throw new HospitalityBookingUnavailableError('Availability hold is not available in this organization.');

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: initialHold.propertyId, roomTypeId: initialHold.roomTypeId })}, 0))`;

    const [hold, customer, holdBooking] = await Promise.all([
      transaction.hospitalityAvailabilityHold.findFirst({
        where: { id: confirmation.holdId, organizationId: input.organizationId },
      }),
      transaction.customer.findFirst({
        where: { id: confirmation.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      }),
      transaction.hospitalityBooking.findFirst({
        where: { organizationId: input.organizationId, holdId: confirmation.holdId },
        select: { id: true, idempotencyKey: true },
      }),
    ]);

    if (!hold || hold.status !== 'ACTIVE' || hold.expiresAt <= now) {
      throw new HospitalityBookingUnavailableError('Availability hold is no longer active and unexpired.');
    }
    if (!customer) throw new HospitalityBookingUnavailableError('Active customer is not available in this organization.');
    if (holdBooking) throw new HospitalityBookingConflictError('Availability hold has already been consumed by another booking request.');

    const assignment = await transaction.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: hold.propertyId,
        roomTypeId: hold.roomTypeId,
        ratePlanId: hold.ratePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE' } },
      },
      select: { roomType: { select: { maxOccupancy: true } } },
    });
    if (!assignment) throw new HospitalityBookingUnavailableError('Held room type and rate plan are no longer bookable.');
    const maxGuests = assignment.roomType.maxOccupancy * hold.quantity;
    if (confirmation.guests.length > maxGuests) {
      throw new HospitalityBookingConflictError(`This booking can contain at most ${maxGuests} guest${maxGuests === 1 ? '' : 's'} for the held room quantity.`);
    }

    const latestPrice = await quoteHospitalityPriceFromReader({
      reader: transaction,
      organizationId: input.organizationId,
      request: {
        propertyId: hold.propertyId,
        roomTypeId: hold.roomTypeId,
        ratePlanId: hold.ratePlanId,
        arrivalDate: formatAvailabilityDate(hold.arrivalDate),
        departureDate: formatAvailabilityDate(hold.departureDate),
        quantity: hold.quantity,
      },
      addonSelections: confirmation.addonSelections,
    });
    if (latestPrice.fingerprint !== confirmation.expectedPricingFingerprint) {
      throw new HospitalityBookingPriceChangedError();
    }

    const snapshot = createHospitalityPriceSnapshot({
      currency: latestPrice.currency,
      accommodationSubtotalMinor: latestPrice.accommodationSubtotalMinor,
      taxTotalMinor: latestPrice.taxTotalMinor,
      feeTotalMinor: latestPrice.feeTotalMinor,
      addonTotalMinor: latestPrice.addonTotalMinor,
      totalMinor: latestPrice.totalMinor,
      pricingFingerprint: latestPrice.fingerprint,
    });

    const booking = await transaction.hospitalityBooking.create({
      data: {
        organizationId: input.organizationId,
        propertyId: hold.propertyId,
        roomTypeId: hold.roomTypeId,
        ratePlanId: hold.ratePlanId,
        customerId: confirmation.customerId,
        holdId: hold.id,
        idempotencyKey: confirmation.idempotencyKey,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        arrivalDate: hold.arrivalDate,
        departureDate: hold.departureDate,
        quantity: hold.quantity,
        currency: snapshot.currency,
        accommodationSubtotalMinor: BigInt(snapshot.accommodationSubtotalMinor),
        taxTotalMinor: BigInt(snapshot.taxTotalMinor),
        feeTotalMinor: BigInt(snapshot.feeTotalMinor),
        addonTotalMinor: BigInt(snapshot.addonTotalMinor),
        totalMinor: BigInt(snapshot.totalMinor),
        pricingFingerprint: snapshot.pricingFingerprint,
        addonSelections: confirmation.addonSelections,
        confirmedAt: now,
      },
    });

    await transaction.hospitalityBookingGuest.createMany({
      data: confirmation.guests.map((guest, position) => ({
        organizationId: input.organizationId,
        bookingId: booking.id,
        position,
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
      })),
    });

    const allocation = await transaction.hospitalityBookingAllocation.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        propertyId: hold.propertyId,
        roomTypeId: hold.roomTypeId,
        arrivalDate: hold.arrivalDate,
        departureDate: hold.departureDate,
        quantity: hold.quantity,
      },
    });

    await transaction.hospitalityAvailabilityHold.update({
      where: { id: hold.id },
      data: { status: 'CONSUMED', endedAt: now },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.confirmed',
        resourceType: 'hospitality-booking',
        resourceId: booking.id,
        afterData: {
          propertyId: booking.propertyId,
          roomTypeId: booking.roomTypeId,
          ratePlanId: booking.ratePlanId,
          customerId: booking.customerId,
          holdId: booking.holdId,
          arrivalDate: booking.arrivalDate.toISOString().slice(0, 10),
          departureDate: booking.departureDate.toISOString().slice(0, 10),
          quantity: booking.quantity,
          guestCount: confirmation.guests.length,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          currency: booking.currency,
          totalMinor: booking.totalMinor.toString(),
          pricingFingerprint: booking.pricingFingerprint,
        },
      },
    });

    return { ...booking, allocation, guests: confirmation.guests };
  }, { isolationLevel: 'Serializable' });
}

export async function getHospitalityBooking(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  const booking = await db.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    include: { allocation: true, customer: true, roomType: true, ratePlan: true },
  });
  if (!booking) throw new HospitalityBookingUnavailableError();
  const guests = await readBookingGuests(db, input.organizationId, booking.id);
  return { ...booking, guests };
}

export async function listHospitalityBookings(input: {
  organizationId: string;
  actorUserId: string;
  page?: number;
  pageSize?: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' });
  const pagination = normalizePagination(input.page ?? 1, input.pageSize ?? 25);
  const where = { organizationId: input.organizationId };
  const total = await db.hospitalityBooking.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const bookings = await db.hospitalityBooking.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * pagination.pageSize,
    take: pagination.pageSize,
    include: {
      allocation: true,
      customer: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
      roomType: { select: { id: true, name: true, code: true } },
      ratePlan: { select: { id: true, name: true, code: true } },
    },
  });
  const guestRows = bookings.length === 0 ? [] : await db.hospitalityBookingGuest.findMany({
    where: { organizationId: input.organizationId, bookingId: { in: bookings.map((booking) => booking.id) } },
    orderBy: [{ bookingId: 'asc' }, { position: 'asc' }],
    select: { bookingId: true, firstName: true, lastName: true, email: true },
  });
  const guestsByBooking = new Map<string, HospitalityBookingGuestInput[]>();
  for (const guest of guestRows) {
    const bookingGuests = guestsByBooking.get(guest.bookingId) ?? [];
    bookingGuests.push({ firstName: guest.firstName, lastName: guest.lastName, email: guest.email });
    guestsByBooking.set(guest.bookingId, bookingGuests);
  }
  return { bookings: bookings.map((booking) => ({ ...booking, guests: guestsByBooking.get(booking.id) ?? [] })), total, page, totalPages };
}
