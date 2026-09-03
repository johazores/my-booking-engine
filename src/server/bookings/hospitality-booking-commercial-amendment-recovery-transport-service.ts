import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import { isInternalPaymentClaimReference } from '../payments/stripe-payment-service.ts';
import { moneyMinorToMajorString } from '../pricing/money.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import type { HospitalityCommercialAmendmentRecoveryDecision } from './booking-commercial-amendment-recovery-domain.ts';
import {
  deriveHospitalityCommercialAmendmentRecoveryTransportState,
  hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey,
  type HospitalityCommercialAmendmentRecoveryCheckoutClaimState,
  type HospitalityCommercialAmendmentRecoveryTransportState,
} from './booking-commercial-amendment-recovery-transport-domain.ts';
import {
  STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX,
  isStripeCheckoutSessionReference,
} from './booking-commercial-amendment-stripe-recovery-checkout-domain.ts';
import {
  createStripeHospitalityBookingCommercialAmendmentRecoveryCheckout,
} from './hospitality-booking-commercial-amendment-stripe-recovery-checkout-service.ts';
import {
  reconcileStripeHospitalityBookingCommercialAmendmentRecoveryCheckout,
} from './hospitality-booking-commercial-amendment-stripe-recovery-checkout-reconciliation-service.ts';
import {
  finalizeHospitalityBookingCommercialAmendmentRecovery,
  readHospitalityBookingCommercialAmendmentRecovery,
} from './hospitality-booking-commercial-amendment-recovery-service.ts';
import { HospitalityBookingConflictError } from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';
export type HospitalityBookingCommercialAmendmentRecoveryTransport = Readonly<{
  bookingId: string;
  amendmentId: string;
  state: HospitalityCommercialAmendmentRecoveryTransportState;
  reason: string;
  providerCode: string | null;
  operation: string | null;
  amountDisplay: string | null;
  terminalStatus: string | null;
}>;

type RecoveryCheckoutClaim = Readonly<{
  id: string;
  providerReference: string;
}>;

async function requireRecoveryTransportPermissions(input: {
  organizationId: string;
  actorUserId: string;
}) {
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

function amountDisplay(decision: HospitalityCommercialAmendmentRecoveryDecision) {
  if (!('amountMinor' in decision) || !('currency' in decision)) return null;
  return `${decision.currency} ${moneyMinorToMajorString(decision.amountMinor, decision.currency)}`;
}

function decisionProviderCode(decision: HospitalityCommercialAmendmentRecoveryDecision) {
  return 'providerCode' in decision ? decision.providerCode : null;
}

function decisionOperation(decision: HospitalityCommercialAmendmentRecoveryDecision) {
  if ('operation' in decision) return decision.operation;
  if (decision.state === 'RELEASE_AUTHORIZATION') return 'RELEASE_AUTHORIZATION';
  if (decision.state === 'CAPTURE_COMPENSATION') return 'CAPTURE_COMPENSATION';
  return null;
}

async function findCurrentRecoveryCheckoutClaim(input: {
  organizationId: string;
  bookingId: string;
  amendmentId: string;
}) {
  const claims = await db.paymentTransaction.findMany({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'CAPTURE',
      status: 'AMBIGUOUS',
      idempotencyKey: { startsWith: STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, providerReference: true },
    take: 2,
  });
  if (claims.length > 1) {
    throw new PaymentConflictError('Commercial amendment has multiple unresolved Stripe recovery Checkout claims.');
  }
  return (claims[0] ?? null) as RecoveryCheckoutClaim | null;
}

async function presentRecoveryDecision(input: {
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  decision: HospitalityCommercialAmendmentRecoveryDecision;
}): Promise<HospitalityBookingCommercialAmendmentRecoveryTransport> {
  let checkoutClaimState: HospitalityCommercialAmendmentRecoveryCheckoutClaimState = 'NONE';
  if (input.decision.state === 'WAIT_FOR_PROVIDER') {
    const claim = await findCurrentRecoveryCheckoutClaim(input);
    if (claim) {
      checkoutClaimState = isInternalPaymentClaimReference(claim.providerReference)
        ? 'INTERNAL_CLAIM'
        : isStripeCheckoutSessionReference(claim.providerReference)
          ? 'CHECKOUT_SESSION'
          : 'OTHER_PROVIDER_REFERENCE';
    }
  }
  return Object.freeze({
    bookingId: input.bookingId,
    amendmentId: input.amendmentId,
    state: deriveHospitalityCommercialAmendmentRecoveryTransportState({ decision: input.decision, checkoutClaimState }),
    reason: input.decision.reason,
    providerCode: decisionProviderCode(input.decision),
    operation: decisionOperation(input.decision),
    amountDisplay: amountDisplay(input.decision),
    terminalStatus: input.decision.state === 'TERMINAL' ? input.decision.status : null,
  });
}

export async function readHospitalityBookingCommercialAmendmentRecoveryTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  const recovery = await readHospitalityBookingCommercialAmendmentRecovery(input);
  return presentRecoveryDecision({ organizationId: input.organizationId, bookingId: input.bookingId, amendmentId: input.amendmentId, decision: recovery.decision });
}

export async function findHospitalityBookingCommercialAmendmentRecoveryTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireRecoveryTransportPermissions(input);
  const now = input.now ?? new Date();

  const amendments = await db.hospitalityBookingCommercialAmendment.findMany({
    where: { organizationId: input.organizationId, bookingId: input.bookingId, status: 'PREPARED', expiresAt: { lte: now } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: 2,
  });
  if (amendments.length === 0) return null;
  if (amendments.length > 1) {
    throw new HospitalityBookingConflictError('Booking has multiple expired prepared commercial amendments and requires operator reconciliation.');
  }
  const amendment = amendments[0];
  if (!amendment) return null;
  return readHospitalityBookingCommercialAmendmentRecoveryTransport({ ...input, amendmentId: amendment.id, now });
}

export async function createOrResumeStripeHospitalityBookingCommercialAmendmentRecoveryCheckout(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  successUrl: string;
  cancelUrl: string;
  now?: Date;
}) {
  const current = await readHospitalityBookingCommercialAmendmentRecoveryTransport(input);
  if (current.state !== 'CHECKOUT_REQUIRED' && current.state !== 'CHECKOUT_RESUME_REQUIRED') {
    throw new HospitalityBookingConflictError('Commercial amendment recovery is not ready for customer-authorized Stripe Checkout.');
  }

  const failedAttempts = await db.paymentTransaction.count({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'CAPTURE',
      status: 'FAILED',
      idempotencyKey: { startsWith: STRIPE_RECOVERY_CHECKOUT_IDEMPOTENCY_PREFIX },
    },
  });
  const requestKey = hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey(failedAttempts);
  const checkout = await createStripeHospitalityBookingCommercialAmendmentRecoveryCheckout({ ...input, requestKey });

  if (checkout.state === 'PAYMENT_CONFIRMED') {
    return reconcileStripeHospitalityBookingCommercialAmendmentRecoveryTransport(input);
  }
  return Object.freeze({ ...current, state: 'CHECKOUT_REQUIRED' as const, checkoutUrl: checkout.checkoutUrl, checkoutExpiresAt: checkout.expiresAt });
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentRecoveryTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  const current = await readHospitalityBookingCommercialAmendmentRecoveryTransport(input);
  if (current.state === 'READY_TO_CLOSE') {
    await finalizeHospitalityBookingCommercialAmendmentRecovery(input);
    return readHospitalityBookingCommercialAmendmentRecoveryTransport(input);
  }
  if (current.state !== 'CHECKOUT_PENDING') return current;

  const claim = await findCurrentRecoveryCheckoutClaim(input);
  if (!claim || !isStripeCheckoutSessionReference(claim.providerReference)) {
    throw new PaymentConflictError('Stripe recovery Checkout is no longer bound to one reconcilable Checkout Session.');
  }
  await reconcileStripeHospitalityBookingCommercialAmendmentRecoveryCheckout({ ...input, transactionId: claim.id });
  return readHospitalityBookingCommercialAmendmentRecoveryTransport(input);
}
