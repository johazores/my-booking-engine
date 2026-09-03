import {
  stripeCommercialAmendmentRecoveryFingerprint,
  stripeCommercialAmendmentRecoveryOperationKey,
  type StripeCommercialAmendmentRecoveryOperation,
} from './booking-commercial-amendment-stripe-recovery-domain.ts';

export type StripeCommercialAmendmentRecoveryWebhookCandidate = Readonly<{
  bookingId: string;
  commercialAmendmentId: string;
  idempotencyKey: string;
  requestFingerprint: string | null;
  kind: 'CAPTURE' | 'REFUND';
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

export type StripeCommercialAmendmentRecoveryWebhookIdentity = Readonly<{
  operation: Extract<StripeCommercialAmendmentRecoveryOperation, 'CAPTURE_COMPENSATION' | 'COMPENSATION_REFUND'>;
  providerReference: string;
}>;

export class StripeCommercialAmendmentRecoveryWebhookConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeCommercialAmendmentRecoveryWebhookConflictError';
  }
}

export function assertStripeCommercialAmendmentRecoveryWebhookIdentity(
  candidate: StripeCommercialAmendmentRecoveryWebhookCandidate,
): StripeCommercialAmendmentRecoveryWebhookIdentity {
  const operation = candidate.kind === 'CAPTURE'
    ? 'CAPTURE_COMPENSATION' as const
    : 'COMPENSATION_REFUND' as const;
  const providerReference = candidate.kind === 'REFUND'
    ? candidate.sourceProviderReference
    : candidate.providerReference;

  if (!providerReference) {
    throw new StripeCommercialAmendmentRecoveryWebhookConflictError(
      'Stripe commercial amendment recovery refund is missing settlement-source attribution.',
    );
  }

  let expectedIdempotencyKey: string;
  let expectedFingerprint: string;
  try {
    expectedIdempotencyKey = stripeCommercialAmendmentRecoveryOperationKey({
      bookingId: candidate.bookingId,
      amendmentId: candidate.commercialAmendmentId,
      operation,
      providerReference,
    });
    expectedFingerprint = stripeCommercialAmendmentRecoveryFingerprint({
      bookingId: candidate.bookingId,
      amendmentId: candidate.commercialAmendmentId,
      operation,
      currency: candidate.currency,
      amountMinor: candidate.amountMinor,
      providerReference,
    });
  } catch (error) {
    throw new StripeCommercialAmendmentRecoveryWebhookConflictError(
      error instanceof Error
        ? error.message
        : 'Stripe commercial amendment recovery webhook identity is invalid.',
    );
  }

  if (
    candidate.idempotencyKey !== expectedIdempotencyKey
    || candidate.requestFingerprint !== expectedFingerprint
  ) {
    throw new StripeCommercialAmendmentRecoveryWebhookConflictError(
      'Stripe commercial amendment recovery webhook does not match the persisted recovery operation identity.',
    );
  }

  return Object.freeze({ operation, providerReference });
}
