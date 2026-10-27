import { PaymentProviderError } from './payment-provider.ts';
import { requestStripeApi } from './stripe-api-transport.ts';
import { assertStripeProviderResponseOwnership, classifyStripeLookupHttpError, normalizeStripeProviderResponseCurrency } from './stripe-provider-response-evidence.ts';
import { requireStripeResponsePaymentIntentReference, type StripeFetch } from './stripe-payment-provider.ts';
import { isKnownStripeRefundStatus } from './stripe-provider-status.ts';

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
  metadata?: unknown;
}>;

type StripeErrorResponse = Readonly<{ error?: Readonly<{ message?: string; type?: string }> }>;

export class StripeRefundReconciliationProvider {
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

  async retrieveRefund(refundReference: unknown, expected: Readonly<{ organizationId: string; bookingId: string }>): Promise<StripeRefundSnapshot> {
    const reference = normalizeStripeRefundReference(refundReference);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await requestStripeApi(this.fetchImpl, `${STRIPE_API_BASE}/refunds/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as StripeRefundResponse | StripeErrorResponse;
      if (!response.ok) throw classifyStripeLookupHttpError(response.status, payload, 'Stripe rejected the refund reconciliation request.', 'Stripe refund was not found.');
      const refund = payload as StripeRefundResponse;
      if (refund?.id !== reference) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe returned a different refund during reconciliation.', true);
      }
      assertStripeProviderResponseOwnership(refund, expected.organizationId, expected.bookingId);
      if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
        throw new PaymentProviderError('UNKNOWN', 'Stripe returned invalid refund money.', true);
      }
      const currency = normalizeStripeProviderResponseCurrency(refund.currency);
      if (typeof refund.payment_intent !== 'string') {
        throw new PaymentProviderError('UNKNOWN', 'Stripe refund is missing its PaymentIntent reference.', true);
      }
      const status = refund.status;
      if (!isKnownStripeRefundStatus(status)) throw new PaymentProviderError('UNKNOWN', 'Stripe returned an unrecognized refund status.', true);
      return Object.freeze({
        refundReference: reference,
        paymentIntentReference: requireStripeResponsePaymentIntentReference(refund.payment_intent),
        status,
        currency,
        amountMinor: BigInt(refund.amount),
      });
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      if (controller.signal.aborted) throw new PaymentProviderError('TIMEOUT', 'Stripe refund reconciliation request timed out.', true);
      throw new PaymentProviderError('PROVIDER_UNAVAILABLE', 'Stripe could not be reached for refund reconciliation.', true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeStripeRefundReference(value: unknown): string {
  if (typeof value !== 'string' || !STRIPE_REFUND_PATTERN.test(value) || value.length > 160) {
    throw new PaymentProviderError('INVALID_REQUEST', 'Stripe refund reference is invalid.');
  }
  return value;
}

