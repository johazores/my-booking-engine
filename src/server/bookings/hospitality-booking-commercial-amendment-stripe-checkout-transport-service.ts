import { db } from '../database.ts';
import { PaymentConflictError } from '../payments/payment-service.ts';
import { isInternalPaymentClaimReference } from '../payments/stripe-payment-service.ts';
import {
  STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX,
  hospitalityCommercialAmendmentCheckoutAttemptRequestKey,
  isStripeCommercialAmendmentCheckoutSessionReference,
} from './booking-commercial-amendment-stripe-checkout-domain.ts';
import {
  createStripeHospitalityBookingCommercialAmendmentCheckout,
  reconcileStripeHospitalityBookingCommercialAmendmentCheckout,
} from './hospitality-booking-commercial-amendment-stripe-checkout-service.ts';
import { readHospitalityBookingCommercialAmendmentTransport } from './hospitality-booking-commercial-amendment-transport-service.ts';
import { HospitalityBookingConflictError } from './hospitality-booking-service.ts';

const STRIPE_PROVIDER_CODE = 'stripe';

async function findCurrentCheckoutClaim(input: {
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
      idempotencyKey: { startsWith: STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, providerReference: true },
    take: 2,
  });
  if (claims.length > 1) {
    throw new PaymentConflictError('Commercial amendment has multiple unresolved Stripe Checkout claims.');
  }
  return claims[0] ?? null;
}

export async function createOrResumeStripeHospitalityBookingCommercialAmendmentCheckout(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  successUrl: string;
  cancelUrl: string;
  now?: Date;
}) {
  const current = await readHospitalityBookingCommercialAmendmentTransport(input);
  if (current.state !== 'STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED' && current.state !== 'WAIT_FOR_PROVIDER') {
    throw new HospitalityBookingConflictError('Commercial amendment is not ready for customer-authorized Stripe Checkout.');
  }

  const claim = await findCurrentCheckoutClaim(input);
  if (current.state === 'WAIT_FOR_PROVIDER' && !claim) {
    throw new HospitalityBookingConflictError('Commercial amendment is waiting on a different provider operation and cannot start Checkout.');
  }
  if (claim && !isInternalPaymentClaimReference(claim.providerReference) && !isStripeCommercialAmendmentCheckoutSessionReference(claim.providerReference)) {
    throw new PaymentConflictError('Commercial amendment Checkout claim has an unexpected provider reference and requires reconciliation.');
  }

  const failedAttempts = await db.paymentTransaction.count({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      providerCode: STRIPE_PROVIDER_CODE,
      kind: 'CAPTURE',
      status: 'FAILED',
      idempotencyKey: { startsWith: STRIPE_COMMERCIAL_AMENDMENT_CHECKOUT_IDEMPOTENCY_PREFIX },
    },
  });
  const requestKey = hospitalityCommercialAmendmentCheckoutAttemptRequestKey(failedAttempts);
  return createStripeHospitalityBookingCommercialAmendmentCheckout({ ...input, requestKey });
}

export async function reconcileStripeHospitalityBookingCommercialAmendmentCheckoutTransport(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  const current = await readHospitalityBookingCommercialAmendmentTransport(input);
  if (current.providerCode !== STRIPE_PROVIDER_CODE || current.direction !== 'ADDITIONAL_CHARGE' || current.state !== 'WAIT_FOR_PROVIDER') {
    return current;
  }

  const claim = await findCurrentCheckoutClaim(input);
  if (!claim) {
    throw new PaymentConflictError('Commercial amendment is waiting for Stripe but has no customer Checkout claim to reconcile.');
  }
  if (isInternalPaymentClaimReference(claim.providerReference)) {
    throw new PaymentConflictError('Stripe Checkout creation has an unresolved pre-reference claim. Retry the Checkout start action with the same server-derived attempt.');
  }
  if (!isStripeCommercialAmendmentCheckoutSessionReference(claim.providerReference)) {
    throw new PaymentConflictError('Stripe Checkout claim is not bound to a reconcilable Checkout Session.');
  }

  await reconcileStripeHospitalityBookingCommercialAmendmentCheckout({ ...input, transactionId: claim.id });
  return readHospitalityBookingCommercialAmendmentTransport(input);
}
