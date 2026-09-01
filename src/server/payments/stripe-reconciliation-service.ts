import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { PaymentConflictError, PaymentUnavailableError } from './payment-service.ts';
import { isInternalPaymentClaimReference } from './stripe-payment-service.ts';
import type { StripePaymentIntentSnapshot } from './stripe-payment-reconciliation-provider.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

export function reconcileStripeTransactionState(input: {
  kind: 'AUTHORIZATION' | 'CAPTURE';
  currency: string;
  amountMinor: bigint;
  snapshot: StripePaymentIntentSnapshot;
}): {
  transactionStatus: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  bookingPaymentStatus: 'UNPAID' | 'AUTHORIZED' | 'PAID' | 'FAILED';
} {
  if (input.snapshot.currency !== input.currency || input.snapshot.amountMinor !== input.amountMinor) {
    throw new PaymentConflictError('Stripe reconciliation result does not match the persisted payment amount.');
  }

  if (input.kind === 'AUTHORIZATION') {
    if (input.snapshot.status === 'requires_capture') return { transactionStatus: 'SUCCEEDED', bookingPaymentStatus: 'AUTHORIZED' };
    if (input.snapshot.status === 'succeeded') {
      if (input.snapshot.amountReceivedMinor !== input.amountMinor) throw new PaymentConflictError('Stripe succeeded amount does not match the persisted payment amount.');
      return { transactionStatus: 'SUCCEEDED', bookingPaymentStatus: 'PAID' };
    }
    if (input.snapshot.status === 'canceled' || input.snapshot.status === 'requires_payment_method') {
      return { transactionStatus: 'FAILED', bookingPaymentStatus: 'FAILED' };
    }
    return { transactionStatus: 'PENDING', bookingPaymentStatus: 'UNPAID' };
  }

  if (input.snapshot.status === 'succeeded') {
    if (input.snapshot.amountReceivedMinor !== input.amountMinor) throw new PaymentConflictError('Stripe captured amount does not match the persisted payment amount.');
    return { transactionStatus: 'SUCCEEDED', bookingPaymentStatus: 'PAID' };
  }
  if (input.snapshot.status === 'canceled' || input.snapshot.status === 'requires_payment_method') {
    return { transactionStatus: 'FAILED', bookingPaymentStatus: 'AUTHORIZED' };
  }
  return { transactionStatus: 'PENDING', bookingPaymentStatus: 'AUTHORIZED' };
}

export async function reconcileStripePaymentTransaction(input: {
  organizationId: string;
  actorUserId: string;
  transactionId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.transactionId, 'transactionId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' });

  const payment = await db.paymentTransaction.findFirst({
    where: { id: input.transactionId, organizationId: input.organizationId, providerCode: STRIPE_PROVIDER_CODE },
  });
  if (!payment) throw new PaymentUnavailableError('Stripe payment transaction is not available in this organization.');
  if (payment.kind !== 'AUTHORIZATION' && payment.kind !== 'CAPTURE') throw new PaymentConflictError('Only Stripe authorization or capture transactions can be reconciled.');
  if (payment.status !== 'PENDING') return payment;
  if (isInternalPaymentClaimReference(payment.providerReference)) {
    throw new PaymentConflictError('Stripe payment claim has no provider reference yet; use the exact retry or a verified webhook to resolve it.');
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  const requiredCapability = payment.kind === 'AUTHORIZATION' ? 'payment-authorize' : 'payment-capture';
  if (!stripe.integration.capabilities.includes(requiredCapability)) throw new PaymentConflictError(`Stripe integration is not configured for ${requiredCapability}.`);

  const snapshot = await stripe.reconciliationProvider.retrievePaymentIntent(payment.providerReference);
  if (snapshot.providerReference !== payment.providerReference) throw new PaymentConflictError('Stripe reconciliation returned a different provider reference.');
  const reconciliation = reconcileStripeTransactionState({
    kind: payment.kind,
    currency: payment.currency,
    amountMinor: payment.amountMinor,
    snapshot,
  });

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, payment.bookingId)}, 0))`;
    const current = await transaction.paymentTransaction.findFirst({
      where: { id: payment.id, organizationId: input.organizationId, bookingId: payment.bookingId, providerCode: STRIPE_PROVIDER_CODE },
    });
    if (!current) throw new PaymentUnavailableError('Stripe payment transaction is not available in this organization.');
    if (current.status !== 'PENDING') return current;
    if (current.providerReference !== payment.providerReference || current.kind !== payment.kind || current.currency !== payment.currency || current.amountMinor !== payment.amountMinor) {
      throw new PaymentConflictError('Stripe payment transaction changed during reconciliation.');
    }

    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: payment.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!booking) throw new PaymentUnavailableError('Booking is not available in this organization.');
    if (booking.status !== 'CONFIRMED' || booking.currency !== payment.currency || booking.totalMinor !== payment.amountMinor) {
      throw new PaymentConflictError('Booking no longer matches the payment transaction being reconciled.');
    }

    const updated = await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: { status: reconciliation.transactionStatus },
    });
    if (booking.paymentStatus !== reconciliation.bookingPaymentStatus) {
      await transaction.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: reconciliation.bookingPaymentStatus } });
    }
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.stripe-reconciled',
        resourceType: 'payment-transaction',
        resourceId: updated.id,
        afterData: {
          bookingId: booking.id,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: updated.kind,
          status: updated.status,
          bookingPaymentStatus: reconciliation.bookingPaymentStatus,
          providerStatus: snapshot.status,
        },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
