import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import { isInternalPaymentClaimReference } from './stripe-payment-service.ts';
import { nextStripeRefundBookingPaymentStatus } from './stripe-refund-service.ts';
import type { StripeRefundSnapshot } from './stripe-refund-reconciliation-provider.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

export function reconcileStripeRefundState(input: {
  currency: string;
  amountMinor: bigint;
  sourceProviderReference: string;
  snapshot: StripeRefundSnapshot;
}): 'PENDING' | 'SUCCEEDED' | 'FAILED' {
  if (
    input.snapshot.currency !== input.currency
    || input.snapshot.amountMinor !== input.amountMinor
    || input.snapshot.paymentIntentReference !== input.sourceProviderReference
  ) {
    throw new PaymentConflictError('Stripe refund reconciliation result does not match the persisted refund.');
  }
  if (input.snapshot.status === 'succeeded') return 'SUCCEEDED';
  if (input.snapshot.status === 'failed' || input.snapshot.status === 'canceled') return 'FAILED';
  return 'PENDING';
}

export async function reconcileStripeRefundTransaction(input: {
  organizationId: string;
  actorUserId: string;
  transactionId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.transactionId, 'transactionId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });

  const refund = await db.paymentTransaction.findFirst({
    where: { id: input.transactionId, organizationId: input.organizationId, providerCode: STRIPE_PROVIDER_CODE },
  });
  if (!refund) throw new PaymentUnavailableError('Stripe refund transaction is not available in this organization.');
  if (refund.kind !== 'REFUND') throw new PaymentConflictError('Only Stripe refund transactions can be reconciled by this boundary.');
  if (refund.status !== 'PENDING') return refund;
  if (isInternalPaymentClaimReference(refund.providerReference)) {
    throw new PaymentConflictError('Stripe refund claim has no refund reference yet; use the exact retry or a verified refund webhook to resolve it.');
  }

  const [booking, source] = await Promise.all([
    db.hospitalityBooking.findFirst({
      where: { id: refund.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    }),
    db.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: refund.bookingId,
        kind: 'CAPTURE',
        status: 'SUCCEEDED',
        providerCode: STRIPE_PROVIDER_CODE,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
  if (!source || isInternalPaymentClaimReference(source.providerReference)) {
    throw new PaymentConflictError('Stripe refund source capture is not available for reconciliation.');
  }
  if (booking.status !== 'CONFIRMED' || booking.currency !== source.currency || booking.totalMinor !== source.amountMinor) {
    throw new PaymentConflictError('Booking no longer matches the Stripe capture being refunded.');
  }
  if (refund.currency !== booking.currency || refund.amountMinor <= 0n || refund.amountMinor > source.amountMinor) {
    throw new PaymentConflictError('Persisted Stripe refund money is invalid for this booking.');
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('payment-refund')) {
    throw new PaymentConflictError('Stripe integration is not configured for payment-refund.');
  }

  const snapshot = await stripe.refundReconciliationProvider.retrieveRefund(refund.providerReference);
  if (snapshot.refundReference !== refund.providerReference) {
    throw new PaymentConflictError('Stripe refund reconciliation returned a different refund reference.');
  }
  const reconciledStatus = reconcileStripeRefundState({
    currency: refund.currency,
    amountMinor: refund.amountMinor,
    sourceProviderReference: source.providerReference,
    snapshot,
  });

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, refund.bookingId)}, 0))`;
    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: refund.id,
        organizationId: input.organizationId,
        bookingId: refund.bookingId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
      },
    });
    if (!current) throw new PaymentUnavailableError('Stripe refund transaction is not available in this organization.');
    if (current.status !== 'PENDING') return current;
    if (
      current.providerReference !== refund.providerReference
      || current.currency !== refund.currency
      || current.amountMinor !== refund.amountMinor
    ) {
      throw new PaymentConflictError('Stripe refund transaction changed during reconciliation.');
    }

    const currentBooking = await transaction.hospitalityBooking.findFirst({
      where: { id: refund.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    const currentSource = await transaction.paymentTransaction.findFirst({
      where: {
        id: source.id,
        organizationId: input.organizationId,
        bookingId: refund.bookingId,
        kind: 'CAPTURE',
        status: 'SUCCEEDED',
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: source.providerReference,
      },
    });
    if (!currentBooking || !currentSource) throw new PaymentConflictError('Stripe refund source changed during reconciliation.');
    if (
      currentBooking.status !== 'CONFIRMED'
      || currentBooking.currency !== source.currency
      || currentBooking.totalMinor !== source.amountMinor
      || currentSource.currency !== source.currency
      || currentSource.amountMinor !== source.amountMinor
    ) {
      throw new PaymentConflictError('Booking no longer matches the Stripe refund source.');
    }

    let bookingPaymentStatus = currentBooking.paymentStatus;
    if (reconciledStatus === 'SUCCEEDED') {
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(currentBooking.paymentStatus)) {
        if (currentBooking.paymentStatus !== 'REFUNDED') {
          throw new PaymentConflictError(`Booking payment state ${currentBooking.paymentStatus.toLowerCase()} cannot accept a reconciled Stripe refund.`);
        }
      }
      const previous = await transaction.paymentTransaction.aggregate({
        where: {
          organizationId: input.organizationId,
          bookingId: refund.bookingId,
          kind: 'REFUND',
          status: 'SUCCEEDED',
          providerCode: STRIPE_PROVIDER_CODE,
          id: { not: current.id },
        },
        _sum: { amountMinor: true },
      });
      bookingPaymentStatus = nextStripeRefundBookingPaymentStatus({
        sourceAmountMinor: currentSource.amountMinor,
        refundedBeforeMinor: previous._sum.amountMinor ?? 0n,
        refundAmountMinor: current.amountMinor,
      });
      if (currentBooking.paymentStatus === 'REFUNDED' && bookingPaymentStatus !== 'REFUNDED') {
        throw new PaymentConflictError('Stripe refund reconciliation cannot regress a fully refunded booking.');
      }
    }

    const updated = await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: { status: reconciledStatus },
    });
    if (currentBooking.paymentStatus !== bookingPaymentStatus) {
      await transaction.hospitalityBooking.update({ where: { id: currentBooking.id }, data: { paymentStatus: bookingPaymentStatus } });
    }
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.stripe-refund-reconciled',
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: currentBooking.id,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'REFUND',
        status: updated.status,
        bookingPaymentStatus,
        providerStatus: snapshot.status,
        currency: updated.currency,
        amountMinor: updated.amountMinor.toString(),
      },
    } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
