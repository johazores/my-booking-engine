import { PaymentProviderError, normalizePaymentMoney, type PaymentMoney } from './payment-provider.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_CHECKOUT_SESSION_PATTERN = /^cs_[A-Za-z0-9_]+$/;
const STRIPE_PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 15_000;
const CHECKOUT_EXPIRY_MINUTES = 30;

export type StripeCheckoutFetch = typeof fetch;
export type StripeCheckoutPurpose = 'booking-payment' | 'commercial-amendment-recovery';

export type StripeCheckoutSessionResult = Readonly<{
  providerCode: 'stripe';
  sessionReference: string;
  checkoutUrl: string;
  expiresAt: Date;
  money: PaymentMoney;
}>;

export type StripeCheckoutSessionSnapshot = Readonly<{
  providerCode: 'stripe';
  sessionReference: string;
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  paymentIntentReference: string | null;
  money: PaymentMoney;
  organizationId: string | null;
  bookingId: string | null;
  commercialAmendmentId: string | null;
  purpose: string | null;
}>;

type StripeCheckoutSessionResponse = Readonly<{
  id?: unknown;
  object?: unknown;
  url?: unknown;
  expires_at?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  status?: unknown;
  payment_status?: unknown;
  payment_intent?: unknown;
  metadata?: unknown;
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
    purpose?: StripeCheckoutPurpose;
    commercialAmendmentId?: string | null;
  }): Promise<StripeCheckoutSessionResult> {
    const successUrl = normalizeCheckoutReturnUrl(input.successUrl);
    const cancelUrl = normalizeCheckoutReturnUrl(input.cancelUrl);
    const purpose = input.purpose ?? 'booking-payment';
    const commercialAmendmentId = input.commercialAmendmentId?.trim().toLowerCase() ?? null;
    if (purpose === 'commercial-amendment-recovery') {
      if (!commercialAmendmentId || !UUID_PATTERN.test(commercialAmendmentId)) {
        throw new PaymentProviderError('INVALID_REQUEST', 'Commercial amendment recovery Checkout requires a valid amendment ID.');
      }
    } else if (commercialAmendmentId) {
      throw new PaymentProviderError('INVALID_REQUEST', 'Commercial amendment metadata is only valid for recovery Checkout.');
    }

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
    if (purpose === 'commercial-amendment-recovery') {
      form.set('metadata[sf_checkout_purpose]', purpose);
      form.set('metadata[sf_commercial_amendment_id]', commercialAmendmentId!);
      form.set('payment_intent_data[metadata][sf_checkout_purpose]', purpose);
      form.set('payment_intent_data[metadata][sf_commercial_amendment_id]', commercialAmendmentId!);
    }
    form.set('line_items[0][price_data][currency]', input.money.currency.toLowerCase());
    form.set('line_items[0][price_data][unit_amount]', input.money.amountMinor.toString());
    form.set(
      'line_items[0][price_data][product_data][name]',
      purpose === 'commercial-amendment-recovery' ? 'Reservation recovery payment' : 'Reservation',
    );
    form.set('line_items[0][quantity]', '1');
    if (input.customerEmail) form.set('customer_email', input.customerEmail);

    const response = await this.requestPost<StripeCheckoutSessionResponse>('/checkout/sessions', form, input.idempotencyKey);
    if (response.object !== 'checkout.session') throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout Session.', true);
    if (typeof response.id !== 'string' || !STRIPE_CHECKOUT_SESSION_PATTERN.test(response.id)) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout Session reference.', true);
    }
    if (typeof response.url !== 'string') throw new PaymentProviderError('UNKNOWN', 'Stripe did not return a Checkout URL.', true);
    const checkoutUrl = normalizeStripeCheckoutUrl(response.url);
    if (!Number.isSafeInteger(response.expires_at) || Number(response.expires_at) <= 0) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout expiry.', true);
    }
    const money = normalizeCheckoutMoney(response);
    if (money.currency !== input.money.currency || money.amountMinor !== input.money.amountMinor) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned Checkout money that does not match the requested payment amount.', true);
    }

    return Object.freeze({
      providerCode: 'stripe',
      sessionReference: response.id,
      checkoutUrl,
      expiresAt: new Date(Number(response.expires_at) * 1000),
      money,
    });
  }

  async retrievePaymentSession(sessionReference: string): Promise<StripeCheckoutSessionSnapshot> {
    if (!STRIPE_CHECKOUT_SESSION_PATTERN.test(sessionReference) || sessionReference.length > 160) {
      throw new PaymentProviderError('INVALID_REQUEST', 'Stripe Checkout Session reference is invalid.');
    }
    const response = await this.requestGet<StripeCheckoutSessionResponse>(`/checkout/sessions/${encodeURIComponent(sessionReference)}`);
    if (response.object !== 'checkout.session' || response.id !== sessionReference) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned a different Checkout Session.', true);
    }
    const status = normalizeCheckoutStatus(response.status);
    const paymentStatus = normalizeCheckoutPaymentStatus(response.payment_status);
    const paymentIntentReference = normalizePaymentIntentReference(response.payment_intent);
    const metadata = normalizeCheckoutMetadata(response.metadata);

    return Object.freeze({
      providerCode: 'stripe',
      sessionReference,
      status,
      paymentStatus,
      paymentIntentReference,
      money: normalizeCheckoutMoney(response),
      organizationId: normalizeMetadataUuid(metadata.sf_organization_id),
      bookingId: normalizeMetadataUuid(metadata.sf_booking_id),
      commercialAmendmentId: normalizeMetadataUuid(metadata.sf_commercial_amendment_id),
      purpose: normalizeOptionalString(metadata.sf_checkout_purpose),
    });
  }

  private async requestPost<T>(path: string, form: URLSearchParams, idempotencyKey: string): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: form.toString(),
    });
  }

  private async requestGet<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${STRIPE_API_BASE}${path}`, {
        ...init,
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

function normalizeCheckoutMoney(response: StripeCheckoutSessionResponse) {
  if (!Number.isSafeInteger(response.amount_total) || Number(response.amount_total) < 0) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout amount.', true);
  }
  return normalizePaymentMoney(response.currency, BigInt(Number(response.amount_total)));
}

function normalizeCheckoutStatus(value: unknown): StripeCheckoutSessionSnapshot['status'] {
  if (value === 'open' || value === 'complete' || value === 'expired') return value;
  throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout Session status.', true);
}

function normalizeCheckoutPaymentStatus(value: unknown): StripeCheckoutSessionSnapshot['paymentStatus'] {
  if (value === 'paid' || value === 'unpaid' || value === 'no_payment_required') return value;
  throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout payment status.', true);
}

function normalizePaymentIntentReference(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && STRIPE_PAYMENT_INTENT_PATTERN.test(value) && value.length <= 160) return value;
  throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid Checkout PaymentIntent reference.', true);
}

function normalizeCheckoutMetadata(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned invalid Checkout metadata.', true);
  }
  return value as Record<string, unknown>;
}

function normalizeMetadataUuid(value: unknown) {
  const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null;
  return normalized && UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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
