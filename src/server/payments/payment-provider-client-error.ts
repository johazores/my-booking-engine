import type { PaymentProviderFailureCode } from './payment-provider.ts';

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

export function paymentProviderClientError(input: {
  code: PaymentProviderFailureCode;
  retryable: boolean;
}): PaymentProviderClientError {
  return Object.freeze({
    code: input.code,
    retryable: input.retryable,
    message: PAYMENT_PROVIDER_CLIENT_MESSAGES[input.code],
  });
}
