const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,120}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const paymentProviderCapabilities = [
  'OFFLINE_RECORDING',
  'OFFLINE_REFUND_RECORDING',
  'AUTHORIZE',
  'CAPTURE',
  'REFUND',
  'WEBHOOKS',
] as const;

export type PaymentProviderCapability = (typeof paymentProviderCapabilities)[number];

export type PaymentProviderOperationStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'REFUNDED';

export type PaymentProviderFailureCode =
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'DECLINED'
  | 'DUPLICATE'
  | 'UNSUPPORTED_OPERATION'
  | 'UNKNOWN';

export type PaymentMoney = Readonly<{
  currency: string;
  amountMinor: bigint;
}>;

export type PaymentOperationContext = Readonly<{
  organizationId: string;
  bookingId: string;
  idempotencyKey: string;
  money: PaymentMoney;
}>;

export type PaymentAuthorizationInput = PaymentOperationContext & Readonly<{
  paymentMethodReference: string;
}>;

export type PaymentWebhookVerificationInput = Readonly<{
  payload: string;
  signature: string;
  secret: string;
  now?: Date;
}>;

export type ProviderPaymentResult = Readonly<{
  providerCode: string;
  providerReference: string;
  status: PaymentProviderOperationStatus;
  money: PaymentMoney;
}>;

export type ProviderRefundResult = Readonly<{
  providerCode: string;
  providerReference: string;
  refundReference: string;
  status: 'REFUNDED' | 'FAILED';
  money: PaymentMoney;
}>;

export interface PaymentProviderAdapter {
  readonly code: string;
  readonly capabilities: ReadonlySet<PaymentProviderCapability>;
  recordOfflinePayment?(input: PaymentOperationContext & { reference: string }): Promise<ProviderPaymentResult>;
  recordOfflineRefund?(input: PaymentOperationContext & { paymentReference: string; refundReference: string }): Promise<ProviderRefundResult>;
  authorizePayment?(input: PaymentAuthorizationInput): Promise<ProviderPaymentResult>;
  capturePayment?(input: PaymentOperationContext & { providerReference: string }): Promise<ProviderPaymentResult>;
  refundPayment?(input: PaymentOperationContext & { providerReference: string }): Promise<ProviderRefundResult>;
  verifyWebhookSignature?(input: PaymentWebhookVerificationInput): boolean;
}

export class PaymentProviderError extends Error {
  readonly code: PaymentProviderFailureCode;
  readonly retryable: boolean;

  constructor(code: PaymentProviderFailureCode, message: string, retryable = false) {
    super(message);
    this.name = 'PaymentProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function normalizePaymentOperationContext(input: {
  organizationId: unknown;
  bookingId: unknown;
  idempotencyKey: unknown;
  currency: unknown;
  amountMinor: unknown;
}): PaymentOperationContext {
  return Object.freeze({
    organizationId: normalizeUuid(input.organizationId, 'Organization ID'),
    bookingId: normalizeUuid(input.bookingId, 'Booking ID'),
    idempotencyKey: normalizePaymentIdempotencyKey(input.idempotencyKey),
    money: normalizePaymentMoney(input.currency, input.amountMinor),
  });
}

export function normalizePaymentMoney(currency: unknown, amountMinor: unknown): PaymentMoney {
  if (typeof currency !== 'string') {
    throw new Error('Payment currency is required.');
  }

  const normalizedCurrency = currency.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(normalizedCurrency)) {
    throw new Error('Payment currency must be a three-letter ISO currency code.');
  }

  let normalizedAmount: bigint;
  try {
    if (typeof amountMinor === 'bigint') {
      normalizedAmount = amountMinor;
    } else if (typeof amountMinor === 'string' && /^\d+$/.test(amountMinor)) {
      normalizedAmount = BigInt(amountMinor);
    } else {
      throw new Error();
    }
  } catch {
    throw new Error('Payment amount must be a non-negative integer minor-unit value.');
  }

  if (normalizedAmount < 0n) {
    throw new Error('Payment amount must be a non-negative integer minor-unit value.');
  }

  return Object.freeze({ currency: normalizedCurrency, amountMinor: normalizedAmount });
}

export function normalizePaymentIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Payment idempotency key is required.');
  }

  const normalized = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(normalized)) {
    throw new Error('Payment idempotency key must be 8-120 characters using letters, numbers, colon, underscore, or hyphen.');
  }

  return normalized;
}

export function assertPaymentProviderCapability(
  adapter: Pick<PaymentProviderAdapter, 'code' | 'capabilities'>,
  capability: PaymentProviderCapability,
): void {
  if (!adapter.capabilities.has(capability)) {
    throw new PaymentProviderError(
      'UNSUPPORTED_OPERATION',
      `Payment provider ${adapter.code} does not support ${capability.toLowerCase().replaceAll('_', ' ')}.`,
    );
  }
}

function normalizeUuid(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is required.`);
  }

  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a valid UUID.`);
  }

  return normalized;
}
