import { PaymentProviderError, normalizePaymentMoney, type PaymentMoney } from './payment-provider.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const CHECKOUT_EXPIRY_MINUTES = 30;

export type StripeCheckoutFetch = typeof fetch;

export type StripeCheckoutSessionResult = Readonly<{
  providerCode: 'stripe';
  sessionReference: string;
  checkoutUrl: string;
  expiresAt: Date;
  money: PaymentMoney;
}>;

type StripeCheckoutSessionResponse = Readonly<{
  id?: unknown;
  object?: unknown;
  url?: unknown;
  expires_at?: unknown;
  amount_total?: unknown;
  currency?: unknown;
}>;

type StripeErrorResponse = Readonly<{
  error?: Readonly<{ code?: string; decline_code?: string; message?: string; type?: string }>;
}>;

export class StripeCheckoutProvider {
  readonly code = 'stripe';

  private readonly secretKey: string;
  private readonly fetchImpl: StripeCheckoutFetch;
  private readonly timeoutMs: number;

  constructor(options: { secretKey: string; fetchImpl?: StripeCheckoutFetch; timeoutMs?: number }) {
    const secretKey = options.secretKey.trim();
    if (!secretKey.startsWith('sk_') || secretKey.length < 12) throw new Error('Stripe secret key is required.');
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000)) {
      throw new Error('Stripe timeout must be between 1000 and 120000 milliseconds.');
    }
    this.secretKey = secretKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createPaymentSession(input: {
    organizationId: string;
    bookingId: string;
    idempotencyKey: string;
    money: PaymentMoney;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string | null;
    now?: Date;
  }): Promise<StripeCheckoutSessionResult> {
    const successUrl = normalizeCheckoutReturnUrl(input.successUrl);
    const cancelUrl = normalizeCheckoutReturnUrl(input.cancelUrl);
    const expiresAt = new Date((input.now ?? new Date()).getTime() + CHECKOUT_EXPIRY_MINUTES * 60_000);
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('payment_method_types[]', 'card');
    form.set('success_url', successUrl);
    form.set('cancel_url', cancelUrl);
    form.set('client_reference_id', input.bookingId);
    form.set('expires_at', String(Math.floor(expiresAt.getTime() / 1000)));
    form.set('metadata[sf_organization_id]', input.organizationId);
    form.set('metadata[sf_booking_id]', input.bookingId);
    form.set('payment_intent_data[metadata][sf_organization_id]', input.organizationId);
    form.set('payment_intent_data[metadata][sf_booking_id]', input.bookingId);
    form.set('line_items[0][price_data][currency]', input.money.currency.toLowerCase());
    form.set('line_items[0][price_data][unit_amount]', input.money.amountMinor.toString());
    form.set('line_items[0][price_data][product_data][name]', 'Reservation');
    form.set('line_items[0][quantity]', '1');
    if (input.customerEmail) form.set('customer_email', input.customerEmail);

    const response = await this.request<StripeCheckoutSessionResponse>('/checkout/sessions', form, input.idempotencyKey);
    if (response.object !== 'checkout.session') throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout Session.', true);
    if (typeof response.id !== 'string' || !STRIPE_CHECKOUT_SESSION_PATTERN.test(response.id)) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout Session reference.', true);
    }
    if (typeof response.url !== 'string') throw new PaymentProviderError('UNKNOWN', 'Stripe did not return a Checkout URL.', true);
    const checkoutUrl = normalizeStripeCheckoutUrl(response.url);
    if (!Number.isSafeInteger(response.expires_at) || Number(response.expires_at) <= 0) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout expiry.', true);
    }
    if (!Number.isSafeInteger(response.amount_total) || Number(response.amount_total) < 0) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout amount.', true);
    }
    const money = normalizePaymentMoney(response.currency, BigInt(Number(response.amount_total)));
    if (money.currency !== input.money.currency || money.amountMinor !== input.money.amountMinor) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned Checkout money that does not match the booking total.', true);
    }

    return Object.freeze({
      providerCode: 'stripe',
      sessionReference: response.id,
      checkoutUrl,
      expiresAt: new Date(Number(response.expires_at) * 1000),
      money,
    });
  }

  private async request<T>(path: string, form: URLSearchParams, idempotencyKey: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${STRIPE_API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': idempotencyKey,
        },
        body: form.toString(),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as T | StripeErrorResponse;
      if (!response.ok) throw mapStripeCheckoutError(response.status, payload as StripeErrorResponse);
      return payload as T;
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PaymentProviderError('TIMEOUT', 'Stripe Checkout request timed out before a definitive result was received.', true);
      }
      throw new PaymentProviderError('PROVIDER_UNAVAILABLE', 'Stripe Checkout could not be reached.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeCheckoutReturnUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentProviderError('INVALID_REQUEST', 'Checkout return URL is invalid.');
  }
  const localDevelopment = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new PaymentProviderError('INVALID_REQUEST', 'Checkout return URL must use HTTPS.');
  }
  if (url.username || url.password || value.length > 2_048) {
    throw new PaymentProviderError('INVALID_REQUEST', 'Checkout return URL is invalid.');
  }
  return url.toString();
}

function normalizeStripeCheckoutUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout URL.', true);
  }
  if (url.protocol !== 'https:' || url.username || url.password || value.length > 4_096) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout URL.', true);
  }
  return url.toString();
}

function mapStripeCheckoutError(status: number, payload: StripeErrorResponse) {
  const error = payload.error;
  const message = error?.message?.trim() || 'Stripe rejected the Checkout request.';
  if (status === 401 || status === 403) return new PaymentProviderError('AUTHENTICATION_FAILED', message);
  if (status === 409 || error?.type === 'idempotency_error') return new PaymentProviderError('DUPLICATE', message);
  if (status === 429) return new PaymentProviderError('RATE_LIMITED', message, true);
  if (status >= 500) return new PaymentProviderError('PROVIDER_UNAVAILABLE', message, true);
  if (error?.type === 'card_error' || error?.code === 'card_declined' || error?.decline_code) return new PaymentProviderError('DECLINED', message);
  if (status >= 400 && status < 500) return new PaymentProviderError('INVALID_REQUEST', message);
  return new PaymentProviderError('UNKNOWN', message, true);
}
