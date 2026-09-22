import {
  inspectPaymentProviderFailure,
  type PaymentProviderFailure,
  type PaymentProviderFailureCode,
} from './payment-provider.ts';

const PAYMENT_PROVIDER_CLIENT_MESSAGES = Object.freeze({
  INVALID_REQUEST: 'Payment provider rejected the operation.',
  AUTHENTICATION_FAILED: 'Payment provider configuration is unavailable.',
  RATE_LIMITED: 'Payment provider is temporarily unavailable. Try again.',
  PROVIDER_UNAVAILABLE: 'Payment provider is temporarily unavailable. Try again.',
  TIMEOUT: 'Payment provider did not respond in time. Try again.',
  DECLINED: 'Payment provider declined the operation.',
  DUPLICATE: 'Payment provider could not safely repeat the operation.',
  UNSUPPORTED_OPERATION: 'Payment provider does not support this operation.',
  UNKNOWN: 'Payment provider could not complete the operation.',
} satisfies Readonly<Record<PaymentProviderFailureCode, string>>);

export type PaymentProviderClientError = Readonly<{
  code: PaymentProviderFailureCode;
  retryable: boolean;
  message: string;
}>;

export type PublicPaymentProviderClientError = Readonly<{
  error: 'payment-temporarily-unavailable' | 'payment-rejected' | 'payment-unavailable';
  status: 409 | 502 | 503;
}>;

export function paymentProviderClientError(input: PaymentProviderFailure): PaymentProviderClientError {
  return Object.freeze({
    code: input.code,
    retryable: input.retryable,
    message: PAYMENT_PROVIDER_CLIENT_MESSAGES[input.code],
  });
}

/**
 * Converts only constructor-branded SF payment-provider failures into staff-safe presentation data.
 * Structural lookalikes and arbitrary thrown values return null and remain internal errors.
 */
export function paymentProviderClientErrorFromThrown(error: unknown): PaymentProviderClientError | null {
  const failure = inspectPaymentProviderFailure(error);
  return failure ? paymentProviderClientError(failure) : null;
}

/**
 * Public checkout deliberately exposes less authority than staff APIs. Only a definitive provider
 * decline is presented as a customer rejection. Retryable operational failures remain temporary
 * unavailability, while every other branded non-retryable provider failure is a generic upstream
 * payment unavailability rather than a customer-facing rejection or provider failure code.
 */
export function publicPaymentProviderClientError(error: unknown): PublicPaymentProviderClientError | null {
  const failure = inspectPaymentProviderFailure(error);
  if (!failure) return null;

  if (failure.retryable) {
    return Object.freeze({ error: 'payment-temporarily-unavailable', status: 503 });
  }
  if (failure.code === 'DECLINED') {
    return Object.freeze({ error: 'payment-rejected', status: 409 });
  }
  return Object.freeze({ error: 'payment-unavailable', status: 502 });
}
