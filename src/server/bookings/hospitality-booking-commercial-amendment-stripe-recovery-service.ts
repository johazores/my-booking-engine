import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import {
  PaymentProviderError,
  assertPaymentProviderCapability,
  type ProviderPaymentResult,
  type ProviderRefundResult,
} from '../payments/payment-provider.ts';
import { isInternalPaymentClaimReference } from '../payments/stripe-payment-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCommercialAmendmentRecoveryDecision,
  type HospitalityCommercialAmendmentRecoveryDecision,
} from './booking-commercial-amendment-recovery-domain.ts';
import {
  reconcileStripeCommercialAmendmentChargeSnapshot,
  stripeCommercialAmendmentChargeFingerprint,
  stripeCommercialAmendmentChargePersistenceStatus,
  stripeCommercialAmendmentDirectCaptureIdempotencyKey,
} from './booking-commercial-amendment-stripe-charge-domain.ts';
import {
  reconcileStripeCommercialAmendmentRefundSnapshot,
  stripeCommercialAmendmentRefundPersistenceStatus,
} from './booking-commercial-amendment-stripe-refund-domain.ts';
import {
  assertStripeCommercialAmendmentRecoveryRefundReference,
  reconcileStripeCommercialAmendmentRecoveryAuthorization,
  stripeCommercialAmendmentRecoveryClaimReference,
  stripeCommercialAmendmentRecoveryFingerprint,
  stripeCommercialAmendmentRecoveryOperationKey,
  type StripeCommercialAmendmentRecoveryOperation,
} from './booking-commercial-amendment-stripe-recovery-domain.ts';
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
const STRIPE_PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const RECOVERY_IDEMPOTENCY_PREFIX = 'ca-stripe-recovery-';

type RecoveryContext = Awaited<ReturnType<typeof loadRecoveryContext>>;
type RecoveryTransaction = RecoveryContext['transactions'][number];

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function idempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `payment:${organizationId}:idempotency:${idempotencyKey}`;
}

async function requireRecoveryPermissions(input: { organizationId: string; actorUserId: string }) {
  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'payment:manage',
    }),
  ]);
}

async function loadRecoveryContext(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
}) {
  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: {
      id: input.amendmentId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    },
    select: {
      id: true,
      status: true,
      direction: true,
      paymentProviderCode: true,
      currency: true,
      beforeTotalMinor: true,
      afterTotalMinor: true,
      deltaMinor: true,
      createdAt: true,
      expiresAt: true,
      bookingVersion: true,
    },
  });
  if (!amendment) {
    throw new HospitalityBookingUnavailableError(
      'Commercial amendment is not available in this organization.',
    );
  }

  const booking = await input.transaction.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      currency: true,
      totalMinor: true,
      updatedAt: true,
    },
  });
  if (!booking) throw new HospitalityBookingUnavailableError();

  const transactions = await input.transaction.paymentTransaction.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      id: true,
      bookingId: true,
      commercialAmendmentId: true,
      idempotencyKey: true,
      requestFingerprint: true,
      kind: true,
      status: true,
      providerCode: true,
      providerReference: true,
      sourceProviderReference: true,
      currency: true,
      amountMinor: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return { amendment, booking, transactions };
}

function assertStripeRecoveryContext(context: RecoveryContext) {
  if (context.amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment recovery is not assigned to Stripe.',
    );
  }
  if (
    context.booking.status !== 'CONFIRMED'
    || context.booking.paymentStatus !== 'PAID'
    || context.booking.currency !== context.amendment.currency
    || context.booking.totalMinor !== context.amendment.beforeTotalMinor
    || context.booking.updatedAt.getTime() !== context.amendment.bookingVersion.getTime()
  ) {
    throw new HospitalityBookingConflictError(
      'Booking changed after this commercial amendment was prepared. Stripe recovery requires operator reconciliation before more money can move.',
    );
  }
}

function deriveRecoveryDecision(context: RecoveryContext, now: Date) {
  return deriveHospitalityCommercialAmendmentRecoveryDecision({
    amendmentId: context.amendment.id,
    status: context.amendment.status,
    direction: context.amendment.direction,
    paymentProviderCode: context.amendment.paymentProviderCode,
    currency: context.amendment.currency,
    beforeTotalMinor: context.amendment.beforeTotalMinor,
    afterTotalMinor: context.amendment.afterTotalMinor,
    deltaMinor: context.amendment.deltaMinor,
    createdAt: context.amendment.createdAt,
    expiresAt: context.amendment.expiresAt,
    now,
    transactions: context.transactions,
  });
}

function decisionReason(decision: HospitalityCommercialAmendmentRecoveryDecision) {
  return 'reason' in decision
    ? decision.reason
    : 'Commercial amendment recovery cannot continue in its current state.';
}

function operationForTransaction(transaction: RecoveryTransaction): StripeCommercialAmendmentRecoveryOperation | null {
  if (transaction.kind === 'CAPTURE') return 'CAPTURE_COMPENSATION';
  if (transaction.kind === 'REFUND') return 'COMPENSATION_REFUND';
  return null;
}

function recoveryProviderReference(transaction: RecoveryTransaction) {
  if (transaction.kind === 'REFUND') {
    if (!transaction.sourceProviderReference) {
      throw new HospitalityBookingConflictError(
        'Stripe recovery refund is missing settlement-source attribution.',
      );
    }
    return transaction.sourceProviderReference;
  }
  return transaction.providerReference;
}

function assertRecoveryClaim(transaction: RecoveryTransaction, amendmentId: string) {
  const operation = operationForTransaction(transaction);
  if (
    !operation
    || transaction.commercialAmendmentId !== amendmentId
    || transaction.providerCode !== STRIPE_PROVIDER_CODE
    || transaction.amountMinor <= 0n
  ) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment Stripe recovery claim is inconsistent.',
    );
  }
  const providerReference = recoveryProviderReference(transaction);
  const fingerprint = stripeCommercialAmendmentRecoveryFingerprint({
    bookingId: transaction.bookingId,
    amendmentId,
    operation,
    currency: transaction.currency,
    amountMinor: transaction.amountMinor,
    providerReference,
  });
  const expectedIdempotencyKey = stripeCommercialAmendmentRecoveryOperationKey({
    bookingId: transaction.bookingId,
    amendmentId,
    operation,
    providerReference,
  });
  if (
    transaction.requestFingerprint !== fingerprint
    || transaction.idempotencyKey !== expectedIdempotencyKey
  ) {
    throw new HospitalityBookingConflictError(
      'Commercial amendment Stripe recovery claim identity is inconsistent.',
    );
  }
  return { operation, providerReference, fingerprint, expectedIdempotencyKey };
}

function unresolvedRecoveryClaims(context: RecoveryContext) {
  return context.transactions.filter((entry) => (
    entry.commercialAmendmentId === context.amendment.id
    && (entry.status === 'PENDING' || entry.status === 'AMBIGUOUS')
    && entry.idempotencyKey.startsWith(RECOVERY_IDEMPOTENCY_PREFIX)
  ));
}

async function persistDirectSettlementCapture(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  currency: string;
  amountMinor: bigint;
  providerReference: string;
}) {
  const idempotencyKey = stripeCommercialAmendmentDirectCaptureIdempotencyKey({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    providerReference: input.providerReference,
  });
  const requestFingerprint = stripeCommercialAmendmentChargeFingerprint({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    stage: 'CAPTURE',
    currency: input.currency,
    amountMinor: input.amountMinor,
    providerReference: input.providerReference,
  });
  const existing = await input.transaction.paymentTransaction.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey,
      },
    },
  });
  if (existing) {
    if (
      existing.bookingId !== input.bookingId
      || existing.commercialAmendmentId !== input.amendmentId
      || existing.kind !== 'CAPTURE'
      || existing.status !== 'SUCCEEDED'
      || existing.providerCode !== STRIPE_PROVIDER_CODE
      || existing.providerReference !== input.providerReference
      || existing.sourceProviderReference !== null
      || existing.currency !== input.currency
      || existing.amountMinor !== input.amountMinor
      || existing.requestFingerprint !== requestFingerprint
    ) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment direct Stripe settlement evidence is inconsistent.',
      );
    }
    return existing;
  }

  const duplicateReferences = await input.transaction.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      providerCode: STRIPE_PROVIDER_CODE,
      providerReference: input.providerReference,
    },
    select: { bookingId: true, commercialAmendmentId: true },
    take: 8,
  });
  if (duplicateReferences.some((entry) => (
    entry.bookingId !== input.bookingId
    || entry.commercialAmendmentId !== input.amendmentId
  ))) {
    throw new HospitalityBookingConflictError(
      'Stripe PaymentIntent reference is already recorded outside this commercial amendment.',
    );
  }

  const capture = await input.transaction.paymentTransaction.create({
    data: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      idempotencyKey,
      requestFingerprint,
      kind: 'CAPTURE',
      status: 'SUCCEEDED',
      providerCode: STRIPE_PROVIDER_CODE,
      providerReference: input.providerReference,
      currency: input.currency,
      amountMinor: input.amountMinor,
    },
  });
  await input.transaction.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-recovery-settlement-discovered',
      resourceType: 'payment-transaction',
      resourceId: capture.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: 'CAPTURE',
        status: 'SUCCEEDED',
        currency: input.currency,
        amountMinor: input.amountMinor.toString(),
        bookingPaymentStatePreservedUntilRecoveryCompletes: true,
      },
    },
  });
  return capture;
}

async function persistReleasedAuthorization(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}) {
  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.organizationId,
      input.bookingId,
    )}, 0))`;

    const capture = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: input.providerReference,
        kind: 'CAPTURE',
        status: 'SUCCEEDED',
      },
      select: { id: true },
    });
    if (capture) {
      return { released: false as const, settledInstead: true as const };
    }

    const authorization = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: input.providerReference,
        kind: 'AUTHORIZATION',
      },
    });
    if (!authorization) {
      throw new HospitalityBookingUnavailableError(
        'Commercial amendment Stripe authorization is unavailable in this organization.',
      );
    }
    if (
      authorization.currency !== input.currency
      || authorization.amountMinor !== input.amountMinor
      || authorization.sourceProviderReference !== null
    ) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment Stripe authorization changed before release could be recorded.',
      );
    }
    if (authorization.status === 'FAILED') {
      return { released: true as const, settledInstead: false as const, idempotent: true as const };
    }
    if (authorization.status !== 'SUCCEEDED') {
      throw new HospitalityBookingConflictError(
        'Commercial amendment Stripe authorization is no longer a releasable successful authorization.',
      );
    }

    const updated = await transaction.paymentTransaction.update({
      where: { id: authorization.id },
      data: { status: 'FAILED' },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.commercial-amendment.stripe-authorization-released',
        resourceType: 'payment-transaction',
        resourceId: updated.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'AUTHORIZATION',
          status: 'FAILED',
          providerReference: input.providerReference,
          currency: input.currency,
          amountMinor: input.amountMinor.toString(),
          releaseReason: 'expired-commercial-amendment',
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
    return { released: true as const, settledInstead: false as const, idempotent: false as const };
  }, { isolationLevel: 'Serializable' });
}

async function persistAuthorizationSettled(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}) {
  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.organizationId,
      input.bookingId,
    )}, 0))`;

    const authorization = await transaction.paymentTransaction.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: input.providerReference,
        kind: 'AUTHORIZATION',
        status: 'SUCCEEDED',
      },
    });
    if (!authorization) {
      throw new HospitalityBookingUnavailableError(
        'Commercial amendment Stripe authorization is unavailable for settlement recovery.',
      );
    }
    if (
      authorization.currency !== input.currency
      || authorization.amountMinor !== input.amountMinor
      || authorization.sourceProviderReference !== null
    ) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment Stripe authorization changed during provider reconciliation.',
      );
    }

    return persistDirectSettlementCapture({
      transaction,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      currency: input.currency,
      amountMinor: input.amountMinor,
      providerReference: input.providerReference,
    });
  }, { isolationLevel: 'Serializable' });
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
    return {
      state: 'RECOVERED' as const,
      recovery: await finalizeHospitalityBookingCommercialAmendmentRecovery(input),
    };
  }
  return { state: current.decision.state, recovery: current.decision };
}

async function markRecoveryClaimFailed(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  paymentId: string;
}) {
  await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.organizationId,
      input.bookingId,
    )}, 0))`;
    const payment = await transaction.paymentTransaction.findFirst({
      where: {
        id: input.paymentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
      },
    });
    if (!payment || payment.status !== 'AMBIGUOUS' || !payment.idempotencyKey.startsWith(RECOVERY_IDEMPOTENCY_PREFIX)) {
      return;
    }
    if (payment.kind === 'REFUND' && !isInternalPaymentClaimReference(payment.providerReference)) {
      return;
    }
    const updated = await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.commercial-amendment.stripe-recovery-failed',
        resourceType: 'payment-transaction',
        resourceId: updated.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: updated.kind,
          status: 'FAILED',
          sourceProviderReference: updated.sourceProviderReference,
          currency: updated.currency,
          amountMinor: updated.amountMinor.toString(),
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
  }, { isolationLevel: 'Serializable' });
}

async function persistRecoveryProviderResult(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  paymentId: string;
  providerResult: ProviderPaymentResult | ProviderRefundResult;
}) {
  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.organizationId,
      input.bookingId,
    )}, 0))`;
    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: input.paymentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
      },
    });
    if (!current) {
      throw new HospitalityBookingUnavailableError(
        'Commercial amendment Stripe recovery payment claim is unavailable.',
      );
    }
    const claim = assertRecoveryClaim(current, input.amendmentId);
    if (current.status !== 'AMBIGUOUS') {
      return { payment: current, idempotent: true as const };
    }

    if (current.kind === 'CAPTURE') {
      const result = input.providerResult as ProviderPaymentResult;
      if (
        claim.operation !== 'CAPTURE_COMPENSATION'
        || result.providerCode !== STRIPE_PROVIDER_CODE
        || result.providerReference !== claim.providerReference
        || result.money.currency !== current.currency
        || result.money.amountMinor !== current.amountMinor
      ) {
        throw new HospitalityBookingConflictError(
          'Stripe compensation capture result does not match the persisted recovery claim.',
        );
      }
      const persistence = stripeCommercialAmendmentChargePersistenceStatus({
        stage: 'CAPTURE',
        providerStatus: result.status,
      });
      const updated = await transaction.paymentTransaction.update({
        where: { id: current.id },
        data: { status: persistence.transactionStatus },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'payment.commercial-amendment.stripe-recovery-capture-recorded',
          resourceType: 'payment-transaction',
          resourceId: updated.id,
          afterData: {
            bookingId: input.bookingId,
            commercialAmendmentId: input.amendmentId,
            providerCode: STRIPE_PROVIDER_CODE,
            kind: 'CAPTURE',
            status: updated.status,
            providerReference: updated.providerReference,
            currency: updated.currency,
            amountMinor: updated.amountMinor.toString(),
            bookingPaymentStatePreservedUntilRecoveryCompletes: true,
          },
        },
      });
      return { payment: updated, idempotent: false as const };
    }

    if (current.kind !== 'REFUND' || claim.operation !== 'COMPENSATION_REFUND') {
      throw new HospitalityBookingConflictError(
        'Commercial amendment Stripe recovery claim has an unsupported operation.',
      );
    }
    const result = input.providerResult as ProviderRefundResult;
    if (
      result.providerCode !== STRIPE_PROVIDER_CODE
      || result.providerReference !== claim.providerReference
      || result.money.currency !== current.currency
      || result.money.amountMinor !== current.amountMinor
    ) {
      throw new HospitalityBookingConflictError(
        'Stripe compensation refund result does not match the persisted recovery claim.',
      );
    }
    let refundReference: string;
    try {
      refundReference = assertStripeCommercialAmendmentRecoveryRefundReference(result.refundReference);
    } catch (error) {
      throw new HospitalityBookingConflictError(
        error instanceof Error ? error.message : 'Stripe compensation refund reference is invalid.',
      );
    }
    const status = stripeCommercialAmendmentRefundPersistenceStatus(result.status);
    const updated = await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: {
        providerReference: refundReference,
        status,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.commercial-amendment.stripe-recovery-refund-recorded',
        resourceType: 'payment-transaction',
        resourceId: updated.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: 'REFUND',
          status: updated.status,
          providerReference: updated.providerReference,
          sourceProviderReference: updated.sourceProviderReference,
          currency: updated.currency,
          amountMinor: updated.amountMinor.toString(),
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
    return { payment: updated, idempotent: false as const };
  }, { isolationLevel: 'Serializable' });
}

export async function executeStripeHospitalityBookingCommercialAmendmentRecovery(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  await requireRecoveryPermissions(input);
  const now = input.now ?? new Date();

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  assertPaymentProviderCapability(stripe.provider, 'RELEASE_AUTHORIZATION');
  assertPaymentProviderCapability(stripe.provider, 'CAPTURE');
  assertPaymentProviderCapability(stripe.provider, 'REFUND');
  if (
    !stripe.provider.releaseAuthorization
    || !stripe.provider.capturePayment
    || !stripe.provider.refundPayment
  ) {
    throw new HospitalityBookingConflictError(
      'Stripe integration does not support the required commercial amendment recovery operations.',
    );
  }

  const action = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.organizationId,
      input.bookingId,
    )}, 0))`;

    const context = await loadRecoveryContext({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
    });
    if (context.amendment.status === 'EXPIRED') {
      return { kind: 'TERMINAL' as const, state: 'EXPIRED' as const };
    }
    assertStripeRecoveryContext(context);

    const unresolvedClaims = unresolvedRecoveryClaims(context);
    if (unresolvedClaims.length > 1) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment has multiple unresolved Stripe recovery operations.',
      );
    }
    const unresolvedClaim = unresolvedClaims[0];
    if (unresolvedClaim) {
      const claim = assertRecoveryClaim(unresolvedClaim, context.amendment.id);
      if (unresolvedClaim.kind === 'CAPTURE') {
        if (!STRIPE_PAYMENT_INTENT_PATTERN.test(unresolvedClaim.providerReference)) {
          throw new HospitalityBookingConflictError(
            'Stripe recovery capture is missing its PaymentIntent reference.',
          );
        }
        return { kind: 'RECONCILE' as const, transactionId: unresolvedClaim.id };
      }
      if (unresolvedClaim.kind !== 'REFUND') {
        throw new HospitalityBookingConflictError(
          'Commercial amendment Stripe recovery has an unsupported unresolved operation.',
        );
      }
      if (!isInternalPaymentClaimReference(unresolvedClaim.providerReference)) {
        return { kind: 'RECONCILE' as const, transactionId: unresolvedClaim.id };
      }

      const withoutClaim = {
        ...context,
        transactions: context.transactions.filter((entry) => entry.id !== unresolvedClaim.id),
      };
      const decision = deriveRecoveryDecision(withoutClaim, now);
      if (
        decision.state !== 'COMPENSATE'
        || decision.operation !== 'REFUND'
        || decision.providerCode !== STRIPE_PROVIDER_CODE
        || decision.sourceProviderReference !== claim.providerReference
        || decision.currency !== unresolvedClaim.currency
        || decision.amountMinor !== unresolvedClaim.amountMinor
      ) {
        throw new HospitalityBookingConflictError(
          'Stripe compensation refund retry no longer matches authoritative recovery state.',
        );
      }
      return {
        kind: 'REFUND' as const,
        payment: unresolvedClaim,
        decision,
        idempotencyKey: unresolvedClaim.idempotencyKey,
      };
    }

    const decision = deriveRecoveryDecision(context, now);
    if (decision.state === 'READY_TO_EXPIRE') {
      return { kind: 'FINALIZE' as const };
    }
    if (decision.state === 'RELEASE_AUTHORIZATION') {
      return {
        kind: 'RELEASE' as const,
        decision,
        idempotencyKey: stripeCommercialAmendmentRecoveryOperationKey({
          bookingId: input.bookingId,
          amendmentId: input.amendmentId,
          operation: 'RELEASE_AUTHORIZATION',
          providerReference: decision.providerReference,
        }),
      };
    }
    if (decision.state === 'CAPTURE_COMPENSATION') {
      const operation = 'CAPTURE_COMPENSATION' as const;
      const idempotencyKey = stripeCommercialAmendmentRecoveryOperationKey({
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        operation,
        providerReference: decision.providerReference,
      });
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(
        input.organizationId,
        idempotencyKey,
      )}, 0))`;
      const requestFingerprint = stripeCommercialAmendmentRecoveryFingerprint({
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        operation,
        currency: decision.currency,
        amountMinor: decision.amountMinor,
        providerReference: decision.providerReference,
      });
      const existing = await transaction.paymentTransaction.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        assertRecoveryClaim(existing, input.amendmentId);
        if (existing.status === 'AMBIGUOUS') {
          return { kind: 'RECONCILE' as const, transactionId: existing.id };
        }
        return { kind: 'REREAD' as const };
      }
      const payment = await transaction.paymentTransaction.create({
        data: {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          idempotencyKey,
          requestFingerprint,
          kind: 'CAPTURE',
          status: 'AMBIGUOUS',
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: decision.providerReference,
          currency: decision.currency,
          amountMinor: decision.amountMinor,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'payment.commercial-amendment.stripe-recovery-capture-claimed',
          resourceType: 'payment-transaction',
          resourceId: payment.id,
          afterData: {
            bookingId: input.bookingId,
            commercialAmendmentId: input.amendmentId,
            providerCode: STRIPE_PROVIDER_CODE,
            kind: 'CAPTURE',
            status: 'AMBIGUOUS',
            providerReference: decision.providerReference,
            currency: decision.currency,
            amountMinor: decision.amountMinor.toString(),
            bookingPaymentStatePreservedUntilRecoveryCompletes: true,
          },
        },
      });
      return { kind: 'CAPTURE' as const, payment, decision, idempotencyKey };
    }
    if (
      decision.state === 'COMPENSATE'
      && decision.operation === 'REFUND'
      && decision.providerCode === STRIPE_PROVIDER_CODE
    ) {
      if (
        decision.sourceKind !== 'CAPTURE'
        && decision.sourceKind !== 'AUTHORIZATION'
      ) {
        throw new HospitalityBookingConflictError(
          'Stripe compensation refund requires a Stripe PaymentIntent settlement source.',
        );
      }
      const operation = 'COMPENSATION_REFUND' as const;
      const idempotencyKey = stripeCommercialAmendmentRecoveryOperationKey({
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        operation,
        providerReference: decision.sourceProviderReference,
      });
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(
        input.organizationId,
        idempotencyKey,
      )}, 0))`;
      const requestFingerprint = stripeCommercialAmendmentRecoveryFingerprint({
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        operation,
        currency: decision.currency,
        amountMinor: decision.amountMinor,
        providerReference: decision.sourceProviderReference,
      });
      const existing = await transaction.paymentTransaction.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        assertRecoveryClaim(existing, input.amendmentId);
        if (existing.status === 'AMBIGUOUS') {
          if (isInternalPaymentClaimReference(existing.providerReference)) {
            return { kind: 'REFUND' as const, payment: existing, decision, idempotencyKey };
          }
          return { kind: 'RECONCILE' as const, transactionId: existing.id };
        }
        return { kind: 'REREAD' as const };
      }
      const payment = await transaction.paymentTransaction.create({
        data: {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          idempotencyKey,
          requestFingerprint,
          kind: 'REFUND',
          status: 'AMBIGUOUS',
          providerCode: STRIPE_PROVIDER_CODE,
          providerReference: stripeCommercialAmendmentRecoveryClaimReference(requestFingerprint),
          sourceProviderReference: decision.sourceProviderReference,
          currency: decision.currency,
          amountMinor: decision.amountMinor,
        },
      });
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'payment.commercial-amendment.stripe-recovery-refund-claimed',
          resourceType: 'payment-transaction',
          resourceId: payment.id,
          afterData: {
            bookingId: input.bookingId,
            commercialAmendmentId: input.amendmentId,
            providerCode: STRIPE_PROVIDER_CODE,
            kind: 'REFUND',
            status: 'AMBIGUOUS',
            sourceProviderReference: decision.sourceProviderReference,
            currency: decision.currency,
            amountMinor: decision.amountMinor.toString(),
            bookingPaymentStatePreservedUntilRecoveryCompletes: true,
          },
        },
      });
      return { kind: 'REFUND' as const, payment, decision, idempotencyKey };
    }
    if (
      decision.state === 'COMPENSATE'
      && decision.operation === 'ADDITIONAL_CHARGE'
      && decision.providerCode === STRIPE_PROVIDER_CODE
    ) {
      return {
        kind: 'CUSTOMER_AUTHORITY_REQUIRED' as const,
        decision,
        reason: 'Stripe refund compensation requires fresh customer payment authority before SF can create another charge.',
      };
    }
    if (decision.state === 'WAIT_FOR_PROVIDER') {
      return { kind: 'WAIT' as const, decision };
    }
    throw new HospitalityBookingConflictError(decisionReason(decision));
  }, { isolationLevel: 'Serializable' });

  if (action.kind === 'TERMINAL') return action;
  if (action.kind === 'FINALIZE') {
    return {
      state: 'RECOVERED' as const,
      recovery: await finalizeHospitalityBookingCommercialAmendmentRecovery(input),
    };
  }
  if (action.kind === 'REREAD') return settleRecoveryOutcome(input);
  if (action.kind === 'RECONCILE') {
    return reconcileStripeHospitalityBookingCommercialAmendmentRecovery({
      ...input,
      transactionId: action.transactionId,
    });
  }
  if (action.kind === 'WAIT' || action.kind === 'CUSTOMER_AUTHORITY_REQUIRED') {
    return action;
  }

  if (action.kind === 'RELEASE' || action.kind === 'CAPTURE') {
    const snapshot = await stripe.reconciliationProvider.retrievePaymentIntent(
      action.decision.providerReference,
    );
    let providerState;
    try {
      providerState = reconcileStripeCommercialAmendmentRecoveryAuthorization({
        providerReference: action.decision.providerReference,
        currency: action.decision.currency,
        amountMinor: action.decision.amountMinor,
        snapshot,
      });
    } catch (error) {
      throw new HospitalityBookingConflictError(
        error instanceof Error
          ? error.message
          : 'Stripe authorization recovery evidence is invalid.',
      );
    }
    if (providerState.state === 'RELEASED') {
      await persistReleasedAuthorization({
        ...input,
        providerReference: action.decision.providerReference,
        currency: action.decision.currency,
        amountMinor: action.decision.amountMinor,
      });
      return settleRecoveryOutcome(input);
    }
    if (providerState.state === 'SETTLED') {
      await persistAuthorizationSettled({
        ...input,
        providerReference: action.decision.providerReference,
        currency: action.decision.currency,
        amountMinor: action.decision.amountMinor,
      });
      return settleRecoveryOutcome(input);
    }
    if (providerState.state === 'WAIT_FOR_PROVIDER') {
      return {
        state: 'WAIT_FOR_PROVIDER' as const,
        providerStatus: providerState.providerStatus,
      };
    }

    if (action.kind === 'RELEASE') {
      const result = await stripe.provider.releaseAuthorization!({
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        idempotencyKey: action.idempotencyKey,
        money: {
          currency: action.decision.currency,
          amountMinor: action.decision.amountMinor,
        },
        providerReference: action.decision.providerReference,
      });
      if (
        result.providerCode !== STRIPE_PROVIDER_CODE
        || result.providerReference !== action.decision.providerReference
        || result.money.currency !== action.decision.currency
        || result.money.amountMinor !== action.decision.amountMinor
        || result.status !== 'FAILED'
      ) {
        throw new HospitalityBookingConflictError(
          'Stripe did not return definitive authorization-release evidence for this commercial amendment.',
        );
      }
      await persistReleasedAuthorization({
        ...input,
        providerReference: action.decision.providerReference,
        currency: action.decision.currency,
        amountMinor: action.decision.amountMinor,
      });
      return settleRecoveryOutcome(input);
    }

    let providerResult: ProviderPaymentResult;
    try {
      providerResult = await stripe.provider.capturePayment!({
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        idempotencyKey: action.idempotencyKey,
        money: {
          currency: action.decision.currency,
          amountMinor: action.decision.amountMinor,
        },
        providerReference: action.decision.providerReference,
      });
    } catch (error) {
      if (error instanceof PaymentProviderError && !error.retryable) {
        await markRecoveryClaimFailed({
          ...input,
          paymentId: action.payment.id,
        });
      }
      throw error;
    }
    const persisted = await persistRecoveryProviderResult({
      ...input,
      paymentId: action.payment.id,
      providerResult,
    });
    if (persisted.payment.status === 'SUCCEEDED') return settleRecoveryOutcome(input);
    return {
      state: persisted.payment.status === 'FAILED' ? 'FAILED' as const : 'WAIT_FOR_PROVIDER' as const,
      payment: persisted.payment,
    };
  }

  let refundResult: ProviderRefundResult;
  try {
    refundResult = await stripe.provider.refundPayment!({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      idempotencyKey: action.idempotencyKey,
      money: {
        currency: action.decision.currency,
        amountMinor: action.decision.amountMinor,
      },
      providerReference: action.decision.sourceProviderReference,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markRecoveryClaimFailed({
        ...input,
        paymentId: action.payment.id,
      });
    }
    throw error;
  }
  const persisted = await persistRecoveryProviderResult({
    ...input,
    paymentId: action.payment.id,
    providerResult: refundResult,
  });
  if (persisted.payment.status === 'SUCCEEDED') return settleRecoveryOutcome(input);
  return {
    state: persisted.payment.status === 'FAILED' ? 'FAILED' as const : 'WAIT_FOR_PROVIDER' as const,
    payment: persisted.payment,
  };
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentRecovery(input: {
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

  const payment = await db.paymentTransaction.findFirst({
    where: {
      id: input.transactionId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
    },
  });
  if (!payment) {
    throw new HospitalityBookingUnavailableError(
      'Commercial amendment Stripe recovery transaction is unavailable in this organization.',
    );
  }
  if (!payment.idempotencyKey.startsWith(RECOVERY_IDEMPOTENCY_PREFIX)) {
    throw new HospitalityBookingConflictError(
      'Payment transaction is not owned by the Stripe commercial amendment recovery lifecycle.',
    );
  }
  if (payment.status !== 'AMBIGUOUS') return settleRecoveryOutcome(input);

  const claim = assertRecoveryClaim(payment, input.amendmentId);
  const stripe = await loadStripePaymentIntegration(input.organizationId);

  let status: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  let providerStatus: string;
  if (payment.kind === 'CAPTURE') {
    if (!STRIPE_PAYMENT_INTENT_PATTERN.test(payment.providerReference)) {
      throw new HospitalityBookingConflictError(
        'Stripe compensation capture has no provider reference for reconciliation.',
      );
    }
    const snapshot = await stripe.reconciliationProvider.retrievePaymentIntent(
      payment.providerReference,
    );
    providerStatus = snapshot.status;
    try {
      status = reconcileStripeCommercialAmendmentChargeSnapshot({
        stage: 'CAPTURE',
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        providerReference: payment.providerReference,
        snapshot,
      }).transactionStatus;
    } catch (error) {
      throw new HospitalityBookingConflictError(
        error instanceof Error
          ? error.message
          : 'Stripe compensation capture reconciliation evidence is invalid.',
      );
    }
  } else if (payment.kind === 'REFUND') {
    if (isInternalPaymentClaimReference(payment.providerReference)) {
      throw new HospitalityBookingConflictError(
        'Stripe compensation refund has no provider refund reference yet. Retry the exact recovery operation to recover provider truth.',
      );
    }
    let refundReference: string;
    try {
      refundReference = assertStripeCommercialAmendmentRecoveryRefundReference(
        payment.providerReference,
      );
    } catch (error) {
      throw new HospitalityBookingConflictError(
        error instanceof Error
          ? error.message
          : 'Stripe compensation refund reference is invalid.',
      );
    }
    const snapshot = await stripe.refundReconciliationProvider.retrieveRefund(refundReference);
    providerStatus = snapshot.status;
    try {
      status = reconcileStripeCommercialAmendmentRefundSnapshot({
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        sourceProviderReference: claim.providerReference,
        snapshot,
      });
    } catch (error) {
      throw new HospitalityBookingConflictError(
        error instanceof Error
          ? error.message
          : 'Stripe compensation refund reconciliation evidence is invalid.',
      );
    }
  } else {
    throw new HospitalityBookingConflictError(
      'Commercial amendment Stripe recovery transaction has an unsupported kind.',
    );
  }

  const updated = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(
      input.organizationId,
      input.bookingId,
    )}, 0))`;
    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: payment.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
      },
    });
    if (!current) {
      throw new HospitalityBookingUnavailableError(
        'Commercial amendment Stripe recovery transaction became unavailable.',
      );
    }
    if (current.status !== 'AMBIGUOUS') return current;
    if (
      current.kind !== payment.kind
      || current.providerReference !== payment.providerReference
      || current.sourceProviderReference !== payment.sourceProviderReference
      || current.requestFingerprint !== payment.requestFingerprint
      || current.currency !== payment.currency
      || current.amountMinor !== payment.amountMinor
    ) {
      throw new HospitalityBookingConflictError(
        'Commercial amendment Stripe recovery transaction changed during reconciliation.',
      );
    }
    assertRecoveryClaim(current, input.amendmentId);
    const persisted = await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: { status },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.commercial-amendment.stripe-recovery-reconciled',
        resourceType: 'payment-transaction',
        resourceId: persisted.id,
        afterData: {
          bookingId: input.bookingId,
          commercialAmendmentId: input.amendmentId,
          providerCode: STRIPE_PROVIDER_CODE,
          kind: persisted.kind,
          status: persisted.status,
          providerStatus,
          providerReference: persisted.providerReference,
          sourceProviderReference: persisted.sourceProviderReference,
          currency: persisted.currency,
          amountMinor: persisted.amountMinor.toString(),
          bookingPaymentStatePreservedUntilRecoveryCompletes: true,
        },
      },
    });
    return persisted;
  }, { isolationLevel: 'Serializable' });

  if (updated.status === 'SUCCEEDED' || updated.status === 'FAILED') {
    return {
      payment: updated,
      recovery: await settleRecoveryOutcome(input),
    };
  }
  return { payment: updated, state: 'WAIT_FOR_PROVIDER' as const };
}
