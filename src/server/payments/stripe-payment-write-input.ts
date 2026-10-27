import {
  PaymentInputValidationError,
  PaymentProviderError,
  normalizePaymentIdempotencyKey,
  normalizePaymentMoney,
  type PaymentOperationContext,
} from './payment-provider.ts';

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_SAFE_STRIPE_MINOR_AMOUNT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Reject invalid commercial write identity and money before Stripe receives
 * an idempotent request. Normalizing a tenant, key, or currency here could
 * silently change the operation whose provider side effect is being created.
 */
export function assertStripePaymentWriteInput(input: PaymentOperationContext): void {
  const invalid = () => new PaymentProviderError('INVALID_REQUEST', 'Stripe payment write identity or money is invalid.');
  if (
    !input || typeof input !== 'object'
    || typeof input.organizationId !== 'string' || !CANONICAL_UUID_PATTERN.test(input.organizationId)
    || typeof input.bookingId !== 'string' || !CANONICAL_UUID_PATTERN.test(input.bookingId)
    || typeof input.idempotencyKey !== 'string'
  ) {
    throw invalid();
  }
  const money = input.money;
  if (
    !money || typeof money !== 'object'
    || typeof money.currency !== 'string'
    || typeof money.amountMinor !== 'bigint'
    || money.amountMinor <= 0n
    || money.amountMinor > MAX_SAFE_STRIPE_MINOR_AMOUNT
  ) {
    throw invalid();
  }
  try {
    if (
      normalizePaymentIdempotencyKey(input.idempotencyKey) !== input.idempotencyKey
      || normalizePaymentMoney(money.currency, money.amountMinor).currency !== money.currency
    ) {
      throw invalid();
    }
  } catch (error) {
    if (error instanceof PaymentInputValidationError) throw invalid();
    throw error;
  }
}
