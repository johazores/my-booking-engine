import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripeCheckoutIntegration } from '../integrations/stripe-checkout-integration.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  StripeCommercialAmendmentRecoveryCheckoutConflictError,
  reconcileStripeCommercialAmendmentRecoveryCheckoutSnapshot,
} from './booking-commercial-amendment-stripe-recovery-checkout-reconciliation-domain.ts';
import {
  STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX,
  isStripeCheckoutSessionReference,
  stripeCommercialAmendmentRecoveryCheckoutFingerprint,
} from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';
import {
  finalizeHospitalityBookingCommercialAmendmentRecovery,
  readHospitalityBookingCommercialAmendmentRecovery,
} from './hospitality-booking-commercial-amendment-recovery-service.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

async function requireRecoveryPermissions(input: { organizationId: string; actorUserId: string }) {
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

async function lockRecoveryBooking(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
}) {
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
  })}, 0))`;
  await input.transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;
}

async function loadRecoveryClaim(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  transactionId: string;
}) {
  const payment = await input.transaction.paymentTransaction.findFirst({
    where: {
      id: input.transactionId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'CAPTURE',
    },
  });
  if (!payment) {
    throw new HospitalityBookingUnavailableError('Stripe recovery Checkout transaction is unavailable in this organization.');
  }

  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: { id: input.amendmentId, organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
      expiresAt: true,
      bookingVersion: true,
    },
  });
  const booking = await input.transaction.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: { status: true, paymentStatus: true, currency: true, totalMinor: true, updatedAt: true },
  });
  if (!amendment || !booking) {
    throw new HospitalityBookingUnavailableError('Stripe recovery Checkout ownership is unavailable in this organization.');
  }
  return { payment, amendment, booking };
}

function assertRecoveryClaim(input: {
  payment: {
    idempotencyKey: string;
    requestFingerprint: string | null;
    kind: string;
    status: string;
    providerCode: string;
    providerReference: string;
    sourceProviderReference: string | null;
    currency: string;
    amountMinor: bigint;
  };
  amendment: {
    status: string;
    direction: string;
    paymentProviderCode: string;
    currency: string;
    beforeTotalMinor: bigint;
    afterTotalMinor: bigint;
    deltaMinor: bigint;
    expiresAt: Date;
    bookingVersion: Date;
  };
  booking: {
    status: string;
    paymentStatus: string;
    currency: string;
    totalMinor: bigint;
    updatedAt: Date;
  };
  bookingId: string;
  amendmentId: string;
  now: Date;
}) {
  const { payment, amendment, booking } = input;
  if (
    amendment.status !== 'PREPARED'
    || amendment.direction !== 'REFUND'
    || amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || amendment.expiresAt.getTime() > input.now.getTime()
    || booking.status !== 'CONFIRMED'
    || booking.paymentStatus !== 'PAID'
    || booking.currency !== amendment.currency
    || booking.totalMinor !== amendment.beforeTotalMinor
    || booking.updatedAt.getTime() !== amendment.bookingVersion.getTime()
  ) {
    throw new HospitalityBookingConflictError('Stripe recovery Checkout no longer matches the expired amendment booking snapshot.');
  }
  const refundableDeltaMinor = amendment.beforeTotalMinor - amendment.afterTotalMinor;
  if (
    amendment.deltaMinor >= 0n
    || refundableDeltaMinor !== -amendment.deltaMinor
    || payment.kind !== 'CAPTURE'
    || payment.providerCode !== STRIPE_PROVIDER_CODE
    || !payment.idempotencyKey.startsWith(STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX)
    || payment.sourceProviderReference !== null
    || payment.currency !== amendment.currency
    || payment.amountMinor <= 0n
    || payment.amountMinor > refundableDeltaMinor
  ) {
    throw new HospitalityBookingConflictError('Stripe recovery Checkout claim no longer matches the amendment compensation boundary.');
  }
  const expectedFingerprint = stripeCommercialAmendmentRecoveryCheckoutFingerprint({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    currency: payment.currency,
    amountMinor: payment.amountMinor,
  });
  if (payment.requestFingerprint !== expectedFingerprint) {
    throw new PaymentConflictError('Stripe recovery Checkout request fingerprint is inconsistent.');
  }
  if (payment.status === 'AMBIGUOUS' && !isStripeCheckoutSessionReference(payment.providerReference)) {
    throw new PaymentConflictError('Stripe recovery Checkout claim is missing its Checkout Session reference.');
  }
}

async function settleRecoveryOutcome(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  const current = await readHospitalityBookingCommercialAmendmentRecovery(input);
  if (current.decision.state === 'READY_TO_EXPIRE') {
    return Object.freeze({
      state: 'RECOVERED' as const,
      recovery: await finalizeHospitalityBookingCommercialAmendmentRecovery(input),
    });
  }
  return Object.freeze({ state: current.decision.state, recovery: current.decision });
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentRecoveryCheckout(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  transactionId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  assertUuidIdentifier(input.transactionId, 'transactionId');
  await requireRecoveryPermissions(input);
  const now = input.now ?? new Date();

  const context = await db.$transaction(async (transaction) => {
    const current = await loadRecoveryClaim({ transaction, ...input });
    if (current.payment.status === 'SUCCEEDED' || current.payment.status === 'FAILED') return current;
    if (current.payment.status !== 'AMBIGUOUS') {
      throw new HospitalityBookingConflictError('Stripe recovery Checkout transaction is not in a reconcilable state.');
    }
    assertRecoveryClaim({ ...current, bookingId: input.bookingId, amendmentId: input.amendmentId, now });
    return current;
  }, { isolationLevel: 'Serializable' });

  if (context.payment.status === 'SUCCEEDED' || context.payment.status === 'FAILED') {
    return settleRecoveryOutcome(input);
  }

  const stripe = await loadStripeCheckoutIntegration(input.organizationId);
  const snapshot = await stripe.provider.retrievePaymentSession(context.payment.providerReference);
  let reconciliation;
  try {
    reconciliation = reconcileStripeCommercialAmendmentRecoveryCheckoutSnapshot({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      checkoutReference: context.payment.providerReference,
      currency: context.payment.currency,
      amountMinor: context.payment.amountMinor,
      snapshot,
    });
  } catch (error) {
    throw new HospitalityBookingConflictError(
      error instanceof StripeCommercialAmendmentRecoveryCheckoutConflictError
        ? error.message
        : 'Stripe recovery Checkout provider truth is invalid.',
    );
  }

  const persisted = await db.$transaction(async (transaction) => {
    await lockRecoveryBooking({ transaction, organizationId: input.organizationId, bookingId: input.bookingId });
    const current = await loadRecoveryClaim({ transaction, ...input });
    if (current.payment.status === 'SUCCEEDED' || current.payment.status === 'FAILED') {
      return { payment: current.payment, state: current.payment.status === 'SUCCEEDED' ? 'PAID' as const : 'EXPIRED' as const };
    }
    assertRecoveryClaim({ ...current, bookingId: input.bookingId, amendmentId: input.amendmentId, now });
    if (current.payment.providerReference !== reconciliation.checkoutReference) {
      throw new PaymentConflictError('Stripe recovery Checkout Session changed during provider reconciliation.');
    }

    if (reconciliation.transactionStatus === 'AMBIGUOUS') {
      return { payment: current.payment, state: 'WAIT_FOR_PROVIDER' as const };
    }

    if (reconciliation.transactionStatus === 'SUCCEEDED') {
      if (!reconciliation.paymentIntentReference) {
        throw new PaymentConflictError('Paid Stripe recovery Checkout reconciliation is missing its PaymentIntent reference.');
      }
      const duplicate = await transaction.paymentTransaction.findFirst({
        where: {
          organizationId: input.organizationId,
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: reconciliation.paymentIntentReference,
          id: { not: current.payment.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new PaymentConflictError('Stripe recovery Checkout PaymentIntent is already bound to another payment transaction.');
      }
    }

    const updated = await transaction.paymentTransaction.update({
      where: { id: current.payment.id },
      data: {
        status: reconciliation.transactionStatus,
        providerReference: reconciliation.paymentIntentReference ?? current.payment.providerReference,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: reconciliation.transactionStatus === 'SUCCEEDED'
          ? 'payment.commercial-amendment.stripe-recovery-checkout-paid'
          : 'payment.commercial-amendment.stripe-recovery-checkout-expired',
        resourceType: 'payment-transaction',
        resourceId: updated.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'CAPTURE',
          status: updated.status,
          checkoutSessionReference: reconciliation.checkoutReference,
          providerReference: updated.providerReference,
          currency: updated.currency,
          amountMinor: updated.amountMinor.toString(),
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
    return { payment: updated, state: reconciliation.state };
  }, { isolationLevel: 'Serializable' });

  if (persisted.payment.status === 'SUCCEEDED' || persisted.payment.status === 'FAILED') {
    return settleRecoveryOutcome(input);
  }
  return Object.freeze({ state: persisted.state, payment: persisted.payment });
}
