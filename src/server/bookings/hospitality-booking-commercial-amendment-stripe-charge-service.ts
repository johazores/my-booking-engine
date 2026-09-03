import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { loadStripePaymentIntegration } from '../integrations/stripe-integration.ts';
import {
  PaymentProviderError,
  assertPaymentProviderCapability,
  normalizePaymentIdempotencyKey,
  type ProviderPaymentResult,
} from '../payments/payment-provider.ts';
import { isInternalPaymentClaimReference } from '../payments/stripe-payment-service.ts';
import { normalizeStripePaymentMethodReference } from '../payments/stripe-payment-provider.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  deriveHospitalityCommercialAmendmentExecutionDecision,
} from './booking-commercial-amendment-execution-domain.ts';
import {
  reconcileStripeCommercialAmendmentChargeSnapshot,
  stripeCommercialAmendmentChargeFingerprint,
  stripeCommercialAmendmentChargeOperationKey,
  stripeCommercialAmendmentChargePersistenceStatus,
  stripeCommercialAmendmentDirectCaptureIdempotencyKey,
  type StripeCommercialAmendmentChargeStage,
} from './booking-commercial-amendment-stripe-charge-domain.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { hospitalityBookingMutationLockKey } from './hospitality-booking-mutation-lock.ts';
import {
  HospitalityBookingConflictError,
  HospitalityBookingUnavailableError,
} from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';
const STRIPE_PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;

type AmendmentSnapshot = Readonly<{
  id: string;
  status: 'PREPARED' | 'CANCELLED' | 'EXPIRED' | 'APPLIED';
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  paymentProviderCode: string;
  currency: string;
  beforeTotalMinor: bigint;
  afterTotalMinor: bigint;
  deltaMinor: bigint;
  expiresAt: Date;
  bookingVersion: Date;
}>;

type SettlementTransaction = Readonly<{
  id: string;
  commercialAmendmentId: string | null;
  idempotencyKey: string;
  requestFingerprint: string | null;
  kind: 'OFFLINE_PAYMENT' | 'AUTHORIZATION' | 'CAPTURE' | 'REFUND';
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

type BookingSnapshot = Readonly<{
  id: string;
  status: string;
  paymentStatus: string;
  currency: string;
  totalMinor: bigint;
  updatedAt: Date;
}>;

function paymentLockKey(organizationId: string, bookingId: string) {
  return `payment:${organizationId}:booking:${bookingId}`;
}

function idempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `payment:${organizationId}:idempotency:${idempotencyKey}`;
}

function assertChargeAmendment(amendment: AmendmentSnapshot) {
  if (amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE || amendment.direction !== 'ADDITIONAL_CHARGE') {
    throw new HospitalityBookingConflictError('Commercial amendment is not a Stripe additional-charge adjustment.');
  }
  if (amendment.deltaMinor <= 0n || amendment.afterTotalMinor - amendment.beforeTotalMinor !== amendment.deltaMinor) {
    throw new HospitalityBookingConflictError('Commercial amendment additional-charge money is inconsistent.');
  }
}

function assertPreparedBooking(booking: BookingSnapshot, amendment: AmendmentSnapshot) {
  if (
    booking.status !== 'CONFIRMED'
    || booking.paymentStatus !== 'PAID'
    || booking.currency !== amendment.currency
    || booking.totalMinor !== amendment.beforeTotalMinor
    || booking.updatedAt.getTime() !== amendment.bookingVersion.getTime()
  ) {
    throw new HospitalityBookingConflictError(
      'Booking changed after this commercial amendment was prepared. Reconcile the booking and amendment before moving adjustment money.',
    );
  }
}

function deriveSettlement(amendment: AmendmentSnapshot, transactions: readonly SettlementTransaction[]) {
  return deriveHospitalityCommercialAmendmentSettlementState({
    amendmentId: amendment.id,
    direction: amendment.direction,
    paymentProviderCode: amendment.paymentProviderCode,
    currency: amendment.currency,
    beforeTotalMinor: amendment.beforeTotalMinor,
    afterTotalMinor: amendment.afterTotalMinor,
    deltaMinor: amendment.deltaMinor,
    transactions,
  });
}

function linkedSuccessfulAuthorization(input: {
  amendment: AmendmentSnapshot;
  transactions: readonly SettlementTransaction[];
}) {
  const captures = new Set(input.transactions
    .filter((entry) => entry.commercialAmendmentId === input.amendment.id && entry.kind === 'CAPTURE' && entry.status === 'SUCCEEDED')
    .map((entry) => entry.providerReference));
  const authorizations = input.transactions.filter((entry) => (
    entry.commercialAmendmentId === input.amendment.id
    && entry.kind === 'AUTHORIZATION'
    && entry.status === 'SUCCEEDED'
    && !captures.has(entry.providerReference)
  ));
  if (authorizations.length > 1) {
    throw new HospitalityBookingConflictError('Commercial amendment has multiple uncaptured Stripe authorizations and requires operator reconciliation.');
  }
  const authorization = authorizations[0] ?? null;
  if (authorization && (
    authorization.providerCode !== STRIPE_PROVIDER_CODE
    || !STRIPE_PAYMENT_INTENT_PATTERN.test(authorization.providerReference)
    || authorization.currency !== input.amendment.currency
    || authorization.amountMinor <= 0n
    || authorization.amountMinor > input.amendment.deltaMinor
  )) {
    throw new HospitalityBookingConflictError('Commercial amendment Stripe authorization evidence is inconsistent.');
  }
  return authorization;
}

async function loadLockedContext(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
}) {
  const amendment = await input.transaction.hospitalityBookingCommercialAmendment.findFirst({
    where: { id: input.amendmentId, organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      id: true,
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
  if (!amendment) throw new HospitalityBookingUnavailableError('Commercial amendment is not available in this organization.');
  assertChargeAmendment(amendment);

  const booking = await input.transaction.hospitalityBooking.findFirst({
    where: { id: input.bookingId, organizationId: input.organizationId },
    select: { id: true, status: true, paymentStatus: true, currency: true, totalMinor: true, updatedAt: true },
  });
  if (!booking) throw new HospitalityBookingUnavailableError();
  assertPreparedBooking(booking, amendment);

  const transactions = await input.transaction.paymentTransaction.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId },
    select: {
      id: true,
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
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return { amendment, booking, transactions };
}

function directCaptureFingerprint(input: {
  bookingId: string;
  amendmentId: string;
  currency: string;
  amountMinor: bigint;
  providerReference: string;
}) {
  return stripeCommercialAmendmentChargeFingerprint({ ...input, stage: 'CAPTURE' });
}

async function persistDirectSettlementCapture(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
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
  const requestFingerprint = directCaptureFingerprint(input);
  const existing = await input.transaction.paymentTransaction.findUnique({
    where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } },
  });
  if (existing) {
    if (
      existing.bookingId !== input.bookingId
      || existing.commercialAmendmentId !== input.amendmentId
      || existing.kind !== 'CAPTURE'
      || existing.status !== 'SUCCEEDED'
      || existing.providerCode !== STRIPE_PROVIDER_CODE
      || existing.providerReference !== input.providerReference
      || existing.currency !== input.currency
      || existing.amountMinor !== input.amountMinor
      || existing.requestFingerprint !== requestFingerprint
    ) {
      throw new HospitalityBookingConflictError('Commercial amendment direct Stripe settlement evidence is inconsistent.');
    }
    return existing;
  }
  return input.transaction.paymentTransaction.create({ data: {
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
  } });
}

async function markClaimFailed(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  paymentId: string;
  stage: StripeCommercialAmendmentChargeStage;
}) {
  await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;
    const payment = await transaction.paymentTransaction.findFirst({
      where: {
        id: input.paymentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: input.stage,
      },
    });
    if (!payment || payment.status !== 'AMBIGUOUS' || !isInternalPaymentClaimReference(payment.providerReference)) return;
    const updated = await transaction.paymentTransaction.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: `payment.commercial-amendment.stripe-${input.stage === 'AUTHORIZATION' ? 'authorization' : 'capture'}-failed`,
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: input.stage,
        status: 'FAILED',
        currency: updated.currency,
        amountMinor: updated.amountMinor.toString(),
        bookingPaymentStatePreservedUntilApply: true,
      },
    } });
  }, { isolationLevel: 'Serializable' });
}

export async function chargeStripeHospitalityBookingCommercialAmendment(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  idempotencyKey: unknown;
  paymentMethodReference?: unknown;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  const rootIdempotencyKey = normalizePaymentIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();

  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  for (const capability of ['payment-authorize', 'payment-capture']) {
    if (!stripe.integration.capabilities.includes(capability)) {
      throw new HospitalityBookingConflictError(`Stripe integration is not configured for ${capability}.`);
    }
  }
  assertPaymentProviderCapability(stripe.provider, 'AUTHORIZE');
  assertPaymentProviderCapability(stripe.provider, 'CAPTURE');
  if (!stripe.provider.authorizePayment || !stripe.provider.capturePayment) {
    throw new HospitalityBookingConflictError('Stripe integration cannot authorize and capture commercial amendment charges.');
  }

  const claim = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;

    const context = await loadLockedContext({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
    });
    const settlement = deriveSettlement(context.amendment, context.transactions);
    if (settlement.state === 'CONFLICT') throw new HospitalityBookingConflictError(settlement.reason);
    if (settlement.state === 'READY_TO_APPLY') {
      return { done: true as const, state: 'READY_TO_APPLY' as const };
    }

    const unresolved = context.transactions.filter((entry) => (
      entry.commercialAmendmentId === context.amendment.id
      && (entry.status === 'PENDING' || entry.status === 'AMBIGUOUS')
    ));
    if (unresolved.length > 1) {
      throw new HospitalityBookingConflictError('Commercial amendment has multiple unresolved Stripe charge operations.');
    }

    const authorization = linkedSuccessfulAuthorization({ amendment: context.amendment, transactions: context.transactions });
    let stage: StripeCommercialAmendmentChargeStage;
    let amountMinor: bigint;
    let paymentMethodReference: string | null = null;
    let providerReference: string | null = null;

    if (authorization) {
      if (settlement.state !== 'IN_PROGRESS' || authorization.amountMinor !== settlement.remainingAdjustmentMinor) {
        throw new HospitalityBookingConflictError('Commercial amendment Stripe authorization no longer matches the remaining additional charge.');
      }
      const lifecycleDecision = deriveHospitalityCommercialAmendmentExecutionDecision({
        status: context.amendment.status,
        direction: context.amendment.direction,
        paymentProviderCode: context.amendment.paymentProviderCode,
        currency: context.amendment.currency,
        expiresAt: context.amendment.expiresAt,
        now,
        settlement,
      });
      if (lifecycleDecision.state !== 'WAIT_FOR_PROVIDER') {
        if ('reason' in lifecycleDecision) throw new HospitalityBookingConflictError(lifecycleDecision.reason);
        throw new HospitalityBookingConflictError('Commercial amendment Stripe authorization cannot be captured in its current lifecycle state.');
      }
      stage = 'CAPTURE';
      amountMinor = authorization.amountMinor;
      providerReference = authorization.providerReference;
    } else {
      paymentMethodReference = normalizeStripePaymentMethodReference(input.paymentMethodReference);
      const authorizationOperationIdempotencyKey = stripeCommercialAmendmentChargeOperationKey({
        rootIdempotencyKey,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        stage: 'AUTHORIZATION',
      });
      const existingAuthorizationClaim = await transaction.paymentTransaction.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: input.organizationId,
            idempotencyKey: authorizationOperationIdempotencyKey,
          },
        },
      });

      let executionSettlement = settlement;
      if (existingAuthorizationClaim?.status === 'AMBIGUOUS') {
        const expectedFingerprint = stripeCommercialAmendmentChargeFingerprint({
          bookingId: input.bookingId,
          amendmentId: input.amendmentId,
          stage: 'AUTHORIZATION',
          currency: context.amendment.currency,
          amountMinor: existingAuthorizationClaim.amountMinor,
          paymentMethodReference,
        });
        if (
          existingAuthorizationClaim.bookingId !== input.bookingId
          || existingAuthorizationClaim.commercialAmendmentId !== input.amendmentId
          || existingAuthorizationClaim.kind !== 'AUTHORIZATION'
          || existingAuthorizationClaim.providerCode !== STRIPE_PROVIDER_CODE
          || existingAuthorizationClaim.currency !== context.amendment.currency
          || existingAuthorizationClaim.requestFingerprint !== expectedFingerprint
        ) {
          throw new HospitalityBookingConflictError(
            'Commercial amendment Stripe authorization retry no longer matches the prepared charge.',
          );
        }
        if (!isInternalPaymentClaimReference(existingAuthorizationClaim.providerReference)) {
          return {
            done: true as const,
            state: 'AMBIGUOUS' as const,
            payment: existingAuthorizationClaim,
            needsReconciliation: true as const,
          };
        }
        executionSettlement = deriveSettlement(
          context.amendment,
          context.transactions.filter((entry) => entry.id !== existingAuthorizationClaim.id),
        );
        if (executionSettlement.state === 'CONFLICT') {
          throw new HospitalityBookingConflictError(executionSettlement.reason);
        }
      }

      const decision = deriveHospitalityCommercialAmendmentExecutionDecision({
        status: context.amendment.status,
        direction: context.amendment.direction,
        paymentProviderCode: context.amendment.paymentProviderCode,
        currency: context.amendment.currency,
        expiresAt: context.amendment.expiresAt,
        now,
        settlement: executionSettlement,
      });
      if (decision.state !== 'EXECUTE' || decision.operation !== 'ADDITIONAL_CHARGE' || decision.providerCode !== STRIPE_PROVIDER_CODE) {
        if ('reason' in decision) throw new HospitalityBookingConflictError(decision.reason);
        throw new HospitalityBookingConflictError('Commercial amendment Stripe charge cannot execute in its current state.');
      }
      stage = 'AUTHORIZATION';
      amountMinor = decision.amountMinor;
    }

    const operationIdempotencyKey = stripeCommercialAmendmentChargeOperationKey({
      rootIdempotencyKey,
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      stage,
    });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyLockKey(input.organizationId, operationIdempotencyKey)}, 0))`;

    const requestFingerprint = stripeCommercialAmendmentChargeFingerprint({
      bookingId: input.bookingId,
      amendmentId: input.amendmentId,
      stage,
      currency: context.amendment.currency,
      amountMinor,
      paymentMethodReference,
      providerReference,
    });
    const claimReference = `sf_claim_${requestFingerprint}`;
    const existing = await transaction.paymentTransaction.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: operationIdempotencyKey } },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.commercialAmendmentId !== input.amendmentId
        || existing.kind !== stage
        || existing.providerCode !== STRIPE_PROVIDER_CODE
        || existing.currency !== context.amendment.currency
        || existing.amountMinor !== amountMinor
        || existing.requestFingerprint !== requestFingerprint
      ) {
        throw new HospitalityBookingConflictError('Commercial amendment Stripe charge idempotency key was already used for a different operation.');
      }
      if (existing.status !== 'AMBIGUOUS') {
        return { done: true as const, state: existing.status, payment: existing };
      }
      if (!isInternalPaymentClaimReference(existing.providerReference)) {
        return { done: true as const, state: 'AMBIGUOUS' as const, payment: existing, needsReconciliation: true as const };
      }
      if (existing.providerReference !== claimReference) {
        throw new HospitalityBookingConflictError('Commercial amendment Stripe charge claim identity is inconsistent.');
      }
      return {
        done: false as const,
        payment: existing,
        stage,
        amountMinor,
        currency: context.amendment.currency,
        paymentMethodReference,
        providerReference,
        operationIdempotencyKey,
        requestFingerprint,
        claimReference,
      };
    }

    if (unresolved.length > 0) {
      throw new HospitalityBookingConflictError('Commercial amendment already has an unresolved Stripe charge operation that must be reconciled first.');
    }

    const payment = await transaction.paymentTransaction.create({ data: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      idempotencyKey: operationIdempotencyKey,
      requestFingerprint,
      kind: stage,
      status: 'AMBIGUOUS',
      providerCode: STRIPE_PROVIDER_CODE,
      providerReference: claimReference,
      currency: context.amendment.currency,
      amountMinor,
    } });
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: `payment.commercial-amendment.stripe-${stage === 'AUTHORIZATION' ? 'authorization' : 'capture'}-claimed`,
      resourceType: 'payment-transaction',
      resourceId: payment.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: stage,
        status: 'AMBIGUOUS',
        currency: context.amendment.currency,
        amountMinor: amountMinor.toString(),
        bookingPaymentStatePreservedUntilApply: true,
      },
    } });
    return {
      done: false as const,
      payment,
      stage,
      amountMinor,
      currency: context.amendment.currency,
      paymentMethodReference,
      providerReference,
      operationIdempotencyKey,
      requestFingerprint,
      claimReference,
    };
  }, { isolationLevel: 'Serializable' });

  if (claim.done) return claim;

  let providerResult: ProviderPaymentResult;
  try {
    providerResult = claim.stage === 'AUTHORIZATION'
      ? await stripe.provider.authorizePayment!({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          idempotencyKey: claim.operationIdempotencyKey,
          money: { currency: claim.currency, amountMinor: claim.amountMinor },
          paymentMethodReference: claim.paymentMethodReference!,
        })
      : await stripe.provider.capturePayment!({
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          idempotencyKey: claim.operationIdempotencyKey,
          money: { currency: claim.currency, amountMinor: claim.amountMinor },
          providerReference: claim.providerReference!,
        });
  } catch (error) {
    if (error instanceof PaymentProviderError && !error.retryable) {
      await markClaimFailed({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        paymentId: claim.payment.id,
        stage: claim.stage,
      });
    }
    throw error;
  }

  if (
    providerResult.providerCode !== STRIPE_PROVIDER_CODE
    || providerResult.money.currency !== claim.currency
    || providerResult.money.amountMinor !== claim.amountMinor
    || !STRIPE_PAYMENT_INTENT_PATTERN.test(providerResult.providerReference)
    || (claim.stage === 'CAPTURE' && providerResult.providerReference !== claim.providerReference)
  ) {
    throw new HospitalityBookingConflictError('Stripe returned a charge result that does not match the commercial amendment claim.');
  }
  const persistence = stripeCommercialAmendmentChargePersistenceStatus({
    stage: claim.stage,
    providerStatus: providerResult.status,
  });

  const persisted = await db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;
    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: claim.payment.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: claim.stage,
      },
    });
    if (!current) throw new HospitalityBookingUnavailableError('Commercial amendment Stripe charge claim is unavailable.');
    if (current.providerReference !== claim.claimReference) {
      return { payment: current, idempotent: true as const, needsReconciliation: current.status === 'AMBIGUOUS' };
    }
    if (
      current.requestFingerprint !== claim.requestFingerprint
      || current.currency !== claim.currency
      || current.amountMinor !== claim.amountMinor
    ) {
      throw new HospitalityBookingConflictError('Commercial amendment Stripe charge claim changed while Stripe was processing it.');
    }

    const duplicateReferences = await transaction.paymentTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        providerCode: STRIPE_PROVIDER_CODE,
        providerReference: providerResult.providerReference,
        id: { not: current.id },
      },
      select: { bookingId: true, commercialAmendmentId: true },
      take: 8,
    });
    if (duplicateReferences.some((entry) => (
      entry.bookingId !== input.bookingId || entry.commercialAmendmentId !== input.amendmentId
    ))) {
      throw new HospitalityBookingConflictError('Stripe PaymentIntent reference is already recorded outside this commercial amendment.');
    }

    const payment = await transaction.paymentTransaction.update({
      where: { id: current.id },
      data: { providerReference: providerResult.providerReference, status: persistence.transactionStatus },
    });
    let directCapture = null;
    if (claim.stage === 'AUTHORIZATION' && persistence.directlySettled) {
      directCapture = await persistDirectSettlementCapture({
        transaction,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        currency: claim.currency,
        amountMinor: claim.amountMinor,
        providerReference: providerResult.providerReference,
      });
    }
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: `payment.commercial-amendment.stripe-${claim.stage === 'AUTHORIZATION' ? 'authorization' : 'capture'}-recorded`,
      resourceType: 'payment-transaction',
      resourceId: payment.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: claim.stage,
        status: payment.status,
        currency: payment.currency,
        amountMinor: payment.amountMinor.toString(),
        directlySettled: persistence.directlySettled,
        directCaptureTransactionId: directCapture?.id ?? null,
        bookingPaymentStatePreservedUntilApply: true,
      },
    } });
    return { payment, idempotent: false as const, needsReconciliation: payment.status === 'AMBIGUOUS' };
  }, { isolationLevel: 'Serializable' });

  if (
    claim.stage === 'AUTHORIZATION'
    && persisted.payment.status === 'SUCCEEDED'
    && !persistence.directlySettled
  ) {
    return chargeStripeHospitalityBookingCommercialAmendment({
      ...input,
      idempotencyKey: rootIdempotencyKey,
      now: input.now,
    });
  }
  return persisted;
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentCharge(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  transactionId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');
  assertUuidIdentifier(input.transactionId, 'transactionId');
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);

  const payment = await db.paymentTransaction.findFirst({
    where: {
      id: input.transactionId,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: { in: ['AUTHORIZATION', 'CAPTURE'] },
    },
  });
  if (!payment) throw new HospitalityBookingUnavailableError('Commercial amendment Stripe charge is unavailable in this organization.');
  if (payment.status !== 'AMBIGUOUS') return payment;
  if (isInternalPaymentClaimReference(payment.providerReference)) {
    throw new HospitalityBookingConflictError('Commercial amendment Stripe charge has no provider reference yet. Retry the exact idempotent operation to recover provider truth.');
  }
  if (!STRIPE_PAYMENT_INTENT_PATTERN.test(payment.providerReference)) {
    throw new HospitalityBookingConflictError('Commercial amendment Stripe charge provider reference is invalid.');
  }

  const amendment = await db.hospitalityBookingCommercialAmendment.findFirst({
    where: { id: input.amendmentId, organizationId: input.organizationId, bookingId: input.bookingId },
    select: { id: true, direction: true, paymentProviderCode: true, currency: true, deltaMinor: true },
  });
  if (!amendment) throw new HospitalityBookingUnavailableError('Commercial amendment is unavailable in this organization.');
  if (
    amendment.direction !== 'ADDITIONAL_CHARGE'
    || amendment.paymentProviderCode !== STRIPE_PROVIDER_CODE
    || amendment.currency !== payment.currency
    || payment.amountMinor <= 0n
    || payment.amountMinor > amendment.deltaMinor
  ) {
    throw new HospitalityBookingConflictError('Commercial amendment no longer matches the Stripe charge being reconciled.');
  }

  const stripe = await loadStripePaymentIntegration(input.organizationId);
  const snapshot = await stripe.reconciliationProvider.retrievePaymentIntent(payment.providerReference);
  let reconciliation;
  try {
    reconciliation = reconcileStripeCommercialAmendmentChargeSnapshot({
      stage: payment.kind as StripeCommercialAmendmentChargeStage,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      providerReference: payment.providerReference,
      snapshot,
    });
  } catch (error) {
    throw new HospitalityBookingConflictError(error instanceof Error ? error.message : 'Stripe charge reconciliation evidence is invalid.');
  }

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityBookingMutationLockKey({ organizationId: input.organizationId, bookingId: input.bookingId })}, 0))`;
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentLockKey(input.organizationId, input.bookingId)}, 0))`;
    const current = await transaction.paymentTransaction.findFirst({
      where: {
        id: payment.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: payment.kind,
      },
    });
    if (!current) throw new HospitalityBookingUnavailableError('Commercial amendment Stripe charge is unavailable in this organization.');
    if (current.status !== 'AMBIGUOUS') return current;
    if (
      current.providerReference !== payment.providerReference
      || current.requestFingerprint !== payment.requestFingerprint
      || current.currency !== payment.currency
      || current.amountMinor !== payment.amountMinor
    ) {
      throw new HospitalityBookingConflictError('Commercial amendment Stripe charge changed during reconciliation.');
    }

    const updated = await transaction.paymentTransaction.update({ where: { id: current.id }, data: { status: reconciliation.transactionStatus } });
    let directCapture = null;
    if (payment.kind === 'AUTHORIZATION' && reconciliation.directlySettled) {
      directCapture = await persistDirectSettlementCapture({
        transaction,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        amendmentId: input.amendmentId,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        providerReference: payment.providerReference,
      });
    }
    await transaction.auditEvent.create({ data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'payment.commercial-amendment.stripe-charge-reconciled',
      resourceType: 'payment-transaction',
      resourceId: updated.id,
      afterData: {
        bookingId: input.bookingId,
        commercialAmendmentId: input.amendmentId,
        providerCode: STRIPE_PROVIDER_CODE,
        kind: updated.kind,
        status: updated.status,
        providerStatus: snapshot.status,
        currency: updated.currency,
        amountMinor: updated.amountMinor.toString(),
        directlySettled: reconciliation.directlySettled,
        directCaptureTransactionId: directCapture?.id ?? null,
        bookingPaymentStatePreservedUntilApply: true,
      },
    } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
