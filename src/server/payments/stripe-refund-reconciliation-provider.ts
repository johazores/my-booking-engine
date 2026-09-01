import { PaymentProviderError } from './payment-provider.ts';
import { normalizeStripePaymentIntentReference, type StripeFetch } from './stripe-payment-provider.ts';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_REFUND_PATTERN = /^re_[A-Za-z0-9_]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;

export type StripeRefundSnapshot = Readonly<{
  refundReference: string;
  paymentIntentReference: string;
  status: string;
  currency: string;
  amountMinor: bigint;
}>;

type StripeRefundResponse = Readonly<{
  id: string;
  payment_intent?: string | null;
  status?: string | null;
  currency: string;
  amount: number;
}>;

type StripeErrorResponse = Readonly<{ error?: Readonly<{ message?: string; type?: string }> }>;

export class StripeRefundReconciliationProvider {
  private readonly secretKey: string;
  private readonly fetchImpl: StripeFetch;
  private readonly timeoutMs: number;

  constructor(options: { secretKey: string; fetchImpl?: StripeFetch; timeoutMs?: number }) {
    const secretKey = options.secretKey.trim();
    if (!secretKey.startsWith('sk_') || secretKey.length < 12) throw new Error('Stripe secret key is required.');
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000)) {
      throw new Error('Stripe timeout must be between 1000 and 120000 milliseconds.');
    }
    this.secretKey = secretKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async retrieveRefund(refundReference: unknown): Promise<StripeRefundSnapshot> {
    const reference = normalizeStripeRefundReference(refundReference);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${STRIPE_API_BASE}/refunds/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as StripeRefundResponse | StripeErrorResponse;
      if (!response.ok) throw mapStripeLookupError(response.status, payload as StripeErrorResponse);
      const refund = payload as StripeRefundResponse;
      if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe returned invalid refund money.', true);
      }
      const currency = typeof refund.currency === 'string' ? refund.currency.trim().toUpperCase() : '';
      if (!/^[A-Z]{3}$/.test(currency)) throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid refund currency.', true);
      if (typeof refund.payment_intent !== 'string') {
        throw new PaymentProviderError('UNKNOWN', 'Stripe refund is missing its PaymentIntent reference.', true);
      }
      const status = typeof refund.status === 'string' ? refund.status.trim().toLowerCase() : '';
      if (!/^[a-z_]{3,80}$/.test(status)) throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid refund status.', true);
      return Object.freeze({
        refundReference: normalizeStripeRefundReference(refund.id),
        paymentIntentReference: normalizeStripePaymentIntentReference(refund.payment_intent),
        status,
        currency,
        amountMinor: BigInt(refund.amount),
      });
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new PaymentProviderError('TIMEOUT', 'Stripe refund reconciliation request timed out.', true);
      throw new PaymentProviderError('PROVIDER_UNAVAILABLE', 'Stripe could not be reached for refund reconciliation.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeStripeRefundReference(value: unknown): string {
  if (typeof value !== 'string' || !STRIPE_REFUND_PATTERN.test(value.trim())) {
    throw new PaymentProviderError('INVALID_REQUEST', 'Stripe refund reference is invalid.');
  }
  return value.trim();
}

function mapStripeLookupError(status: number, payload: StripeErrorResponse): PaymentProviderError {
  const message = payload.error?.message?.trim() || 'Stripe rejected the refund reconciliation request.';
  if (status === 401 || status === 403) return new PaymentProviderError('AUTHENTICATION_FAILED', message);
  if (status === 404) return new PaymentProviderError('INVALID_REQUEST', 'Stripe refund was not found.');
  if (status === 429) return new PaymentProviderError('RATE_LIMITED', message, true);
  if (status >= 500) return new PaymentProviderError('PROVIDER_UNAVAILABLE', message, true);
  if (status >= 400) return new PaymentProviderError('INVALID_REQUEST', message);
  return new PaymentProviderError('UNKNOWN', message, true);
}
