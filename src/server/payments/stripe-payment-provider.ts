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

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_REFERENCE_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const STRIPE_PAYMENT_METHOD_PATTERN = /^pm_[A-Za-z0-9_]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeFetch = typeof fetch;
export type StripePaymentProviderOptions = Readonly<{ secretKey: string; fetchImpl?: StripeFetch; timeoutMs?: number; webhookToleranceSeconds?: number }>;

type StripePaymentIntent = Readonly<{ id: string; status: string; amount: number; amount_received?: number; amount_capturable?: number; currency: string }>;
type StripeRefund = Readonly<{ id: string; payment_intent?: string | null; status?: string | null; amount: number; currency: string }>;
type StripeErrorResponse = Readonly<{ error?: Readonly<{ code?: string; decline_code?: string; message?: string; type?: string }> }>;

export class StripePaymentProvider implements PaymentProviderAdapter {
  readonly code = 'stripe';
  readonly capabilities: ReadonlySet<PaymentProviderCapability> = new Set(['AUTHORIZE', 'CAPTURE', 'REFUND', 'WEBHOOKS']);

  private readonly secretKey: string;
  private readonly fetchImpl: StripeFetch;
  private readonly timeoutMs: number;
  private readonly webhookToleranceSeconds: number;

  constructor(options: StripePaymentProviderOptions) {
    const secretKey = options.secretKey.trim();
    if (!secretKey.startsWith('sk_') || secretKey.length < 12) throw new Error('Stripe secret key is required.');
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
    return normalizeCapturedPaymentIntent(intent, input.money);
  }

  async refundPayment(input: PaymentOperationContext & { providerReference: string }): Promise<ProviderRefundResult> {
    const providerReference = normalizeStripePaymentIntentReference(input.providerReference);
    const form = new URLSearchParams();
    form.set('payment_intent', providerReference);
    form.set('amount', input.money.amountMinor.toString());
    form.set('metadata[sf_organization_id]', input.organizationId);
    form.set('metadata[sf_booking_id]', input.bookingId);

    const refund = await this.request<StripeRefund>('/refunds', form, input.idempotencyKey);
    const money = normalizePaymentMoney(refund.currency, BigInt(refund.amount));
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
    const parsed = parseStripeSignature(input.signature);
    if (!parsed) return false;
    const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
    if (Math.abs(nowSeconds - parsed.timestamp) > this.webhookToleranceSeconds) return false;

    const expectedBuffer = createHmac('sha256', secret).update(`${parsed.timestamp}.${input.payload}`, 'utf8').digest();
    return parsed.signatures.some((signature) => {
      if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
      const signatureBuffer = Buffer.from(signature, 'hex');
      return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
    });
  }

  private async request<T>(path: string, form: URLSearchParams, idempotencyKey: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${STRIPE_API_BASE}${path}`, {
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
      if (error instanceof Error && error.name === 'AbortError') throw new PaymentProviderError('TIMEOUT', 'Stripe request timed out before a definitive result was received.', true);
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
  const money = normalizePaymentMoney(intent.currency, BigInt(intent.amount));
  assertMatchingMoney(money, expectedMoney, 'payment');
  return normalizedIntentResult(intent, money);
}

function normalizeCapturedPaymentIntent(intent: StripePaymentIntent, expectedMoney: PaymentOperationContext['money']): ProviderPaymentResult {
  const capturedAmount = intent.amount_received ?? (intent.status === 'succeeded' ? expectedMoney.amountMinor : BigInt(intent.amount));
  const money = normalizePaymentMoney(intent.currency, capturedAmount);
  assertMatchingMoney(money, expectedMoney, 'capture');
  return normalizedIntentResult(intent, money);
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

function parseStripeSignature(header: string): { timestamp: number; signatures: string[] } | null {
  if (typeof header !== 'string' || header.length > 4_096) return null;
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't' && value && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!timestamp || !Number.isSafeInteger(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}
