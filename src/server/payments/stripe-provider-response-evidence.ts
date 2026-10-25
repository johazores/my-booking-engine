import { isSupportedCurrencyCode } from '../pricing/money.ts';

import {
  PaymentInputValidationError,
  PaymentProviderError,
  normalizePaymentMoney,
  type PaymentMoney,
} from './payment-provider.ts';

export function isCanonicalStripeProviderCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]{3}$/.test(value) && isSupportedCurrencyCode(value.toUpperCase());
}

/** Stripe API currencies are exact lowercase ISO codes, not caller inputs. */
export function normalizeStripeProviderResponseMoney(currency: unknown, amountMinor: bigint): PaymentMoney {
  if (!isCanonicalStripeProviderCurrency(currency)) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned invalid currency evidence.', true);
  }
  try {
    return normalizePaymentMoney(currency, amountMinor);
  } catch (error) {
    if (error instanceof PaymentInputValidationError) {
      throw new PaymentProviderError('UNKNOWN', 'Stripe returned invalid money evidence.', true);
    }
    throw error;
  }
}

export function normalizeStripeProviderResponseCurrency(currency: unknown): string {
  return normalizeStripeProviderResponseMoney(currency, 0n).currency;
}

/** A successful HTTP response cannot make null, arrays, or scalar JSON a Stripe resource. */
export function assertStripeProviderResponseObject(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned an invalid response object.', true);
  }
}

/** Malformed Stripe error bodies must not hide the actual HTTP failure classification. */
export function readStripeProviderError(payload: unknown, fallback: string) {
  const envelope = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown> : null;
  const value = envelope?.error;
  const detail = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  const rawMessage = typeof detail?.message === 'string' ? detail.message : '';
  const message = rawMessage.trim();
  return Object.freeze({
    message: message && rawMessage.length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(rawMessage) ? message : fallback,
    type: typeof detail?.type === 'string' ? detail.type : null,
    code: typeof detail?.code === 'string' ? detail.code : null,
    declineCode: typeof detail?.decline_code === 'string' ? detail.decline_code : null,
  });
}
