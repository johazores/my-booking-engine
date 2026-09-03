export type StripeCommercialAmendmentPaymentWebhookCandidate = Readonly<{
  id: string;
  bookingId: string;
  commercialAmendmentId: string;
  kind: 'AUTHORIZATION' | 'CAPTURE';
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}>;

export type StripeCommercialAmendmentRefundWebhookCandidate = Readonly<{
  id: string;
  bookingId: string;
  commercialAmendmentId: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>;

export class StripeCommercialAmendmentWebhookConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeCommercialAmendmentWebhookConflictError';
  }
}

export function selectStripeCommercialAmendmentPaymentWebhookCandidate(input: {
  providerReference: string;
  currency: string;
  amountMinor: bigint;
  candidates: readonly StripeCommercialAmendmentPaymentWebhookCandidate[];
}): StripeCommercialAmendmentPaymentWebhookCandidate | null {
  const exact = input.candidates.filter((candidate) => candidate.providerReference === input.providerReference);
  if (exact.length > 1) {
    throw new StripeCommercialAmendmentWebhookConflictError(
      'Stripe PaymentIntent matches multiple commercial amendment charge operations.',
    );
  }
  if (exact.length === 0) return null;

  const candidate = exact[0]!;
  if (candidate.currency !== input.currency || candidate.amountMinor !== input.amountMinor) {
    throw new StripeCommercialAmendmentWebhookConflictError(
      'Stripe commercial amendment charge webhook money does not match the persisted operation.',
    );
  }
  return candidate;
}

export function selectStripeCommercialAmendmentRefundWebhookCandidate(input: {
  refundReference: string;
  paymentIntentReference: string;
  currency: string;
  amountMinor: bigint;
  candidates: readonly StripeCommercialAmendmentRefundWebhookCandidate[];
}): StripeCommercialAmendmentRefundWebhookCandidate | null {
  const exact = input.candidates.filter((candidate) => candidate.providerReference === input.refundReference);
  if (exact.length > 1) {
    throw new StripeCommercialAmendmentWebhookConflictError(
      'Stripe refund matches multiple commercial amendment refund operations.',
    );
  }
  if (exact.length === 0) return null;

  const candidate = exact[0]!;
  if (
    candidate.sourceProviderReference !== input.paymentIntentReference
    || candidate.currency !== input.currency
    || candidate.amountMinor !== input.amountMinor
  ) {
    throw new StripeCommercialAmendmentWebhookConflictError(
      'Stripe commercial amendment refund webhook does not match the persisted source and money.',
    );
  }
  return candidate;
}
