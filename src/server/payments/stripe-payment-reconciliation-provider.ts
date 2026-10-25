import { PaymentProviderError } from './payment-provider.ts';
import { requestStripeApi } from './stripe-api-transport.ts';
import { normalizeStripePaymentIntentReference, type StripeFetch } from './stripe-payment-provider.ts';
import { isKnownStripePaymentIntentStatus } from './stripe-provider-status.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

export type StripePaymentIntentSnapshot = Readonly<{
  providerReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
  amountReceivedMinor: bigint;
  amountCapturableMinor: bigint;
}>;

type StripePaymentIntentResponse = Readonly<{
  id: string;
  status: string;
  currency: string;
  amount: number;
  amount_received?: number;
  amount_capturable?: number;
}>;

type StripeErrorResponse = Readonly<{ error?: Readonly<{ message?: string; type?: string }> }>;

export class StripePaymentReconciliationProvider {
  private readonly secretKey: string;
  private readonly fetchImpl: StripeFetch;
  private readonly timeoutMs: number;

  constructor(options: { secretKey: string; fetchImpl?: StripeFetch; timeoutMs?: number }) {
    const secretKey = options.secretKey.trim();
    if (!secretKey.startsWith('sk_') || secretKey.length < 12 || secretKey.length > 4_096) throw new Error('Stripe secret key is required.');
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000)) {
      throw new Error('Stripe timeout must be between 1000 and 120000 milliseconds.');
    }
    this.secretKey = secretKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async retrievePaymentIntent(providerReference: unknown): Promise<StripePaymentIntentSnapshot> {
    const reference = normalizeStripePaymentIntentReference(providerReference);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await requestStripeApi(this.fetchImpl, `${STRIPE_API_BASE}/payment_intents/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as StripePaymentIntentResponse | StripeErrorResponse;
      if (!response.ok) throw mapStripeLookupError(response.status, payload as StripeErrorResponse);
      const intent = payload as StripePaymentIntentResponse;
      if (intent?.id !== reference) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe returned a different PaymentIntent during reconciliation.', true);
      }
      if (!isKnownStripePaymentIntentStatus(intent.status)) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe returned an unrecognized PaymentIntent status.', true);
      }
      if (intent.status === 'requires_capture' && (
        intent.amount_received === undefined || intent.amount_capturable === undefined
      )) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe did not provide complete capturable authorization evidence.', true);
      }
      if (intent.status === 'requires_payment_method' && (
        intent.amount_received === undefined || intent.amount_capturable === undefined
      )) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe did not provide complete failed PaymentIntent money evidence.', true);
      }
      // Terminal states are used by commercial-amendment recovery to prove
      // released or settled funds. Never turn missing provider fields into zero.
      if ((intent.status === 'canceled' || intent.status === 'succeeded') && (
        intent.amount_received === undefined || intent.amount_capturable === undefined
      )) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe did not provide complete terminal PaymentIntent money evidence.', true);
      }
      const amountReceived = intent.amount_received ?? 0;
      const amountCapturable = intent.amount_capturable ?? 0;
      if (
        !Number.isSafeInteger(intent.amount) || intent.amount < 0
        || !Number.isSafeInteger(amountReceived) || amountReceived < 0 || amountReceived > intent.amount
        || !Number.isSafeInteger(amountCapturable) || amountCapturable < 0 || amountCapturable > intent.amount
      ) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe returned invalid PaymentIntent money.', true);
      }
      if (intent.status === 'canceled' && (amountReceived !== 0 || amountCapturable !== 0)) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe canceled PaymentIntent still reports received or capturable money.', true);
      }
      if (intent.status === 'requires_payment_method' && (amountReceived !== 0 || amountCapturable !== 0)) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe failed PaymentIntent still reports received or capturable money.', true);
      }
      if (intent.status === 'succeeded' && amountCapturable !== 0) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe settled PaymentIntent still reports capturable money.', true);
      }
      const currency = typeof intent.currency === 'string' ? intent.currency.trim().toUpperCase() : '';
      if (!/^[A-Z]{3}$/.test(currency)) throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid PaymentIntent currency.', true);
      return Object.freeze({
        providerReference: reference,
        status: intent.status,
        currency,
        amountMinor: BigInt(intent.amount),
        amountReceivedMinor: BigInt(amountReceived),
        amountCapturableMinor: BigInt(amountCapturable),
      });
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      if (controller.signal.aborted) throw new PaymentProviderError('TIMEOUT', 'Stripe reconciliation request timed out.', true);
      throw new PaymentProviderError('PROVIDER_UNAVAILABLE', 'Stripe could not be reached for reconciliation.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function mapStripeLookupError(status: number, payload: StripeErrorResponse): PaymentProviderError {
  const message = payload.error?.message?.trim() || 'Stripe rejected the reconciliation request.';
  if (status === 401 || status === 403) return new PaymentProviderError('AUTHENTICATION_FAILED', message);
  if (status === 404) return new PaymentProviderError('INVALID_REQUEST', 'Stripe PaymentIntent was not found.');
  if (status === 429) return new PaymentProviderError('RATE_LIMITED', message, true);
  if (status >= 500) return new PaymentProviderError('PROVIDER_UNAVAILABLE', message, true);
  if (status >= 400) return new PaymentProviderError('INVALID_REQUEST', message);
  return new PaymentProviderError('UNKNOWN', message, true);
}
