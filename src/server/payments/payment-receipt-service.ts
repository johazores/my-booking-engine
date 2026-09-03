import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildPaymentReceiptNumber,
  isReceiptEligiblePaymentStatus,
  PaymentReceiptEvidenceError,
  sanitizeSuccessfulPaymentTransactions,
  summarizeSuccessfulPaymentActivity,
} from './payment-receipt-domain.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';

export async function getBookingPaymentReceipt(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:read',
  });

  const [organization, booking, transactions] = await Promise.all([
    db.organization.findFirst({
      where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, name: true, contactEmail: true, contactPhone: true, websiteUrl: true },
    }),
    db.hospitalityBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, email: true } },
        roomType: { select: { id: true, name: true, code: true } },
        ratePlan: { select: { id: true, name: true, code: true } },
      },
    }),
    db.paymentTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
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

  if (!organization || !booking) {
    throw new PaymentUnavailableError('Booking payment receipt is not available in this organization.');
  }
  if (!['CONFIRMED', 'CANCELLED'].includes(booking.status)) {
    throw new PaymentConflictError('A payment receipt is available only after the booking is confirmed.');
  }
  if (!isReceiptEligiblePaymentStatus(booking.paymentStatus)) {
    throw new PaymentConflictError('A payment receipt is available only after successful payment.');
  }

  let safeTransactions;
  try {
    safeTransactions = sanitizeSuccessfulPaymentTransactions(transactions, booking.currency);
  } catch (error) {
    if (error instanceof PaymentReceiptEvidenceError) {
      throw new PaymentConflictError(error.message);
    }
    throw error;
  }
  const settlement = summarizeSuccessfulPaymentActivity(safeTransactions, booking.paymentStatus);

  if (settlement.capturedMinor <= 0n) {
    throw new PaymentConflictError('No successful captured payment is available for this receipt.');
  }
  if (settlement.refundedMinor > settlement.capturedMinor) {
    throw new PaymentConflictError('Persisted refund activity exceeds captured payment activity.');
  }

  return {
    documentType: 'PAYMENT_RECEIPT' as const,
    receiptNumber: buildPaymentReceiptNumber(booking.id),
    issuedAt: safeTransactions.at(-1)?.createdAt ?? booking.confirmedAt ?? booking.createdAt,
    organization,
    customer: booking.customer,
    booking: {
      id: booking.id,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      arrivalDate: booking.arrivalDate,
      departureDate: booking.departureDate,
      quantity: booking.quantity,
      roomType: booking.roomType,
      ratePlan: booking.ratePlan,
      currency: booking.currency,
      accommodationSubtotalMinor: booking.accommodationSubtotalMinor,
      taxTotalMinor: booking.taxTotalMinor,
      feeTotalMinor: booking.feeTotalMinor,
      addonTotalMinor: booking.addonTotalMinor,
      totalMinor: booking.totalMinor,
    },
    settlement,
    transactions: safeTransactions,
    note: 'This document is a payment receipt derived from SF booking and payment records. It is not a jurisdiction-specific tax invoice.',
  };
}

export {
  buildPaymentReceiptNumber,
  summarizeSuccessfulPaymentActivity,
} from './payment-receipt-domain.ts';
export type { PaymentReceiptTransaction } from './payment-receipt-domain.ts';
