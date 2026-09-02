import type { Prisma } from '../../generated/prisma/client.ts';
import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { formatAvailabilityDate } from '../availability/availability-domain.ts';
import { quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
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

export async function confirmHospitalityBookingFromHoldInTransaction(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  confirmation: HospitalityBookingConfirmationInput;
  now: Date;
}) {
  const confirmation = normalizeHospitalityBookingConfirmationInput(input.confirmation);

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bookingIdempotencyLockKey(input.organizationId, confirmation.idempotencyKey)}, 0))`;

  const existing = await input.transaction.hospitalityBooking.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: confirmation.idempotencyKey } },
    include: { allocation: true },
  });
  if (existing) {
    const existingGuests = await input.transaction.hospitalityBookingGuest.findMany({
      where: { organizationId: input.organizationId, bookingId: existing.id },
      orderBy: { position: 'asc' },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!bookingConfirmationPayloadMatches(bookingAsConfirmationInput(existing, existingGuests), confirmation)) {
      throw new HospitalityBookingConflictError('Idempotency key was already used for a different booking confirmation request.');
    }
    return { booking: { ...existing, guests: existingGuests }, created: false as const };
  }

  const initialHold = await input.transaction.hospitalityAvailabilityHold.findFirst({
    where: { id: confirmation.holdId, organizationId: input.organizationId },
    select: { propertyId: true, roomTypeId: true },
  });
  if (!initialHold) throw new HospitalityBookingUnavailableError('Availability hold is not available in this organization.');

  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: initialHold.propertyId, roomTypeId: initialHold.roomTypeId })}, 0))`;

  const [hold, customer, holdBooking] = await Promise.all([
    input.transaction.hospitalityAvailabilityHold.findFirst({
      where: { id: confirmation.holdId, organizationId: input.organizationId },
    }),
    input.transaction.customer.findFirst({
      where: { id: confirmation.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true },
    }),
    input.transaction.hospitalityBooking.findFirst({
      where: { organizationId: input.organizationId, holdId: confirmation.holdId },
      select: { id: true },
    }),
  ]);

  if (!hold || hold.status !== 'ACTIVE' || hold.expiresAt <= input.now) {
    throw new HospitalityBookingUnavailableError('Availability hold is no longer active and unexpired.');
  }
  if (!customer) throw new HospitalityBookingUnavailableError('Active customer is not available in this organization.');
  if (holdBooking) throw new HospitalityBookingConflictError('Availability hold has already been consumed by another booking request.');

  const assignment = await input.transaction.hospitalityRoomTypeRatePlan.findFirst({
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
    reader: input.transaction,
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

  const booking = await input.transaction.hospitalityBooking.create({
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
      confirmedAt: input.now,
    },
  });

  await input.transaction.hospitalityBookingGuest.createMany({
    data: confirmation.guests.map((guest, position) => ({
      organizationId: input.organizationId,
      bookingId: booking.id,
      position,
      firstName: guest.firstName,
      lastName: guest.lastName,
      email: guest.email,
    })),
  });

  const allocation = await input.transaction.hospitalityBookingAllocation.create({
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

  await input.transaction.hospitalityAvailabilityHold.update({
    where: { id: hold.id },
    data: { status: 'CONSUMED', endedAt: input.now },
  });

  return { booking: { ...booking, allocation, guests: confirmation.guests }, created: true as const };
}

export function createHospitalityBookingAuditData(booking: {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  customerId: string;
  holdId: string;
  arrivalDate: Date;
  departureDate: Date;
  quantity: number;
  status: string;
  paymentStatus: string;
  currency: string;
  totalMinor: bigint;
  pricingFingerprint: string;
  guests: HospitalityBookingGuestInput[];
}) {
  return {
    propertyId: booking.propertyId,
    roomTypeId: booking.roomTypeId,
    ratePlanId: booking.ratePlanId,
    customerId: booking.customerId,
    holdId: booking.holdId,
    arrivalDate: booking.arrivalDate.toISOString().slice(0, 10),
    departureDate: booking.departureDate.toISOString().slice(0, 10),
    quantity: booking.quantity,
    guestCount: booking.guests.length,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    currency: booking.currency,
    totalMinor: booking.totalMinor.toString(),
    pricingFingerprint: booking.pricingFingerprint,
  };
}
