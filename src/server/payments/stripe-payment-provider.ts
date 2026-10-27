import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  PaymentProviderError,
  type PaymentAuthorizationInput,
  type PaymentOperationContext,
  type PaymentProviderAdapter,
  type PaymentProviderCapability,
  type PaymentWebhookVerificationInput,
  type ProviderPaymentResult,
  type ProviderRefundResult,
} from './payment-provider.ts';
import { requestStripeApi } from './stripe-api-transport.ts';
import { assertStripeWriteResponseOwnership, classifyStripePaymentHttpError, normalizeStripeProviderResponseMoney } from './stripe-provider-response-evidence.ts';
import { parseStripeWebhookSignatureHeader } from './stripe-webhook-ingress-signature-domain.ts';
import { isKnownStripePaymentIntentStatus, isKnownStripeRefundStatus } from './stripe-provider-status.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_REFERENCE_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_PAYMENT_METHOD_PATTERN = /^pm_[A-Za-z0-9_]+$/;
const STRIPE_REFUND_PATTERN = /^re_[A-Za-z0-9_]+$/;
// PaymentTransaction provider references are VARCHAR(160).
const MAX_STRIPE_PERSISTED_REFERENCE_LENGTH = 160;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeFetch = typeof fetch;
export type StripePaymentProviderOptions = Readonly<{ secretKey: string; fetchImpl?: StripeFetch; timeoutMs?: number; webhookToleranceSeconds?: number }>;

type StripePaymentIntent = Readonly<{ id: string; status: string; amount: number; amount_received?: number; amount_capturable?: number; currency: string }>;
type StripeRefund = Readonly<{ id: string; payment_intent?: string | null; status?: string | null; amount: number; currency: string }>;
type StripeErrorResponse = Readonly<{ error?: Readonly<{ code?: string; decline_code?: string; message?: string; type?: string }> }>;

export class StripePaymentProvider implements PaymentProviderAdapter {
  readonly code = 'stripe';
  readonly capabilities: ReadonlySet<PaymentProviderCapability> = new Set(['AUTHORIZE', 'CAPTURE', 'RELEASE_AUTHORIZATION', 'REFUND', 'WEBHOOKS']);

  private readonly secretKey: string;
  private readonly fetchImpl: StripeFetch;
  private readonly timeoutMs: number;
  private readonly webhookToleranceSeconds: number;

  constructor(options: StripePaymentProviderOptions) {
    const secretKey = options.secretKey.trim();
    if (!secretKey.startsWith('sk_') || secretKey.length < 12 || secretKey.length > 4_096) throw new Error('Stripe secret key is required.');
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000)) {
      throw new Error('Stripe timeout must be between 1000 and 120000 milliseconds.');
    }
    if (options.webhookToleranceSeconds !== undefined && (!Number.isInteger(options.webhookToleranceSeconds) || options.webhookToleranceSeconds < 1 || options.webhookToleranceSeconds > 3_600)) {
      throw new Error('Stripe webhook tolerance must be between 1 and 3600 seconds.');
    }

    this.secretKey = secretKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.webhookToleranceSeconds = options.webhookToleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  }

  async authorizePayment(input: PaymentAuthorizationInput): Promise<ProviderPaymentResult> {
    const paymentMethodReference = normalizeStripePaymentMethodReference(input.paymentMethodReference);
    const form = new URLSearchParams();
    form.set('amount', input.money.amountMinor.toString());
    form.set('currency', input.money.currency.toLowerCase());
    form.set('payment_method', paymentMethodReference);
    form.set('payment_method_types[]', 'card');
    form.set('capture_method', 'manual');
    form.set('confirm', 'true');
    form.set('metadata[sf_organization_id]', input.organizationId);
    form.set('metadata[sf_booking_id]', input.bookingId);

    const intent = await this.request<StripePaymentIntent>('/payment_intents', form, input.idempotencyKey);
    assertStripeWriteResponseOwnership(intent, input.organizationId, input.bookingId);
    return normalizeAuthorizedPaymentIntent(intent, input.money);
  }

  async capturePayment(input: PaymentOperationContext & { providerReference: string }): Promise<ProviderPaymentResult> {
    const providerReference = normalizeStripePaymentIntentReference(input.providerReference);
    const form = new URLSearchParams();
    form.set('amount_to_capture', input.money.amountMinor.toString());
    const intent = await this.request<StripePaymentIntent>(`/payment_intents/${encodeURIComponent(providerReference)}/capture`, form, input.idempotencyKey);
    assertStripeWriteResponseOwnership(intent, input.organizationId, input.bookingId);
    if (intent?.id !== providerReference) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned a different PaymentIntent while capturing.', true);
    }
    return normalizeCapturedPaymentIntent(intent, input.money);
  }

  async releaseAuthorization(input: PaymentOperationContext & { providerReference: string }): Promise<ProviderPaymentResult> {
    const providerReference = normalizeStripePaymentIntentReference(input.providerReference);
    const form = new URLSearchParams();
    form.set('cancellation_reason', 'abandoned');
    const intent = await this.request<StripePaymentIntent>(
      `/payment_intents/${encodeURIComponent(providerReference)}/cancel`,
      form,
      input.idempotencyKey,
    );
    assertStripeWriteResponseOwnership(intent, input.organizationId, input.bookingId);
    if (intent?.id !== providerReference) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned a different PaymentIntent while releasing the authorization.', true);
    }
    assertKnownStripePaymentIntentStatus(intent?.status);
    const money = normalizeStripeProviderResponseMoney(intent.currency, normalizeStripeMinorAmount(intent.amount, 'authorization release amount'));
    assertMatchingMoney(money, input.money, 'authorization release');
    // A canceled intent must prove that neither received nor capturable money remains.
    // Otherwise a cancellation response is not authoritative release evidence.
    if (intent.status === 'canceled' && (
      intent.amount_received === undefined
      || intent.amount_capturable === undefined
      || normalizeStripeMinorAmount(intent.amount_received, 'authorization release received amount') !== 0n
      || normalizeStripeMinorAmount(intent.amount_capturable, 'authorization release capturable amount') !== 0n
    )) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove the authorization was fully released.', true);
    }
    if (intent.status === 'succeeded' && (
      intent.amount_received === undefined
      || intent.amount_capturable === undefined
      || normalizeStripeMinorAmount(intent.amount_received, 'authorization release received amount') !== input.money.amountMinor
      || normalizeStripeMinorAmount(intent.amount_capturable, 'authorization release capturable amount') !== 0n
    )) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove the authorization was settled.', true);
    }
    // A release request returning a nonterminal intent has not released the
    // authorization. Never claim a new AUTHORIZED result from this operation,
    // and never infer zero received/capturable money from missing fields.
    if (intent.status !== 'canceled' && intent.status !== 'succeeded') {
      if (intent.amount_received === undefined || intent.amount_capturable === undefined) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe did not provide complete pending release evidence.', true);
      }
      const received = normalizeStripeMinorAmount(intent.amount_received, 'pending release received amount');
      const capturable = normalizeStripeMinorAmount(intent.amount_capturable, 'pending release capturable amount');
      if (
        received !== 0n
        || capturable > input.money.amountMinor
        || (intent.status === 'requires_capture' && capturable === 0n)
      ) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe returned contradictory pending release evidence.', true);
      }
      return Object.freeze({ providerCode: this.code, providerReference, status: 'PENDING', money });
    }
    return normalizedIntentResult(intent, money);
  }

  async refundPayment(input: PaymentOperationContext & { providerReference: string }): Promise<ProviderRefundResult> {
    const providerReference = normalizeStripePaymentIntentReference(input.providerReference);
    const form = new URLSearchParams();
    form.set('payment_intent', providerReference);
    form.set('amount', input.money.amountMinor.toString());
    form.set('metadata[sf_organization_id]', input.organizationId);
    form.set('metadata[sf_booking_id]', input.bookingId);

    const refund = await this.request<StripeRefund>('/refunds', form, input.idempotencyKey);
    assertStripeWriteResponseOwnership(refund, input.organizationId, input.bookingId);
    if (refund?.payment_intent !== providerReference) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned a refund for a different PaymentIntent.', true);
    }
    if (typeof refund.id !== 'string' || !STRIPE_REFUND_PATTERN.test(refund.id) || refund.id.length > MAX_STRIPE_PERSISTED_REFERENCE_LENGTH) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid refund reference.', true);
    }
    const money = normalizeStripeProviderResponseMoney(refund.currency, normalizeStripeMinorAmount(refund.amount, 'refund amount'));
    assertMatchingMoney(money, input.money, 'refund');

    if (!isKnownStripeRefundStatus(refund.status)) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an unrecognized refund status.', true);
    }
    let status: ProviderRefundResult['status'];
    if (refund.status === 'succeeded') status = 'REFUNDED';
    else if (refund.status === 'failed' || refund.status === 'canceled') status = 'FAILED';
    else status = 'PENDING';

    return Object.freeze({ providerCode: this.code, providerReference, refundReference: refund.id, status, money });
  }

  verifyWebhookSignature(input: PaymentWebhookVerificationInput): boolean {
    const secret = input.secret.trim();
    if (!secret.startsWith('whsec_')) return false;
    const parsed = parseStripeWebhookSignatureHeader(input.signature);
    if (!parsed) return false;
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    if (Math.abs(nowSeconds - parsed.timestamp) > this.webhookToleranceSeconds) return false;

    const expectedBuffer = createHmac('sha256', secret).update(`${parsed.timestamp}.${input.payload}`, 'utf8').digest();
    return parsed.signatures.some((signature) => {
      const signatureBuffer = Buffer.from(signature, 'hex');
      return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
    });
  }

  private async request<T>(path: string, form: URLSearchParams, idempotencyKey: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await requestStripeApi(this.fetchImpl, `${STRIPE_API_BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey },
        body: form.toString(),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as T | StripeErrorResponse;
      if (!response.ok) throw classifyStripePaymentHttpError(response.status, payload, 'Stripe rejected the payment request.');
      return payload as T;
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      if (controller.signal.aborted) throw new PaymentProviderError('TIMEOUT', 'Stripe request timed out before a definitive result was received.', true);
      throw new PaymentProviderError('PROVIDER_UNAVAILABLE', 'Stripe could not be reached.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeStripePaymentIntentReference(value: unknown): string {
  if (typeof value !== 'string' || !STRIPE_REFERENCE_PATTERN.test(value.trim()) || value.trim().length > MAX_STRIPE_PERSISTED_REFERENCE_LENGTH) throw new PaymentProviderError('INVALID_REQUEST', 'Stripe PaymentIntent reference is invalid.');
  return value.trim();
}

/** Invalid IDs returned after provider I/O are retryable unknown truth, not caller errors. */
export function requireStripeResponsePaymentIntentReference(value: unknown): string {
  if (typeof value !== 'string' || !STRIPE_REFERENCE_PATTERN.test(value) || value.length > MAX_STRIPE_PERSISTED_REFERENCE_LENGTH) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid PaymentIntent reference.', true);
  }
  return value;
}

export function normalizeStripePaymentMethodReference(value: unknown): string {
  if (typeof value !== 'string' || !STRIPE_PAYMENT_METHOD_PATTERN.test(value.trim())) throw new PaymentProviderError('INVALID_REQUEST', 'Stripe payment method reference is invalid.');
  return value.trim();
}

function assertKnownStripePaymentIntentStatus(status: unknown): asserts status is string {
  if (typeof status !== 'string' || !isKnownStripePaymentIntentStatus(status)) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned an unrecognized PaymentIntent status.', true);
  }
}

function normalizeAuthorizedPaymentIntent(intent: StripePaymentIntent, expectedMoney: PaymentOperationContext['money']): ProviderPaymentResult {
  assertKnownStripePaymentIntentStatus(intent?.status);
  const money = normalizeStripeProviderResponseMoney(intent.currency, normalizeStripeMinorAmount(intent.amount, 'payment amount'));
  assertMatchingMoney(money, expectedMoney, 'payment');
  if (intent.status === 'requires_capture' && (
    intent.amount_capturable === undefined
    || normalizeStripeMinorAmount(intent.amount_capturable, 'capturable amount') !== expectedMoney.amountMinor
    || intent.amount_received === undefined
    || normalizeStripeMinorAmount(intent.amount_received, 'received amount') !== 0n
  )) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove the full authorization is capturable.', true);
  }
  if (intent.status === 'canceled' && (
    intent.amount_received === undefined
    || intent.amount_capturable === undefined
    || normalizeStripeMinorAmount(intent.amount_received, 'canceled authorization received amount') !== 0n
    || normalizeStripeMinorAmount(intent.amount_capturable, 'canceled authorization capturable amount') !== 0n
  )) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove that the canceled authorization holds no money.', true);
  }
  if (intent.status === 'succeeded' && (
    intent.amount_capturable === undefined
    || normalizeStripeMinorAmount(intent.amount_capturable, 'authorized payment capturable amount') !== 0n
  )) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe reported settled authorization with money still capturable.', true);
  }
  if (intent.status === 'succeeded' && (
    intent.amount_received === undefined
    || normalizeStripeMinorAmount(intent.amount_received, 'received amount') !== expectedMoney.amountMinor
  )) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove the full authorized payment was received.', true);
  }
  // A confirmed card decline is definitive only when Stripe explicitly proves
  // no money was received and no authorization remains capturable. Do not
  // mistake a reusable failed PaymentIntent for a released authorization.
  if (intent.status === 'requires_payment_method') {
    if (
      intent.amount_received === undefined
      || intent.amount_capturable === undefined
      || normalizeStripeMinorAmount(intent.amount_received, 'failed authorization received amount') !== 0n
      || normalizeStripeMinorAmount(intent.amount_capturable, 'failed authorization capturable amount') !== 0n
    ) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove the failed authorization holds no money.', true);
    }
    return Object.freeze({
      providerCode: 'stripe',
      providerReference: requireStripeResponsePaymentIntentReference(intent.id),
      status: 'FAILED',
      money,
    });
  }
  // A nonterminal authorization is not proof of money movement. Require
  // explicit zero-money evidence rather than accepting an incomplete or
  // contradictory provider response as an ordinary pending attempt.
  if (!['requires_capture', 'succeeded', 'canceled', 'requires_payment_method'].includes(intent.status) && (
    intent.amount_received === undefined
    || intent.amount_capturable === undefined
    || normalizeStripeMinorAmount(intent.amount_received, 'pending authorization received amount') !== 0n
    || normalizeStripeMinorAmount(intent.amount_capturable, 'pending authorization capturable amount') !== 0n
  )) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove that the pending authorization holds no money.', true);
  }
  return normalizedIntentResult(intent, money);
}

function normalizeCapturedPaymentIntent(intent: StripePaymentIntent, expectedMoney: PaymentOperationContext['money']): ProviderPaymentResult {
  assertKnownStripePaymentIntentStatus(intent?.status);
  const nominalAmount = normalizeStripeMinorAmount(intent.amount, 'PaymentIntent amount');
  const nominalMoney = normalizeStripeProviderResponseMoney(intent.currency, nominalAmount);
  if (nominalMoney.currency !== expectedMoney.currency) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe capture currency does not match the requested capture.', true);
  }
  if (nominalAmount < expectedMoney.amountMinor) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe capture PaymentIntent amount is smaller than the requested capture.', true);
  }
  // A capture is settled only when Stripe explicitly proves the received
  // amount. Never substitute the nominal PaymentIntent amount for missing
  // received-money evidence, including on pending responses.
  if (intent.amount_received === undefined || intent.amount_capturable === undefined) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not provide complete capture money evidence.', true);
  }
  const received = normalizeStripeMinorAmount(intent.amount_received, 'capture received amount');
  const capturable = normalizeStripeMinorAmount(intent.amount_capturable, 'capture capturable amount');
  if (received > nominalAmount || capturable > nominalAmount || received + capturable > nominalAmount) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned contradictory capture money evidence.', true);
  }
  if (intent.status === 'succeeded') {
    if (capturable !== 0n) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe reported successful capture with money still capturable.', true);
    }
    const money = normalizeStripeProviderResponseMoney(intent.currency, received);
    assertMatchingMoney(money, expectedMoney, 'capture');
    return normalizedIntentResult(intent, money);
  }
  // A canceled or reusable failed intent does not prove the capture amount
  // was received. Leave the durable claim for exact-reference recovery.
  if (intent.status === 'canceled' || intent.status === 'requires_payment_method') {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not complete the requested capture.', true);
  }
  if (received !== 0n || (intent.status === 'requires_capture' && capturable === 0n)) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned unresolved money movement during capture.', true);
  }
  // A still-capturable PaymentIntent is not a *new* successful authorization
  // from this capture operation. Report pending so the capture claim can be
  // reconciled without persisting an unsupported AUTHORIZED capture status.
  return Object.freeze({
    providerCode: 'stripe',
    providerReference: requireStripeResponsePaymentIntentReference(intent.id),
    status: 'PENDING',
    money: expectedMoney,
  });
}

function normalizeStripeMinorAmount(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PaymentProviderError('UNKNOWN', `Stripe returned an invalid ${label}.`, true);
  }
  return BigInt(value);
}

function normalizedIntentResult(intent: StripePaymentIntent, money: PaymentOperationContext['money']): ProviderPaymentResult {
  let status: ProviderPaymentResult['status'];
  if (intent.status === 'requires_capture') status = 'AUTHORIZED';
  else if (intent.status === 'succeeded') status = 'PAID';
  else if (intent.status === 'canceled') status = 'FAILED';
  else status = 'PENDING';
  return Object.freeze({ providerCode: 'stripe', providerReference: requireStripeResponsePaymentIntentReference(intent.id), status, money });
}

function assertMatchingMoney(actual: PaymentOperationContext['money'], expected: PaymentOperationContext['money'], operation: string): void {
  if (actual.currency !== expected.currency || actual.amountMinor !== expected.amountMinor) {
    throw new PaymentProviderError('UNKNOWN', `Stripe returned ${operation} money that does not match the requested amount.`, true);
  }
}

