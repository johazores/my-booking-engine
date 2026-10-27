import { isKnownStripePaymentIntentStatus, isKnownStripeRefundStatus } from './stripe-provider-status.ts';
import { isCanonicalStripeProviderCurrency } from './stripe-provider-response-evidence.ts';

const STRIPE_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_]+$/;
const STRIPE_EVENT_TYPE_PATTERN = /^[a-z0-9_.]{3,120}$/;
const STRIPE_PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]+$/;
const STRIPE_REFUND_PATTERN = /^re_[A-Za-z0-9_]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type StripeWebhookPaymentIntent = Readonly<{
  providerReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
  amountReceivedMinor: bigint;
  amountCapturableMinor: bigint;
  organizationId: string | null;
  bookingId: string | null;
}>;

export type StripeWebhookCheckoutCommercialContext = Readonly<{
  purpose: string | null;
  amendmentId: string | null;
}>;

export type StripeWebhookCheckoutSession = Readonly<{
  providerReference: string;
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  currency: string;
  amountTotalMinor: bigint;
  paymentIntentReference: string | null;
  organizationId: string | null;
  bookingId: string | null;
  mode: string | null;
  clientReferenceId: string | null;
  expiresAt: Date | null;
  commercialContext: StripeWebhookCheckoutCommercialContext | null;
}>;

export type StripeWebhookRefund = Readonly<{
  refundReference: string;
  paymentIntentReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
  organizationId: string | null;
  bookingId: string | null;
}>;

/** Signed refund metadata is an additional ownership check, not settlement-source authority. */
export function isStripeWebhookRefundOwnedBy(
  refund: StripeWebhookRefund,
  organizationId: string,
  bookingId?: string,
): boolean {
  return refund.organizationId === organizationId
    && refund.bookingId !== null
    && (bookingId === undefined || refund.bookingId === bookingId);
}

export type StripeWebhookEvent = Readonly<{
  providerEventId: string;
  eventType: string;
  providerCreatedAt: Date;
  paymentIntent: StripeWebhookPaymentIntent | null;
  checkoutSession: StripeWebhookCheckoutSession | null;
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

export type StripeCheckoutExpirationDecision = Readonly<{
  action: 'CANCEL_BOOKING' | 'KEEP_FOR_PAYMENT_RECOVERY' | 'IGNORE_TERMINAL';
  note: string;
}>;

export type StripeBookingCheckoutAuthorityDecision = Readonly<
  | { valid: true }
  | {
      valid: false;
      processingNote:
        | 'checkout-session-mode-mismatch'
        | 'checkout-session-client-reference-mismatch'
        | 'checkout-session-commercial-context-mismatch'
        | 'checkout-session-expiry-mismatch';
    }
>;

export class StripeWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookValidationError';
  }
}

export function inspectStripeBookingCheckoutAuthority(input: {
  checkoutSession: StripeWebhookCheckoutSession;
  bookingId: string;
  expiresAt: Date;
}): StripeBookingCheckoutAuthorityDecision {
  if (input.checkoutSession.mode !== 'payment') {
    return Object.freeze({ valid: false, processingNote: 'checkout-session-mode-mismatch' });
  }
  if (input.checkoutSession.clientReferenceId !== input.bookingId.toLowerCase()) {
    return Object.freeze({ valid: false, processingNote: 'checkout-session-client-reference-mismatch' });
  }
  if (input.checkoutSession.commercialContext !== null) {
    return Object.freeze({ valid: false, processingNote: 'checkout-session-commercial-context-mismatch' });
  }
  if (
    !input.checkoutSession.expiresAt
    || Number.isNaN(input.expiresAt.getTime())
    || input.checkoutSession.expiresAt.getTime() !== input.expiresAt.getTime()
  ) {
    return Object.freeze({ valid: false, processingNote: 'checkout-session-expiry-mismatch' });
  }
  return Object.freeze({ valid: true });
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
    if (!isKnownStripeRefundStatus(status)) throw new StripeWebhookValidationError('Stripe refund status is not recognized.');
    if (!Number.isSafeInteger(refund.amount) || Number(refund.amount) <= 0) {
      throw new StripeWebhookValidationError('Stripe refund amount is invalid.');
    }
    const currency = requiredStripeWebhookCurrency(refund.currency, 'Stripe refund currency');
    const metadata = refund.metadata === undefined || refund.metadata === null
      ? null
      : objectRecord(refund.metadata, 'Stripe refund metadata');
    const metadataOrganizationId = optionalMetadataUuid(metadata?.sf_organization_id);
    const metadataBookingId = optionalMetadataUuid(metadata?.sf_booking_id);
    return Object.freeze({
      providerEventId,
      eventType,
      providerCreatedAt,
      paymentIntent: null,
      checkoutSession: null,
      refund: Object.freeze({
        refundReference,
        paymentIntentReference,
        status,
        currency,
        amountMinor: BigInt(Number(refund.amount)),
        organizationId: metadataOrganizationId,
        bookingId: metadataBookingId,
      }),
    });
  }

  if (eventType.startsWith('checkout.session.')) {
    const data = objectRecord(event.data, 'Stripe event data');
    const session = objectRecord(data.object, 'Stripe Checkout Session');
    const providerReference = requiredString(session.id, 'Stripe Checkout Session reference');
    if (!STRIPE_CHECKOUT_SESSION_PATTERN.test(providerReference) || providerReference.length > 160) {
      throw new StripeWebhookValidationError('Stripe Checkout Session reference is invalid.');
    }
    const status = requiredString(session.status, 'Stripe Checkout Session status');
    if (!['open', 'complete', 'expired'].includes(status)) {
      throw new StripeWebhookValidationError('Stripe Checkout Session status is invalid.');
    }
    const paymentStatus = requiredString(session.payment_status, 'Stripe Checkout Session payment status');
    if (!['paid', 'unpaid', 'no_payment_required'].includes(paymentStatus)) {
      throw new StripeWebhookValidationError('Stripe Checkout Session payment status is invalid.');
    }
    if (!Number.isSafeInteger(session.amount_total) || Number(session.amount_total) < 0) {
      throw new StripeWebhookValidationError('Stripe Checkout Session total is invalid.');
    }
    const currency = requiredStripeWebhookCurrency(session.currency, 'Stripe Checkout Session currency');

    const paymentIntentReference = optionalString(session.payment_intent);
    if (paymentIntentReference && (!STRIPE_PAYMENT_INTENT_PATTERN.test(paymentIntentReference) || paymentIntentReference.length > 160)) {
      throw new StripeWebhookValidationError('Stripe Checkout Session PaymentIntent reference is invalid.');
    }
    const metadata = session.metadata === undefined || session.metadata === null
      ? null
      : objectRecord(session.metadata, 'Stripe Checkout Session metadata');
    const metadataOrganizationId = optionalMetadataUuid(metadata?.sf_organization_id);
    const metadataBookingId = optionalMetadataUuid(metadata?.sf_booking_id);
    const mode = optionalString(session.mode);
    const clientReferenceId = optionalMetadataUuid(session.client_reference_id);
    const expiresAt = optionalUnixSecondsDate(session.expires_at);
    const hasCommercialContext = Boolean(metadata) && (
      Object.prototype.hasOwnProperty.call(metadata, 'sf_checkout_purpose')
      || Object.prototype.hasOwnProperty.call(metadata, 'sf_commercial_amendment_id')
    );
    const commercialAmendmentId = optionalMetadataUuid(metadata?.sf_commercial_amendment_id);
    const commercialContext = hasCommercialContext
      ? Object.freeze({
          purpose: optionalExactMetadataString(metadata?.sf_checkout_purpose),
          amendmentId: commercialAmendmentId,
        })
      : null;

    return Object.freeze({
      providerEventId,
      eventType,
      providerCreatedAt,
      paymentIntent: null,
      refund: null,
      checkoutSession: Object.freeze({
        providerReference,
        status: status as StripeWebhookCheckoutSession['status'],
        paymentStatus: paymentStatus as StripeWebhookCheckoutSession['paymentStatus'],
        currency,
        amountTotalMinor: BigInt(Number(session.amount_total)),
        paymentIntentReference,
        organizationId: metadataOrganizationId,
        bookingId: metadataBookingId,
        mode,
        clientReferenceId,
        expiresAt,
        commercialContext,
      }),
    });
  }

  if (!eventType.startsWith('payment_intent.')) {
    return Object.freeze({ providerEventId, eventType, providerCreatedAt, paymentIntent: null, checkoutSession: null, refund: null });
  }

  const data = objectRecord(event.data, 'Stripe event data');
  const intent = objectRecord(data.object, 'Stripe PaymentIntent');
  const providerReference = requiredString(intent.id, 'Stripe PaymentIntent reference');
  if (!STRIPE_PAYMENT_INTENT_PATTERN.test(providerReference) || providerReference.length > 160) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent reference is invalid.');
  }

  const status = requiredString(intent.status, 'Stripe PaymentIntent status');
  if (!isKnownStripePaymentIntentStatus(status)) throw new StripeWebhookValidationError('Stripe PaymentIntent status is not recognized.');

  if (!Number.isSafeInteger(intent.amount) || Number(intent.amount) < 0) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent amount is invalid.');
  }
  // Signed nonterminal snapshots can later influence commercial recovery.
  // Never replace missing provider money with zero.
  if (intent.amount_received === undefined || intent.amount_capturable === undefined) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent money evidence is missing.');
  }
  const amountReceived = intent.amount_received;
  const amountCapturable = intent.amount_capturable;
  if (!Number.isSafeInteger(amountCapturable) || Number(amountCapturable) < 0 || Number(amountCapturable) > Number(intent.amount)) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent capturable amount is invalid.');
  }
  if (!Number.isSafeInteger(amountReceived) || Number(amountReceived) < 0 || Number(amountReceived) > Number(intent.amount)) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent received amount is invalid.');
  }
  if (Number(amountReceived) + Number(amountCapturable) > Number(intent.amount)) {
    throw new StripeWebhookValidationError('Stripe PaymentIntent received and capturable money exceed the nominal amount.');
  }

  if (status === 'canceled' && (Number(amountReceived) !== 0 || Number(amountCapturable) !== 0)) {
    throw new StripeWebhookValidationError('Stripe canceled PaymentIntent still reports received or capturable money.');
  }
  if (status === 'requires_payment_method' && (Number(amountReceived) !== 0 || Number(amountCapturable) !== 0)) {
    throw new StripeWebhookValidationError('Stripe failed PaymentIntent still reports received or capturable money.');
  }
  if (status === 'succeeded' && Number(amountCapturable) !== 0) {
    throw new StripeWebhookValidationError('Stripe settled PaymentIntent still reports capturable money.');
  }

  const currency = requiredStripeWebhookCurrency(intent.currency, 'Stripe PaymentIntent currency');

  const metadata = intent.metadata === undefined || intent.metadata === null
    ? null
    : objectRecord(intent.metadata, 'Stripe PaymentIntent metadata');
  const metadataOrganizationId = optionalMetadataUuid(metadata?.sf_organization_id);
  const metadataBookingId = optionalMetadataUuid(metadata?.sf_booking_id);

  return Object.freeze({
    providerEventId,
    eventType,
    providerCreatedAt,
    refund: null,
    checkoutSession: null,
    paymentIntent: Object.freeze({
      providerReference,
      status,
      currency,
      amountMinor: BigInt(Number(intent.amount)),
      amountReceivedMinor: BigInt(Number(amountReceived)),
      amountCapturableMinor: BigInt(Number(amountCapturable)),
      organizationId: metadataOrganizationId,
      bookingId: metadataBookingId,
    }),
  });
}

export function decideStripeCheckoutExpiration(input: {
  checkoutStatus: StripeWebhookCheckoutSession['status'];
  checkoutPaymentStatus: StripeWebhookCheckoutSession['paymentStatus'];
  checkoutPaymentIntentReference: string | null;
  bookingStatus: string;
  bookingPaymentStatus: string;
  paymentTransactionStatus: string;
  paymentTransactionProviderReference: string;
  hasSuccessfulPayment: boolean;
  isInternalReference: (reference: string) => boolean;
}): StripeCheckoutExpirationDecision {
  if (input.bookingStatus !== 'CONFIRMED') {
    return Object.freeze({ action: 'IGNORE_TERMINAL', note: 'checkout-session-booking-not-confirmed' });
  }
  if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'AUTHORIZED'].includes(input.bookingPaymentStatus) || input.hasSuccessfulPayment) {
    return Object.freeze({ action: 'KEEP_FOR_PAYMENT_RECOVERY', note: 'checkout-session-payment-already-recorded' });
  }
  if (input.checkoutStatus !== 'expired' || input.checkoutPaymentStatus !== 'unpaid') {
    return Object.freeze({ action: 'KEEP_FOR_PAYMENT_RECOVERY', note: 'checkout-session-expiry-state-mismatch' });
  }
  if (input.checkoutPaymentIntentReference) {
    return Object.freeze({ action: 'KEEP_FOR_PAYMENT_RECOVERY', note: 'checkout-session-expired-payment-intent-present' });
  }
  if (input.paymentTransactionStatus !== 'PENDING' || !input.isInternalReference(input.paymentTransactionProviderReference)) {
    return Object.freeze({ action: 'KEEP_FOR_PAYMENT_RECOVERY', note: 'checkout-session-payment-claim-not-pending' });
  }
  return Object.freeze({ action: 'CANCEL_BOOKING', note: 'checkout-session-expired-booking-cancelled' });
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

function requiredStripeWebhookCurrency(value: unknown, label: string): string {
  if (!isCanonicalStripeProviderCurrency(value)) throw new StripeWebhookValidationError(`${label} is invalid.`);
  return value.toUpperCase();
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new StripeWebhookValidationError(`${label} is required.`);
  // Provider event IDs, resource IDs, event types, and statuses are exact
  // signed machine tokens. Do not repair malformed values by trimming them.
  return value;
}

/** Signed Stripe ownership and operation identity must be canonical exact provider text. */
function optionalMetadataUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function optionalExactMetadataString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim() ? value : null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  // Checkout mode and optional PaymentIntent references must remain exact.
  return value;
}

function optionalUnixSecondsDate(value: unknown): Date | null {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) return null;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}
