import {
  PublicBookingCapabilityConfigurationError,
  verifyPublicBookingBookingCapability,
} from '../bookings/public-booking-capability.ts';
import { PublicHospitalityBookingUnavailableError } from '../bookings/public-hospitality-search-service.ts';
import { readPublicOrganizationBrandingBySlug } from '../branding/branding-service.ts';
import { db } from '../database.ts';
import {
  buildCustomerSettlementEntries,
  buildPaymentReceiptNumber,
  isReceiptEligiblePaymentStatus,
  PaymentReceiptEvidenceError,
  sanitizeSuccessfulPaymentTransactions,
  summarizeSuccessfulPaymentActivity,
} from './payment-receipt-domain.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';

export class PublicPaymentReceiptAuthorizationError extends Error {
  constructor(message = 'Payment receipt access is not available.') {
    super(message);
    this.name = 'PublicPaymentReceiptAuthorizationError';
  }
}

function publicBookingSecret() {
  const secret = process.env.SF_PUBLIC_BOOKING_SECRET?.trim();
  if (!secret) throw new PublicBookingCapabilityConfigurationError('SF_PUBLIC_BOOKING_SECRET is required for public booking reads.');
  return secret;
}

export async function getPublicBookingPaymentReceipt(input: {
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
  if (!capability) throw new PublicPaymentReceiptAuthorizationError();

  const [ownership, principal, booking, transactions] = await Promise.all([
    db.publicBookingBookingOwnership.findUnique({
      where: { organizationId_bookingId: { organizationId: branding.id, bookingId: capability.bookingId } },
      select: { principalId: true },
    }),
    db.publicBookingPrincipal.findFirst({
      where: { id: capability.principalId, organizationId: branding.id, expiresAt: { gt: now } },
      select: { id: true },
    }),
    db.hospitalityBooking.findFirst({
      where: { id: capability.bookingId, organizationId: branding.id },
      include: {
        customer: { select: { firstName: true, lastName: true, email: true } },
        roomType: { select: { name: true } },
        ratePlan: { select: { name: true } },
      },
    }),
    db.paymentTransaction.findMany({
      where: {
        organizationId: branding.id,
        bookingId: capability.bookingId,
        status: 'SUCCEEDED',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        kind: true,
        status: true,
        providerCode: true,
        providerReference: true,
        currency: true,
        amountMinor: true,
        createdAt: true,
      },
    }),
  ]);

  if (!ownership || ownership.principalId !== capability.principalId || !principal) {
    throw new PublicPaymentReceiptAuthorizationError();
  }
  if (!booking) throw new PaymentUnavailableError('Booking payment receipt is not available in this organization.');
  if (!['CONFIRMED', 'CANCELLED'].includes(booking.status) || !isReceiptEligiblePaymentStatus(booking.paymentStatus)) {
    throw new PaymentConflictError('A payment receipt is available only after successful payment.');
  }

  let safeTransactions;
  try {
    safeTransactions = sanitizeSuccessfulPaymentTransactions(transactions, booking.currency);
  } catch (error) {
    if (error instanceof PaymentReceiptEvidenceError) throw new PaymentConflictError(error.message);
    throw error;
  }

  const settlement = summarizeSuccessfulPaymentActivity(safeTransactions, booking.paymentStatus);
  if (settlement.capturedMinor <= 0n || settlement.refundedMinor > settlement.capturedMinor) {
    throw new PaymentConflictError('Successful payment evidence is not sufficient for a receipt.');
  }

  return Object.freeze({
    documentType: 'PAYMENT_RECEIPT' as const,
    receiptNumber: buildPaymentReceiptNumber(booking.id),
    issuedAt: (safeTransactions.at(-1)?.createdAt ?? booking.confirmedAt ?? booking.createdAt).toISOString(),
    organization: Object.freeze({
      name: branding.name,
      contactEmail: branding.contactEmail,
      contactPhone: branding.contactPhone,
      websiteUrl: branding.websiteUrl,
    }),
    customer: booking.customer,
    booking: Object.freeze({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      arrivalDate: booking.arrivalDate.toISOString().slice(0, 10),
      departureDate: booking.departureDate.toISOString().slice(0, 10),
      quantity: booking.quantity,
      roomTypeName: booking.roomType.name,
      ratePlanName: booking.ratePlan.name,
      currency: booking.currency,
      accommodationSubtotalMinor: booking.accommodationSubtotalMinor.toString(),
      taxTotalMinor: booking.taxTotalMinor.toString(),
      feeTotalMinor: booking.feeTotalMinor.toString(),
      addonTotalMinor: booking.addonTotalMinor.toString(),
      totalMinor: booking.totalMinor.toString(),
    }),
    settlement: Object.freeze({
      capturedMinor: settlement.capturedMinor.toString(),
      refundedMinor: settlement.refundedMinor.toString(),
      netPaidMinor: settlement.netPaidMinor.toString(),
    }),
    activity: buildCustomerSettlementEntries(safeTransactions, booking.paymentStatus).map((entry) => Object.freeze({
      kind: entry.kind,
      amountMinor: entry.amountMinor.toString(),
      createdAt: entry.createdAt.toISOString(),
    })),
    note: 'Payment receipt from verified SF booking and payment records. Tax and fee amounts are the stored booking price totals; this is not a jurisdiction-specific tax invoice.',
  });
}
