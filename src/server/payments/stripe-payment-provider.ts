import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  PaymentProviderError,
  normalizePaymentMoney,
  type PaymentAuthorizationInput,
  type PaymentOperationContext,
  type PaymentProviderAdapter,
  type PaymentProviderCapability,
  type PaymentWebhookVerificationInput,
  type ProviderPaymentResult,
  type ProviderRefundResult,
} from './payment-provider.ts';
import { requestStripeApi } from './stripe-api-transport.ts';
import { parseStripeWebhookSignatureHeader } from './stripe-webhook-ingress-signature-domain.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_REFERENCE_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_PAYMENT_METHOD_PATTERN = /^pm_[A-Za-z0-9_]+$/;
const STRIPE_REFUND_PATTERN = /^re_[A-Za-z0-9_]+$/;
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
    return normalizeAuthorizedPaymentIntent(intent, input.money);
  }

  async capturePayment(input: PaymentOperationContext & { providerReference: string }): Promise<ProviderPaymentResult> {
    const providerReference = normalizeStripePaymentIntentReference(input.providerReference);
    const form = new URLSearchParams();
    form.set('amount_to_capture', input.money.amountMinor.toString());
    const intent = await this.request<StripePaymentIntent>(`/payment_intents/${encodeURIComponent(providerReference)}/capture`, form, input.idempotencyKey);
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
    if (intent?.id !== providerReference) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned a different PaymentIntent while releasing the authorization.', true);
    }
    const money = normalizePaymentMoney(intent.currency, normalizeStripeMinorAmount(intent.amount, 'authorization release amount'));
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
    if (refund?.payment_intent !== providerReference) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned a refund for a different PaymentIntent.', true);
    }
    if (typeof refund.id !== 'string' || !STRIPE_REFUND_PATTERN.test(refund.id)) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid refund reference.', true);
    }
    const money = normalizePaymentMoney(refund.currency, normalizeStripeMinorAmount(refund.amount, 'refund amount'));
    assertMatchingMoney(money, input.money, 'refund');

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
      if (!response.ok) throw mapStripeError(response.status, payload as StripeErrorResponse);
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
  if (typeof value !== 'string' || !STRIPE_REFERENCE_PATTERN.test(value.trim())) throw new PaymentProviderError('INVALID_REQUEST', 'Stripe PaymentIntent reference is invalid.');
  return value.trim();
}

export function normalizeStripePaymentMethodReference(value: unknown): string {
  if (typeof value !== 'string' || !STRIPE_PAYMENT_METHOD_PATTERN.test(value.trim())) throw new PaymentProviderError('INVALID_REQUEST', 'Stripe payment method reference is invalid.');
  return value.trim();
}

function normalizeAuthorizedPaymentIntent(intent: StripePaymentIntent, expectedMoney: PaymentOperationContext['money']): ProviderPaymentResult {
  const money = normalizePaymentMoney(intent.currency, normalizeStripeMinorAmount(intent.amount, 'payment amount'));
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
      providerReference: normalizeStripePaymentIntentReference(intent.id),
      status: 'FAILED',
      money,
    });
  }
  return normalizedIntentResult(intent, money);
}

function normalizeCapturedPaymentIntent(intent: StripePaymentIntent, expectedMoney: PaymentOperationContext['money']): ProviderPaymentResult {
  if (intent.status === 'canceled' && (
    intent.amount_received === undefined
    || intent.amount_capturable === undefined
    || normalizeStripeMinorAmount(intent.amount_received, 'canceled capture received amount') !== 0n
    || normalizeStripeMinorAmount(intent.amount_capturable, 'canceled capture capturable amount') !== 0n
  )) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not prove that the canceled capture holds no money.', true);
  }
  if (intent.status === 'succeeded' && (
    intent.amount_capturable === undefined
    || normalizeStripeMinorAmount(intent.amount_capturable, 'captured payment capturable amount') !== 0n
  )) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe reported successful capture with money still capturable.', true);
  }
  if (intent.status === 'succeeded' && intent.amount_received === undefined) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe did not provide a captured amount.', true);
  }
  const capturedAmount = intent.amount_received !== undefined
    ? normalizeStripeMinorAmount(intent.amount_received, 'captured amount')
    : normalizeStripeMinorAmount(intent.amount, 'capture amount');
  const money = normalizePaymentMoney(intent.currency, capturedAmount);
  assertMatchingMoney(money, expectedMoney, 'capture');
  return normalizedIntentResult(intent, money);
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
  return Object.freeze({ providerCode: 'stripe', providerReference: normalizeStripePaymentIntentReference(intent.id), status, money });
}

function assertMatchingMoney(actual: PaymentOperationContext['money'], expected: PaymentOperationContext['money'], operation: string): void {
  if (actual.currency !== expected.currency || actual.amountMinor !== expected.amountMinor) {
    throw new PaymentProviderError('UNKNOWN', `Stripe returned ${operation} money that does not match the requested amount.`, true);
  }
}

function mapStripeError(status: number, payload: StripeErrorResponse): PaymentProviderError {
  const error = payload.error;
  const message = error?.message?.trim() || 'Stripe rejected the payment request.';
  if (status === 401 || status === 403) return new PaymentProviderError('AUTHENTICATION_FAILED', message);
  if (status === 409 || error?.type === 'idempotency_error') return new PaymentProviderError('DUPLICATE', message);
  if (status === 429) return new PaymentProviderError('RATE_LIMITED', message, true);
  if (status >= 500) return new PaymentProviderError('PROVIDER_UNAVAILABLE', message, true);
  if (error?.type === 'card_error' || error?.code === 'card_declined' || error?.decline_code) return new PaymentProviderError('DECLINED', message);
  if (status >= 400 && status < 500) return new PaymentProviderError('INVALID_REQUEST', message);
  return new PaymentProviderError('UNKNOWN', message, true);
}
