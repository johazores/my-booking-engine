import { createHash } from 'node:crypto';

import { hospitalityAvailabilityAllocationLockKey } from '../availability/availability-allocation-lock.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { PaymentConflictError } from './payment-service.ts';
import { assertPaymentProviderCapability } from './payment-provider.ts';
import { reconcileStripeRefundState } from './stripe-refund-reconciliation-service.ts';
import { nextStripeRefundBookingPaymentStatus, selectStripeRefundSource } from './stripe-refund-service.ts';
import { isInternalPaymentClaimReference } from './stripe-payment-service.ts';
import { reconcileStripeTransactionState, reconciledBookingPaymentStatus } from './stripe-reconciliation-service.ts';
import {
  StripeWebhookValidationError,
  decideStripeCheckoutExpiration,
  parseStripeWebhookEventPayload,
  selectStripeWebhookPaymentCandidate,
  selectStripeWebhookRefundCandidate,
} from './stripe-webhook-domain.ts';

const STRIPE_PROVIDER_CODE = 'stripe';
const MAX_WEBHOOK_PAYLOAD_BYTES = 262_144;

export class StripeWebhookRequestError extends Error {
  readonly code: 'INVALID_REQUEST' | 'INVALID_SIGNATURE' | 'CONFIGURATION';

  constructor(code: StripeWebhookRequestError['code'], message: string) {
    super(message);
    this.name = 'StripeWebhookRequestError';
    this.code = code;
  }
}

function paymentLockKey(organizationId: string, scope: string, value: string) {
  return `payment:${organizationId}:${scope}:${value}`;
}

export async function ingestStripePaymentWebhook(input: {
  organizationId: string;
  signature: unknown;
  payload: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  if (typeof input.signature !== 'string' || input.signature.length === 0 || input.signature.length > 4_096) {
    throw new StripeWebhookRequestError('INVALID_SIGNATURE', 'Stripe signature header is invalid.');
  }
  if (Buffer.byteLength(input.payload, 'utf8') > MAX_WEBHOOK_PAYLOAD_BYTES) {
    throw new StripeWebhookRequestError('INVALID_REQUEST', 'Stripe webhook payload is too large.');
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  if (!stripe.integration.capabilities.includes('webhooks')) {
    throw new StripeWebhookRequestError('CONFIGURATION', 'Stripe webhooks are not enabled for this integration.');
  }
  assertPaymentProviderCapability(stripe.provider, 'WEBHOOKS');
  if (!stripe.webhookSecret || !stripe.provider.verifyWebhookSignature) {
    throw new StripeWebhookRequestError('CONFIGURATION', 'Stripe webhook verification is not configured.');
  }
  if (!stripe.provider.verifyWebhookSignature({ payload: input.payload, signature: input.signature, secret: stripe.webhookSecret })) {
    throw new StripeWebhookRequestError('INVALID_SIGNATURE', 'Stripe webhook signature verification failed.');
  }

  let event;
  try {
    event = parseStripeWebhookEventPayload(input.payload);
  } catch (error) {
    if (error instanceof StripeWebhookValidationError) throw new StripeWebhookRequestError('INVALID_REQUEST', error.message);
    throw error;
  }

  const payloadHash = createHash('sha256').update(input.payload, 'utf8').digest('hex');

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'webhook', event.providerEventId)}, 0))`;

    const existingEvent = await transaction.paymentWebhookEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerEventId: event.providerEventId,
      },
    });
    if (existingEvent) {
      if (existingEvent.payloadHash !== payloadHash || existingEvent.eventType !== event.eventType) {
        throw new PaymentConflictError('Stripe webhook event ID was already received with different content.');
      }
      return existingEvent;
    }

    const persistEvent = (status: 'PROCESSED' | 'IGNORED', processingNote: string, bookingId?: string | null) => transaction.paymentWebhookEvent.create({
      data: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        payloadHash,
        providerReference: event.checkoutSession?.providerReference ?? event.paymentIntent?.providerReference ?? event.refund?.refundReference ?? null,
        bookingId: bookingId ?? event.checkoutSession?.bookingId ?? event.paymentIntent?.bookingId ?? null,
        status,
        processingNote,
        providerCreatedAt: event.providerCreatedAt,
      },
    });

    if (event.checkoutSession) {
      if (!event.checkoutSession.organizationId || !event.checkoutSession.bookingId) {
        return persistEvent('IGNORED', 'checkout-session-missing-sf-metadata', event.checkoutSession.bookingId);
      }
      if (event.checkoutSession.organizationId !== input.organizationId) {
        return persistEvent('IGNORED', 'checkout-session-tenant-metadata-mismatch', null);
      }

      const tracked = await transaction.paymentCheckoutSession.findUnique({
        where: {
          organizationId_providerCode_providerReference: {
            organizationId: input.organizationId,
            providerCode: STRIPE_PROVIDER_CODE,
            providerReference: event.checkoutSession.providerReference,
          },
        },
      });
      if (!tracked) return persistEvent('IGNORED', 'checkout-session-untracked', event.checkoutSession.bookingId);
      if (tracked.bookingId !== event.checkoutSession.bookingId) {
        return persistEvent('IGNORED', 'checkout-session-booking-mismatch', event.checkoutSession.bookingId);
      }

      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', tracked.bookingId)}, 0))`;
      const booking = await transaction.hospitalityBooking.findFirst({
        where: { id: tracked.bookingId, organizationId: input.organizationId },
        select: {
          id: true,
          propertyId: true,
          roomTypeId: true,
          status: true,
          paymentStatus: true,
          currency: true,
          totalMinor: true,
        },
      });
      const payment = await transaction.paymentTransaction.findFirst({
        where: {
          id: tracked.paymentTransactionId,
          organizationId: input.organizationId,
          bookingId: tracked.bookingId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'CAPTURE',
        },
      });
      const currentSession = await transaction.paymentCheckoutSession.findUnique({
        where: {
          organizationId_providerCode_providerReference: {
            organizationId: input.organizationId,
            providerCode: STRIPE_PROVIDER_CODE,
            providerReference: tracked.providerReference,
          },
        },
      });
      if (!booking || !payment || !currentSession || currentSession.paymentTransactionId !== payment.id) {
        return persistEvent('IGNORED', 'checkout-session-persistence-mismatch', tracked.bookingId);
      }
      if (booking.currency !== event.checkoutSession.currency || booking.totalMinor !== event.checkoutSession.amountTotalMinor) {
        return persistEvent('IGNORED', 'checkout-session-booking-money-mismatch', booking.id);
      }
      if (payment.currency !== booking.currency || payment.amountMinor !== booking.totalMinor) {
        throw new PaymentConflictError('Tracked Stripe Checkout payment does not match the authoritative booking total.');
      }

      if (event.eventType === 'checkout.session.completed') {
        if (event.checkoutSession.status !== 'complete') {
          return persistEvent('IGNORED', 'checkout-session-completed-state-mismatch', booking.id);
        }
        if (currentSession.status === 'EXPIRED') {
          return persistEvent('IGNORED', 'checkout-session-completed-after-expiry', booking.id);
        }

        if (event.checkoutSession.paymentStatus !== 'paid') {
          if (currentSession.status === 'OPEN') {
            await transaction.paymentCheckoutSession.update({
              where: { id: currentSession.id },
              data: {
                status: 'COMPLETED',
                completedAt: event.providerCreatedAt,
                providerPaymentReference: event.checkoutSession.paymentIntentReference,
              },
            });
          }
          return persistEvent('PROCESSED', 'checkout-session-completed-payment-pending', booking.id);
        }
        if (!event.checkoutSession.paymentIntentReference) {
          return persistEvent('IGNORED', 'checkout-session-paid-without-payment-intent', booking.id);
        }
        if (booking.status !== 'CONFIRMED') return persistEvent('IGNORED', 'checkout-session-paid-booking-not-confirmed', booking.id);

        const providerReferenceConflict = await transaction.paymentTransaction.findFirst({
          where: {
            organizationId: input.organizationId,
            providerCode: STRIPE_PROVIDER_CODE,
            providerReference: event.checkoutSession.paymentIntentReference,
            id: { not: payment.id },
          },
          select: { id: true },
        });
        if (providerReferenceConflict) throw new PaymentConflictError('Stripe Checkout PaymentIntent reference belongs to another payment transaction.');

        if (payment.status !== 'SUCCEEDED') {
          await transaction.paymentTransaction.update({
            where: { id: payment.id },
            data: {
              providerReference: event.checkoutSession.paymentIntentReference,
              status: 'SUCCEEDED',
            },
          });
        } else if (payment.providerReference !== event.checkoutSession.paymentIntentReference) {
          throw new PaymentConflictError('Completed Stripe Checkout Session disagrees with the recorded successful payment reference.');
        }
        if (booking.paymentStatus !== 'PAID') {
          await transaction.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: 'PAID' } });
        }
        if (currentSession.status !== 'COMPLETED') {
          await transaction.paymentCheckoutSession.update({
            where: { id: currentSession.id },
            data: {
              status: 'COMPLETED',
              completedAt: event.providerCreatedAt,
              providerPaymentReference: event.checkoutSession.paymentIntentReference,
            },
          });
        }
        return persistEvent('PROCESSED', 'checkout-session-paid', booking.id);
      }

      if (event.eventType === 'checkout.session.expired') {
        if (currentSession.status === 'COMPLETED') {
          return persistEvent('IGNORED', 'checkout-session-expired-after-completion', booking.id);
        }

        const successfulPayment = await transaction.paymentTransaction.findFirst({
          where: {
            organizationId: input.organizationId,
            bookingId: booking.id,
            providerCode: STRIPE_PROVIDER_CODE,
            kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
            status: 'SUCCEEDED',
          },
          select: { id: true },
        });
        const decision = decideStripeCheckoutExpiration({
          checkoutStatus: event.checkoutSession.status,
          checkoutPaymentStatus: event.checkoutSession.paymentStatus,
          checkoutPaymentIntentReference: event.checkoutSession.paymentIntentReference,
          bookingStatus: booking.status,
          bookingPaymentStatus: booking.paymentStatus,
          paymentTransactionStatus: payment.status,
          paymentTransactionProviderReference: payment.providerReference,
          hasSuccessfulPayment: Boolean(successfulPayment),
          isInternalReference: isInternalPaymentClaimReference,
        });

        if (event.checkoutSession.status === 'expired' && currentSession.status === 'OPEN') {
          await transaction.paymentCheckoutSession.update({
            where: { id: currentSession.id },
            data: {
              status: 'EXPIRED',
              expiredAt: event.providerCreatedAt,
              providerPaymentReference: event.checkoutSession.paymentIntentReference,
            },
          });
        }
        if (decision.action !== 'CANCEL_BOOKING') {
          return persistEvent(decision.action === 'IGNORE_TERMINAL' ? 'IGNORED' : 'PROCESSED', decision.note, booking.id);
        }

        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityAvailabilityAllocationLockKey({ organizationId: input.organizationId, propertyId: booking.propertyId, roomTypeId: booking.roomTypeId })}, 0))`;

        const lockedBooking = await transaction.hospitalityBooking.findFirst({
          where: { id: booking.id, organizationId: input.organizationId },
          select: { status: true, paymentStatus: true },
        });
        const lockedPayment = await transaction.paymentTransaction.findFirst({
          where: { id: payment.id, organizationId: input.organizationId, bookingId: booking.id },
          select: { status: true, providerReference: true },
        });
        const lateSuccess = await transaction.paymentTransaction.findFirst({
          where: {
            organizationId: input.organizationId,
            bookingId: booking.id,
            providerCode: STRIPE_PROVIDER_CODE,
            kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
            status: 'SUCCEEDED',
          },
          select: { id: true },
        });
        if (
          !lockedBooking
          || lockedBooking.status !== 'CONFIRMED'
          || !['UNPAID', 'FAILED'].includes(lockedBooking.paymentStatus)
          || !lockedPayment
          || lockedPayment.status !== 'PENDING'
          || !isInternalPaymentClaimReference(lockedPayment.providerReference)
          || lateSuccess
        ) {
          return persistEvent('PROCESSED', 'checkout-session-expiry-race-preserved-booking', booking.id);
        }

        await transaction.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
        await transaction.hospitalityBooking.update({
          where: { id: booking.id },
          data: { status: 'CANCELLED', cancelledAt: event.providerCreatedAt },
        });
        return persistEvent('PROCESSED', decision.note, booking.id);
      }

      return persistEvent('IGNORED', 'unsupported-checkout-session-event-type', booking.id);
    }

    if (event.refund) {
      const sourceCandidates = await transaction.paymentTransaction.findMany({
        where: {
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: event.refund.paymentIntentReference,
          kind: { in: ['CAPTURE', 'AUTHORIZATION'] },
          status: 'SUCCEEDED',
        },
        select: { id: true, bookingId: true, kind: true, status: true, providerCode: true, currency: true, amountMinor: true, providerReference: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 4,
      });
      const source = selectStripeRefundSource(sourceCandidates, { allowAuthorizationFallback: true });
      if (!source) return persistEvent('IGNORED', 'refund-source-settlement-unavailable', null);

      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', source.bookingId)}, 0))`;
      const currentSource = await transaction.paymentTransaction.findFirst({
        where: {
          id: source.id,
          organizationId: input.organizationId,
          bookingId: source.bookingId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: event.refund.paymentIntentReference,
          kind: source.kind as 'CAPTURE' | 'AUTHORIZATION',
          status: 'SUCCEEDED',
        },
      });
      const booking = await transaction.hospitalityBooking.findFirst({
        where: { id: source.bookingId, organizationId: input.organizationId },
        select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
      });
      if (!currentSource || !booking) return persistEvent('IGNORED', 'refund-booking-unavailable', source.bookingId);
      if (booking.status !== 'CONFIRMED') return persistEvent('IGNORED', 'refund-booking-not-confirmed', booking.id);
      if (source.kind === 'AUTHORIZATION' && !['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(booking.paymentStatus)) {
        return persistEvent('IGNORED', 'refund-source-authorization-not-settled', booking.id);
      }
      if (
        booking.currency !== currentSource.currency
        || booking.totalMinor !== currentSource.amountMinor
        || event.refund.currency !== booking.currency
        || event.refund.amountMinor <= 0n
        || event.refund.amountMinor > currentSource.amountMinor
      ) return persistEvent('IGNORED', 'refund-money-mismatch', booking.id);

      const pendingRefunds = await transaction.paymentTransaction.findMany({
        where: {
          organizationId: input.organizationId,
          bookingId: booking.id,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'REFUND',
          status: 'PENDING',
        },
        select: { id: true, providerReference: true, currency: true, amountMinor: true },
        orderBy: { createdAt: 'desc' },
        take: 4,
      });

      let refund;
      try {
        refund = selectStripeWebhookRefundCandidate({
          refundReference: event.refund.refundReference,
          currency: event.refund.currency,
          amountMinor: event.refund.amountMinor,
          candidates: pendingRefunds,
          isInternalReference: isInternalPaymentClaimReference,
        });
      } catch (error) {
        if (error instanceof StripeWebhookValidationError) throw new PaymentConflictError(error.message);
        throw error;
      }
      if (!refund) return persistEvent('IGNORED', 'no-pending-refund', booking.id);

      const providerReferenceConflict = await transaction.paymentTransaction.findFirst({
        where: {
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: event.refund.refundReference,
          id: { not: refund.id },
        },
        select: { id: true },
      });
      if (providerReferenceConflict) throw new PaymentConflictError('Stripe refund webhook reference has already been recorded in this organization.');

      const reconciledStatus = reconcileStripeRefundState({
        currency: refund.currency,
        amountMinor: refund.amountMinor,
        sourceProviderReference: currentSource.providerReference,
        snapshot: {
          refundReference: event.refund.refundReference,
          paymentIntentReference: event.refund.paymentIntentReference,
          status: event.refund.status,
          currency: event.refund.currency,
          amountMinor: event.refund.amountMinor,
        },
      });

      let bookingPaymentStatus = booking.paymentStatus;
      if (reconciledStatus === 'SUCCEEDED') {
        if (!['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(booking.paymentStatus)) {
          throw new PaymentConflictError(`Booking payment state ${booking.paymentStatus.toLowerCase()} cannot accept a Stripe refund webhook.`);
        }
        const previous = await transaction.paymentTransaction.aggregate({
          where: {
            organizationId: input.organizationId,
            bookingId: booking.id,
            providerCode: STRIPE_PROVIDER_CODE,
            kind: 'REFUND',
            status: 'SUCCEEDED',
            id: { not: refund.id },
          },
          _sum: { amountMinor: true },
        });
        bookingPaymentStatus = nextStripeRefundBookingPaymentStatus({
          sourceAmountMinor: currentSource.amountMinor,
          refundedBeforeMinor: previous._sum.amountMinor ?? 0n,
          refundAmountMinor: refund.amountMinor,
        });
        if (booking.paymentStatus === 'REFUNDED' && bookingPaymentStatus !== 'REFUNDED') {
          throw new PaymentConflictError('Stripe refund webhook cannot regress a fully refunded booking.');
        }
      }

      await transaction.paymentTransaction.update({
        where: { id: refund.id },
        data: { providerReference: event.refund.refundReference, status: reconciledStatus },
      });
      if (booking.paymentStatus !== bookingPaymentStatus) {
        await transaction.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: bookingPaymentStatus } });
      }
      return persistEvent(
        'PROCESSED',
        reconciledStatus === 'PENDING' ? 'refund-still-pending' : reconciledStatus === 'SUCCEEDED' ? 'refund-state-applied' : 'refund-failed',
        booking.id,
      );
    }

    if (!event.paymentIntent) return persistEvent('IGNORED', 'unsupported-event-type', null);
    if (!event.paymentIntent.organizationId || !event.paymentIntent.bookingId) {
      return persistEvent('IGNORED', 'missing-sf-metadata', event.paymentIntent.bookingId);
    }
    if (event.paymentIntent.organizationId !== input.organizationId) {
      return persistEvent('IGNORED', 'tenant-metadata-mismatch', null);
    }

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, 'booking', event.paymentIntent.bookingId)}, 0))`;
    const booking = await transaction.hospitalityBooking.findFirst({
      where: { id: event.paymentIntent.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true },
    });
    if (!booking) return persistEvent('IGNORED', 'booking-unavailable', event.paymentIntent.bookingId);
    if (booking.status !== 'CONFIRMED') return persistEvent('IGNORED', 'booking-not-confirmed', booking.id);
    if (booking.currency !== event.paymentIntent.currency || booking.totalMinor !== event.paymentIntent.amountMinor) {
      return persistEvent('IGNORED', 'booking-money-mismatch', booking.id);
    }

    const pending = await transaction.paymentTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        providerCode: STRIPE_PROVIDER_CODE,
        status: 'PENDING',
        kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
      },
      select: { id: true, kind: true, providerReference: true, currency: true, amountMinor: true },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });

    let payment;
    try {
      payment = selectStripeWebhookPaymentCandidate({
        providerReference: event.paymentIntent.providerReference,
        providerStatus: event.paymentIntent.status,
        candidates: pending.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind as 'AUTHORIZATION' | 'CAPTURE',
          providerReference: candidate.providerReference,
        })),
        isInternalReference: isInternalPaymentClaimReference,
      });
    } catch (error) {
      if (error instanceof StripeWebhookValidationError) throw new PaymentConflictError(error.message);
      throw error;
    }

    if (!payment) return persistEvent('IGNORED', 'no-pending-payment', booking.id);
    const current = pending.find((candidate) => candidate.id === payment.id);
    if (!current || current.currency !== booking.currency || current.amountMinor !== booking.totalMinor) {
      throw new PaymentConflictError('Stripe webhook payment candidate does not match the authoritative booking total.');
    }

    const checkoutSession = await transaction.paymentCheckoutSession.findUnique({
      where: {
        organizationId_paymentTransactionId: {
          organizationId: input.organizationId,
          paymentTransactionId: current.id,
        },
      },
      select: { id: true, status: true },
    });
    if (
      checkoutSession
      && checkoutSession.status === 'OPEN'
      && !['succeeded', 'requires_capture'].includes(event.paymentIntent.status)
    ) {
      return persistEvent('PROCESSED', 'checkout-payment-attempt-not-settled', booking.id);
    }

    const reconciliation = reconcileStripeTransactionState({
      kind: payment.kind,
      currency: current.currency,
      amountMinor: current.amountMinor,
      snapshot: {
        providerReference: event.paymentIntent.providerReference,
        status: event.paymentIntent.status,
        currency: event.paymentIntent.currency,
        amountMinor: event.paymentIntent.amountMinor,
        amountReceivedMinor: event.paymentIntent.amountReceivedMinor,
        amountCapturableMinor: event.paymentIntent.status === 'requires_capture'
          ? event.paymentIntent.amountMinor - event.paymentIntent.amountReceivedMinor
          : 0n,
      },
    });

    const nextBookingPaymentStatus = reconciledBookingPaymentStatus({
      kind: payment.kind,
      currentStatus: booking.paymentStatus,
      reconciledStatus: reconciliation.bookingPaymentStatus,
    });

    if (isInternalPaymentClaimReference(current.providerReference)) {
      const providerReferenceConflict = await transaction.paymentTransaction.findFirst({
        where: {
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: event.paymentIntent.providerReference,
          bookingId: { not: booking.id },
        },
        select: { id: true },
      });
      if (providerReferenceConflict) throw new PaymentConflictError('Stripe webhook provider reference belongs to another booking.');
    } else if (current.providerReference !== event.paymentIntent.providerReference) {
      throw new PaymentConflictError('Stripe webhook provider reference does not match the pending payment transaction.');
    }

    await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: {
        providerReference: event.paymentIntent.providerReference,
        status: reconciliation.transactionStatus,
      },
    });
    if (booking.paymentStatus !== nextBookingPaymentStatus) {
      await transaction.hospitalityBooking.update({ where: { id: booking.id }, data: { paymentStatus: nextBookingPaymentStatus } });
    }

    return persistEvent('PROCESSED', reconciliation.transactionStatus === 'PENDING' ? 'payment-still-pending' : 'payment-state-applied', booking.id);
  }, { isolationLevel: 'Serializable' });
}
