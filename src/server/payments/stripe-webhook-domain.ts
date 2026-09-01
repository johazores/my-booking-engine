const STRIPE_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_]+$/;
const STRIPE_EVENT_TYPE_PATTERN = /^[a-z0-9_.]{3,120}$/;
const STRIPE_PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_REFUND_PATTERN = /^re_[A-Za-z0-9_]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

export type StripeWebhookPaymentIntent = Readonly<{
  providerReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
  amountReceivedMinor: bigint;
  organizationId: string | null;
  bookingId: string | null;
}>;

export type StripeWebhookRefund = Readonly<{
  refundReference: string;
  paymentIntentReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
}>;

export type StripeWebhookEvent = Readonly<{
  providerEventId: string;
  eventType: string;
  providerCreatedAt: Date;
  paymentIntent: StripeWebhookPaymentIntent | null;
  refund: StripeWebhookRefund | null;
}>;

export type StripeWebhookPaymentCandidate = Readonly<{
  id: string;
  kind: 'AUTHORIZATION' | 'CAPTURE';
  providerReference: string;
}>;

export type StripeWebhookRefundCandidate = Readonly<{
  id: string;
  providerReference: string;
  currency: string;
  amountMinor: bigint;
}>;

export class StripeWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookValidationError';
  }
}

export function parseStripeWebhookEventPayload(payload: string): StripeWebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new StripeWebhookValidationError('Stripe webhook payload is not valid JSON.');
  }

  const event = objectRecord(parsed, 'Stripe webhook event');
  const providerEventId = requiredString(event.id, 'Stripe event ID');
  if (!STRIPE_EVENT_ID_PATTERN.test(providerEventId) || providerEventId.length > 160) {
    throw new StripeWebhookValidationError('Stripe event ID is invalid.');
  }

  const eventType = requiredString(event.type, 'Stripe event type');
  if (!STRIPE_EVENT_TYPE_PATTERN.test(eventType)) throw new StripeWebhookValidationError('Stripe event type is invalid.');

  if (!Number.isSafeInteger(event.created) || Number(event.created) <= 0) {
    throw new StripeWebhookValidationError('Stripe event creation time is invalid.');
  }
  const providerCreatedAt = new Date(Number(event.created) * 1000);
  if (Number.isNaN(providerCreatedAt.getTime())) throw new StripeWebhookValidationError('Stripe event creation time is invalid.');

  if (eventType.startsWith('refund.')) {
    const data = objectRecord(event.data, 'Stripe event data');
    const refund = objectRecord(data.object, 'Stripe refund');
    const refundReference = requiredString(refund.id, 'Stripe refund reference');
    if (!STRIPE_REFUND_PATTERN.test(refundReference) || refundReference.length > 160) {
      throw new StripeWebhookValidationError('Stripe refund reference is invalid.');
    }
    const paymentIntentReference = requiredString(refund.payment_intent, 'Stripe refund PaymentIntent reference');
    if (!STRIPE_PAYMENT_INTENT_PATTERN.test(paymentIntentReference) || paymentIntentReference.length > 160) {
      throw new StripeWebhookValidationError('Stripe refund PaymentIntent reference is invalid.');
    }
    const status = requiredString(refund.status, 'Stripe refund status');
    if (!/^[a-z_]{3,80}$/.test(status)) throw new StripeWebhookValidationError('Stripe refund status is invalid.');
    if (!Number.isSafeInteger(refund.amount) || Number(refund.amount) <= 0) {
      throw new StripeWebhookValidationError('Stripe refund amount is invalid.');
    }
    const currency = requiredString(refund.currency, 'Stripe refund currency').toUpperCase();
    if (!CURRENCY_PATTERN.test(currency)) throw new StripeWebhookValidationError('Stripe refund currency is invalid.');
    return Object.freeze({
      providerEventId,
      eventType,
      providerCreatedAt,
      paymentIntent: null,
      refund: Object.freeze({
        refundReference,
        paymentIntentReference,
        status,
        currency,
        amountMinor: BigInt(Number(refund.amount)),
      }),
    });
  }

  if (!eventType.startsWith('payment_intent.')) {
    return Object.freeze({ providerEventId, eventType, providerCreatedAt, paymentIntent: null, refund: null });
  }

  const data = objectRecord(event.data, 'Stripe event data');
  const intent = objectRecord(data.object, 'Stripe PaymentIntent');
  const providerReference = requiredString(intent.id, 'Stripe PaymentIntent reference');
  if (!STRIPE_PAYMENT_INTENT_PATTERN.test(providerReference) || providerReference.length > 160) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent reference is invalid.');
  }

  const status = requiredString(intent.status, 'Stripe PaymentIntent status');
  if (!/^[a-z_]{3,80}$/.test(status)) throw new StripeWebhookValidationError('Stripe PaymentIntent status is invalid.');

  if (!Number.isSafeInteger(intent.amount) || Number(intent.amount) < 0) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent amount is invalid.');
  }
  const amountReceived = intent.amount_received ?? 0;
  if (!Number.isSafeInteger(amountReceived) || Number(amountReceived) < 0 || Number(amountReceived) > Number(intent.amount)) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent received amount is invalid.');
  }

  const currency = requiredString(intent.currency, 'Stripe PaymentIntent currency').toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new StripeWebhookValidationError('Stripe PaymentIntent currency is invalid.');

  const metadata = intent.metadata === undefined || intent.metadata === null
    ? null
    : objectRecord(intent.metadata, 'Stripe PaymentIntent metadata');
  const metadataOrganizationId = optionalString(metadata?.sf_organization_id);
  const metadataBookingId = optionalString(metadata?.sf_booking_id);

  return Object.freeze({
    providerEventId,
    eventType,
    providerCreatedAt,
    refund: null,
    paymentIntent: Object.freeze({
      providerReference,
      status,
      currency,
      amountMinor: BigInt(Number(intent.amount)),
      amountReceivedMinor: BigInt(Number(amountReceived)),
      organizationId: metadataOrganizationId && UUID_PATTERN.test(metadataOrganizationId) ? metadataOrganizationId.toLowerCase() : null,
      bookingId: metadataBookingId && UUID_PATTERN.test(metadataBookingId) ? metadataBookingId.toLowerCase() : null,
    }),
  });
}

export function selectStripeWebhookPaymentCandidate(input: {
  providerReference: string;
  providerStatus: string;
  candidates: readonly StripeWebhookPaymentCandidate[];
  isInternalReference: (reference: string) => boolean;
}): StripeWebhookPaymentCandidate | null {
  const eligible = input.candidates.filter((candidate) => (
    candidate.providerReference === input.providerReference || input.isInternalReference(candidate.providerReference)
  ));
  if (eligible.length === 0) return null;

  const exact = eligible.filter((candidate) => candidate.providerReference === input.providerReference);
  const pool = exact.length > 0 ? exact : eligible;
  const preferredKinds: readonly StripeWebhookPaymentCandidate['kind'][] = input.providerStatus === 'succeeded'
    ? ['CAPTURE', 'AUTHORIZATION']
    : input.providerStatus === 'requires_capture'
      ? ['AUTHORIZATION']
      : ['AUTHORIZATION', 'CAPTURE'];

  for (const kind of preferredKinds) {
    const matches = pool.filter((candidate) => candidate.kind === kind);
    if (matches.length > 1) throw new StripeWebhookValidationError('Stripe webhook matches multiple pending payment operations.');
    if (matches.length === 1) return matches[0];
  }

  return null;
}

export function selectStripeWebhookRefundCandidate(input: {
  refundReference: string;
  currency: string;
  amountMinor: bigint;
  candidates: readonly StripeWebhookRefundCandidate[];
  isInternalReference: (reference: string) => boolean;
}): StripeWebhookRefundCandidate | null {
  const exact = input.candidates.filter((candidate) => candidate.providerReference === input.refundReference);
  if (exact.length > 1) throw new StripeWebhookValidationError('Stripe webhook matches multiple refunds with the same provider reference.');
  if (exact.length === 1) {
    const candidate = exact[0];
    if (candidate.currency !== input.currency || candidate.amountMinor !== input.amountMinor) {
      throw new StripeWebhookValidationError('Stripe webhook refund money does not match the persisted refund.');
    }
    return candidate;
  }

  const claims = input.candidates.filter((candidate) => (
    input.isInternalReference(candidate.providerReference)
    && candidate.currency === input.currency
    && candidate.amountMinor === input.amountMinor
  ));
  if (claims.length > 1) throw new StripeWebhookValidationError('Stripe webhook matches multiple pending refund operations.');
  return claims[0] ?? null;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StripeWebhookValidationError(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new StripeWebhookValidationError(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
