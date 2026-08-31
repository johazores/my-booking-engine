import {
  normalizePaymentOperationContext,
  normalizePaymentMoney,
  type PaymentOperationContext,
  type PaymentProviderAdapter,
  type PaymentProviderCapability,
  type ProviderPaymentResult,
  type ProviderRefundResult,
} from './payment-provider.ts';

export type ManualPaymentInput = PaymentOperationContext & Readonly<{
  reference: string;
}>;

export type ManualRefundInput = PaymentOperationContext & Readonly<{
  paymentReference: string;
  refundReference: string;
}>;

const MANUAL_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/#-]{0,119}$/;

export class ManualPaymentProvider implements PaymentProviderAdapter {
  readonly code = 'manual';
  readonly capabilities: ReadonlySet<PaymentProviderCapability> = new Set([
    'OFFLINE_RECORDING',
    'OFFLINE_REFUND_RECORDING',
  ]);

  async recordOfflinePayment(input: ManualPaymentInput): Promise<ProviderPaymentResult> {
    const context = normalizePaymentOperationContext({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      idempotencyKey: input.idempotencyKey,
      currency: input.money.currency,
      amountMinor: input.money.amountMinor,
    });
    const reference = normalizeManualPaymentReference(input.reference);

    return Object.freeze({
      providerCode: this.code,
      providerReference: reference,
      status: 'PAID' as const,
      money: normalizePaymentMoney(context.money.currency, context.money.amountMinor),
    });
  }

  async recordOfflineRefund(input: ManualRefundInput): Promise<ProviderRefundResult> {
    const context = normalizePaymentOperationContext({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      idempotencyKey: input.idempotencyKey,
      currency: input.money.currency,
      amountMinor: input.money.amountMinor,
    });
    const paymentReference = normalizeManualPaymentReference(input.paymentReference);
    const refundReference = normalizeManualPaymentReference(input.refundReference);
    if (paymentReference === refundReference) {
      throw new Error('Manual refund reference must be different from the original payment reference.');
    }

    return Object.freeze({
      providerCode: this.code,
      providerReference: paymentReference,
      refundReference,
      status: 'REFUNDED' as const,
      money: normalizePaymentMoney(context.money.currency, context.money.amountMinor),
    });
  }
}

export function normalizeManualPaymentReference(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Manual payment reference is required.');
  }

  const normalized = value.trim();
  if (!MANUAL_REFERENCE_PATTERN.test(normalized)) {
    throw new Error('Manual payment reference must be 1-120 safe printable characters.');
  }

  return normalized;
}
