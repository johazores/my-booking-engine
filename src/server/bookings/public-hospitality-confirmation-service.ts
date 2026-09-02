import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { normalizeCustomerInput } from '../customers/customer-domain.ts';
import { db } from '../database.ts';
import { normalizeHospitalityAddonSelections, type HospitalityAddonSelectionInput } from '../pricing/hospitality-addon-domain.ts';
import {
  normalizeBookingPricingFingerprint,
  normalizeHospitalityBookingGuests,
  type HospitalityBookingGuestInput,
} from './booking-domain.ts';
import {
  confirmHospitalityBookingFromHoldInTransaction,
  HospitalityBookingConflictError,
  HospitalityBookingPriceChangedError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-confirmation-core.ts';
import {
  issuePublicBookingBookingCapability,
  PublicBookingCapabilityConfigurationError,
  verifyPublicBookingHoldCapability,
} from './public-booking-capability.ts';
import { publicBookingPaymentStartDeadline } from './public-booking-payment-window.ts';
import {
  createPublicBookingRequestFingerprint,
  derivePublicBookingConfirmationIdempotencyKey,
} from './public-booking-request-domain.ts';
import { PublicHospitalityHoldAuthorizationError } from './public-hospitality-hold-service.ts';
import { PublicHospitalityBookingUnavailableError } from './public-hospitality-search-service.ts';

const PUBLIC_BOOKING_RECOVERY_HOURS = 24;

export class PublicHospitalityConfirmationConflictError extends Error {
  constructor(message = 'Public booking confirmation conflicts with a previous request.') {
    super(message);
    this.name = 'PublicHospitalityConfirmationConflictError';
  }
}

export class PublicHospitalityCustomerUnavailableError extends Error {
  constructor(message = 'Customer contact cannot be used for this booking.') {
    super(message);
    this.name = 'PublicHospitalityCustomerUnavailableError';
  }
}

export type PublicHospitalityCustomerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
};

function publicBookingSecret() {
  const secret = process.env.SF_PUBLIC_BOOKING_SECRET?.trim();
  if (!secret) throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking writes.');
  return secret;
}

function serializePublicBooking(booking: {
  status: string;
  paymentStatus: string;
  arrivalDate: Date;
  departureDate: Date;
  quantity: number;
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  pricingFingerprint: string;
}) {
  return {
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    arrivalDate: booking.arrivalDate.toISOString().slice(0, 10),
    departureDate: booking.departureDate.toISOString().slice(0, 10),
    quantity: booking.quantity,
    currency: booking.currency,
    accommodationSubtotalMinor: booking.accommodationSubtotalMinor.toString(),
    taxTotalMinor: booking.taxTotalMinor.toString(),
    feeTotalMinor: booking.feeTotalMinor.toString(),
    addonTotalMinor: booking.addonTotalMinor.toString(),
    totalMinor: booking.totalMinor.toString(),
    pricingFingerprint: booking.pricingFingerprint,
  };
}

export async function confirmPublicHospitalityBookingFromHold(input: {
  organizationSlug: string;
  capability: string;
  requestKey: string;
  expectedPricingFingerprint: string;
  customer: PublicHospitalityCustomerInput;
  guests: HospitalityBookingGuestInput[];
  addonSelections?: HospitalityAddonSelectionInput[];
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();

  const now = input.now ?? new Date();
  const secret = publicBookingSecret();
  const holdCapability = verifyPublicBookingHoldCapability({
    secret,
    token: input.capability,
    expectedOrganizationId: branding.id,
    now,
  });
  if (!holdCapability) throw new PublicHospitalityHoldAuthorizationError();

  const customer = normalizeCustomerInput({
    firstName: input.customer.firstName,
    lastName: input.customer.lastName,
    email: input.customer.email,
    phone: input.customer.phone ?? '',
    notes: '',
  });
  const customerEmail = customer.email;
  if (!customerEmail) throw new PublicHospitalityCustomerUnavailableError('A valid customer email is required for public booking recovery.');
  const guests = normalizeHospitalityBookingGuests(input.guests);
  const addonSelections = normalizeHospitalityAddonSelections(input.addonSelections ?? []);
  const expectedPricingFingerprint = normalizeBookingPricingFingerprint(input.expectedPricingFingerprint);
  const idempotencyKey = derivePublicBookingConfirmationIdempotencyKey({ secret, organizationId: branding.id, requestKey: input.requestKey });
  const requestFingerprint = createPublicBookingRequestFingerprint({ customer, guests, addonSelections, expectedPricingFingerprint });

  const result = await db.$transaction(async (transaction) => {
    const ownership = await transaction.publicBookingHoldOwnership.findUnique({
      where: { organizationId_holdId: { organizationId: branding.id, holdId: holdCapability.holdId } },
    });
    if (!ownership || ownership.principalId !== holdCapability.principalId) throw new PublicHospitalityHoldAuthorizationError();

    const principal = await transaction.publicBookingPrincipal.findFirst({
      where: { id: holdCapability.principalId, organizationId: branding.id, expiresAt: { gt: now } },
      select: { id: true, expiresAt: true },
    });
    if (!principal) throw new PublicHospitalityHoldAuthorizationError();

    let customerRecord = await transaction.customer.findUnique({
      where: { organizationId_email: { organizationId: branding.id, email: customerEmail } },
    });
    let customerCreated = false;
    if (customerRecord?.status === 'ARCHIVED') throw new PublicHospitalityCustomerUnavailableError();
    if (!customerRecord) {
      customerRecord = await transaction.customer.create({
        data: { organizationId: branding.id, ...customer, email: customerEmail },
      });
      customerCreated = true;
    }

    const confirmationResult = await confirmHospitalityBookingFromHoldInTransaction({
      transaction,
      organizationId: branding.id,
      confirmation: {
        holdId: holdCapability.holdId,
        customerId: customerRecord.id,
        idempotencyKey,
        expectedPricingFingerprint,
        addonSelections,
        guests,
      },
      now,
      initialStatus: 'PENDING_CONFIRMATION',
    });

    const recoveryExpiresAt = new Date(now.getTime() + PUBLIC_BOOKING_RECOVERY_HOURS * 60 * 60_000);
    if (!confirmationResult.created) {
      const bookingOwnership = await transaction.publicBookingBookingOwnership.findUnique({
        where: { organizationId_bookingId: { organizationId: branding.id, bookingId: confirmationResult.booking.id } },
      });
      if (
        !bookingOwnership
        || bookingOwnership.principalId !== holdCapability.principalId
        || bookingOwnership.requestFingerprint !== requestFingerprint
      ) throw new PublicHospitalityConfirmationConflictError();
      return {
        booking: confirmationResult.booking,
        principalId: bookingOwnership.principalId,
        recoveryExpiresAt: principal.expiresAt,
        paymentStartDeadlineAt: publicBookingPaymentStartDeadline(bookingOwnership.createdAt),
      };
    }

    const bookingOwnership = await transaction.publicBookingBookingOwnership.create({
      data: {
        organizationId: branding.id,
        bookingId: confirmationResult.booking.id,
        principalId: holdCapability.principalId,
        requestFingerprint,
      },
    });
    await transaction.publicBookingPrincipal.update({
      where: { id: holdCapability.principalId },
      data: { expiresAt: recoveryExpiresAt },
    });
    if (customerCreated) {
      await transaction.publicBookingAuditEvent.create({
        data: {
          organizationId: branding.id,
          actorPrincipalId: holdCapability.principalId,
          action: 'public-booking.customer.created',
          resourceType: 'customer',
          resourceId: customerRecord.id,
          afterData: { status: customerRecord.status },
        },
      });
    }
    const paymentStartDeadlineAt = publicBookingPaymentStartDeadline(bookingOwnership.createdAt);
    await transaction.publicBookingAuditEvent.create({
      data: {
        organizationId: branding.id,
        actorPrincipalId: holdCapability.principalId,
        action: 'public-booking.payment-pending',
        resourceType: 'hospitality-booking',
        resourceId: confirmationResult.booking.id,
        afterData: {
          status: confirmationResult.booking.status,
          paymentStatus: confirmationResult.booking.paymentStatus,
          quantity: confirmationResult.booking.quantity,
          guestCount: guests.length,
          currency: confirmationResult.booking.currency,
          totalMinor: confirmationResult.booking.totalMinor.toString(),
          pricingFingerprint: confirmationResult.booking.pricingFingerprint,
          paymentStartDeadlineAt: paymentStartDeadlineAt.toISOString(),
        },
      },
    });

    return {
      booking: confirmationResult.booking,
      principalId: holdCapability.principalId,
      recoveryExpiresAt,
      paymentStartDeadlineAt,
    };
  }, { isolationLevel: 'Serializable' });

  return {
    booking: serializePublicBooking(result.booking),
    bookingCapability: issuePublicBookingBookingCapability({
      secret,
      organizationId: branding.id,
      principalId: result.principalId,
      bookingId: result.booking.id,
      expiresAt: result.recoveryExpiresAt,
    }),
    capabilityExpiresAt: result.recoveryExpiresAt.toISOString(),
    paymentStartDeadlineAt: result.paymentStartDeadlineAt.toISOString(),
  };
}

export { HospitalityBookingConflictError, HospitalityBookingPriceChangedError, HospitalityBookingUnavailableError };
