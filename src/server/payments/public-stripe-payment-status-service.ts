import { verifyPublicBookingBookingCapability, PublicBookingCapabilityConfigurationError } from '../bookings/public-booking-capability.ts';
import { shouldProtectPendingPublicBookingAllocation } from '../bookings/public-booking-payment-window.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import { PaymentUnavailableError } from './payment-service.ts';
import { decidePublicStripePaymentRecovery } from './public-stripe-payment-recovery-domain.ts';
import { PublicStripeCheckoutAuthorizationError } from './public-stripe-checkout-service.ts';

function publicBookingSecret() {
  const secret = process.env.SF_PUBLIC_BOOKING_SECRET?.trim();
  if (!secret) throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking writes.');
  return secret;
}

export async function getPublicStripePaymentStatus(input: {
  organizationSlug: string;
  bookingCapability: string;
  now?: Date;
}) {
  const branding = await readPublicOrganizationBrandingBySlug(input.organizationSlug);
  if (!branding) throw new PublicHospitalityBookingUnavailableError();

  const now = input.now ?? new Date();
  const capability = verifyPublicBookingBookingCapability({
    secret: publicBookingSecret(),
    token: input.bookingCapability,
    expectedOrganizationId: branding.id,
    now,
  });
  if (!capability) throw new PublicStripeCheckoutAuthorizationError();

  const [ownership, principal, booking] = await Promise.all([
    db.publicBookingBookingOwnership.findUnique({
      where: { organizationId_bookingId: { organizationId: branding.id, bookingId: capability.bookingId } },
      select: { principalId: true, createdAt: true },
    }),
    db.publicBookingPrincipal.findFirst({
      where: { id: capability.principalId, organizationId: branding.id, expiresAt: { gt: now } },
      select: { id: true },
    }),
    db.hospitalityBooking.findFirst({
      where: { id: capability.bookingId, organizationId: branding.id },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    }),
  ]);

  if (!ownership || ownership.principalId !== capability.principalId || !principal) {
    throw new PublicStripeCheckoutAuthorizationError();
  }
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');

  const [latest, openCheckout] = await Promise.all([
    db.paymentTransaction.findFirst({
      where: {
        organizationId: branding.id,
        bookingId: booking.id,
        providerCode: 'stripe',
        kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { kind: true, status: true, currency: true, amountMinor: true, createdAt: true },
    }),
    booking.status === 'PENDING_CONFIRMATION' || booking.status === 'CONFIRMED'
      ? db.paymentCheckoutSession.findFirst({
          where: {
            organizationId: branding.id,
            bookingId: booking.id,
            providerCode: 'stripe',
            status: 'OPEN',
            expiresAt: { gt: now },
          },
          orderBy: { expiresAt: 'desc' },
          select: { expiresAt: true },
        })
      : Promise.resolve(null),
  ]);

  const pendingAllocationProtected = booking.status !== 'PENDING_CONFIRMATION' || shouldProtectPendingPublicBookingAllocation({
    ownershipCreatedAt: ownership.createdAt,
    openCheckoutExpiresAt: openCheckout?.expiresAt ?? null,
    unresolvedPaymentCreatedAt: latest?.status === 'PENDING' || latest?.status === 'AMBIGUOUS' ? latest.createdAt : null,
    hasSuccessfulPayment: latest?.status === 'SUCCEEDED',
    now,
  });
  const recovery = decidePublicStripePaymentRecovery({
    bookingStatus: booking.status,
    bookingPaymentStatus: booking.paymentStatus,
    pendingAllocationProtected,
    latestPaymentStatus: latest?.status ?? null,
    hasOpenCheckout: Boolean(openCheckout),
  });

  return Object.freeze({
    state: recovery.state,
    canResumeCheckout: recovery.canResumeCheckout,
    canContinuePayment: recovery.canContinuePayment,
    bookingStatus: booking.status,
    paymentStatus: booking.paymentStatus,
    currency: booking.currency,
    totalMinor: booking.totalMinor.toString(),
    latestOperation: latest
      ? Object.freeze({ kind: latest.kind, status: latest.status })
      : null,
  });
}
