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

/**
 * Stripe returns the metadata attached to created PaymentIntents and refunds.
 * A successful money-movement response must prove the exact tenant and booking
 * that SF sent, even when the amount and provider reference otherwise match.
 * Missing or mismatched ownership is unknown provider truth after network I/O.
 */
export function assertStripeWriteResponseOwnership(
  response: unknown,
  expectedOrganizationId: string,
  expectedBookingId: string,
): void {
  const resource = response !== null && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown> : null;
  const metadata = resource?.metadata;
  if (
    metadata === null
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
    || (metadata as Record<string, unknown>).sf_organization_id !== expectedOrganizationId
    || (metadata as Record<string, unknown>).sf_booking_id !== expectedBookingId
  ) {
    throw new PaymentProviderError('UNKNOWN', 'Stripe returned payment ownership evidence that does not match the requested booking.', true);
  }
}

/** Only bounded canonical ASCII tokens can carry Stripe machine error authority. */
function readStripeMachineToken(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 96 && /^[a-z][a-z0-9_]*$/.test(value) ? value : null;
}

function hasMalformedStripeMachineToken(value: unknown): boolean {
  return value !== undefined && value !== null && readStripeMachineToken(value) === null;
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
    type: readStripeMachineToken(detail?.type),
    code: readStripeMachineToken(detail?.code),
    declineCode: readStripeMachineToken(detail?.decline_code),
    machineEvidenceValid: !(
      hasMalformedStripeMachineToken(detail?.type)
      || hasMalformedStripeMachineToken(detail?.code)
      || hasMalformedStripeMachineToken(detail?.decline_code)
    ),
  });
}

/**
 * HTTP status outranks untrusted Stripe error-body hints. A timeout, rate
 * limit, or server failure is not proof of a card decline or duplicate write.
 */
export function classifyStripePaymentHttpError(status: number, payload: unknown, fallback: string): PaymentProviderError {
  const error = readStripeProviderError(payload, fallback);
  const message = error.message;
  if (status === 401 || status === 403) return new PaymentProviderError('AUTHENTICATION_FAILED', message);
  if (status === 408) return new PaymentProviderError('TIMEOUT', message, true);
  if (status === 429) return new PaymentProviderError('RATE_LIMITED', message, true);
  // A failed external Stripe dependency does not prove that money did not move.
  if (status === 424 || status >= 500) return new PaymentProviderError('PROVIDER_UNAVAILABLE', message, true);
  // Concurrent same-key requests can return 409 before Stripe stores an
  // idempotent result. Only the exact canonical parameter-mismatch code is definitive.
  if (status === 409 || (status === 400 && error.code === 'idempotency_key_in_use')) {
    if (!error.machineEvidenceValid) return new PaymentProviderError('UNKNOWN', message, true);
    if (error.type === 'idempotency_error' && error.code === 'idempotency_key_reused') {
      return new PaymentProviderError('DUPLICATE', message);
    }
    return new PaymentProviderError('UNKNOWN', message, true);
  }
  // A 404 or invalid 400 request cannot become a card decline solely from
  // contradictory error-body hints. Only exact key-reuse evidence is definitive.
  if (status === 404) return new PaymentProviderError('INVALID_REQUEST', message);
  // Keep HTTP not-found authority, but never let malformed machine hints
  // establish a definitive duplicate or card rejection for a payment write.
  if (!error.machineEvidenceValid) return new PaymentProviderError('UNKNOWN', message, true);
  if (status === 400) {
    if (error.type === 'idempotency_error') {
      return error.code === 'idempotency_key_reused'
        ? new PaymentProviderError('DUPLICATE', message)
        : new PaymentProviderError('UNKNOWN', message, true);
    }
    if (error.type === 'api_error') return new PaymentProviderError('UNKNOWN', message, true);
    return new PaymentProviderError('INVALID_REQUEST', message);
  }
  // Stripe can return card errors that require customer action rather than
  // prove a terminal decline. Preserve the durable claim for reconciliation.
  if (status === 402) {
    // HTTP 402 is not authoritative idempotency-parameter mismatch evidence.
    if (error.type === 'idempotency_error') return new PaymentProviderError('UNKNOWN', message, true);
    // Authentication-required issuer declines are actionable, not proof
    // that the underlying payment attempt is irrecoverably rejected.
    if (
      error.code === 'authentication_required'
      || error.code === 'payment_intent_action_required'
      || error.code === 'processing_error'
      || error.declineCode === 'authentication_required'
    ) return new PaymentProviderError('UNKNOWN', message, true);
    // Untyped issuer hints and contradictory idempotency codes do not prove
    // a terminal card rejection.
    if (error.code === 'idempotency_key_in_use' || error.code === 'idempotency_key_reused') {
      return new PaymentProviderError('UNKNOWN', message, true);
    }
    if (error.type === 'card_error' && (error.code !== null || error.declineCode !== null)) {
      return new PaymentProviderError('DECLINED', message);
    }
    return new PaymentProviderError('UNKNOWN', message, true);
  }
  // Stripe api_error is a provider-side failure, including atypical 4xx
  // responses. It cannot establish a definitive failed money movement.
  if (error.type === 'api_error') return new PaymentProviderError('UNKNOWN', message, true);
  // Unexpected 4xx idempotency hints cannot finalize a commercial write.
  if (error.type === 'idempotency_error') return new PaymentProviderError('UNKNOWN', message, true);
  if (status >= 400 && status < 500) return new PaymentProviderError('INVALID_REQUEST', message);
  return new PaymentProviderError('UNKNOWN', message, true);
}

/** Lookup failures cannot turn a missing resource or a timeout into payment truth. */
export function classifyStripeLookupHttpError(
  status: number, payload: unknown, fallback: string, notFoundMessage: string,
): PaymentProviderError {
  const error = readStripeProviderError(payload, fallback);
  const message = error.message;
  if (status === 401 || status === 403) return new PaymentProviderError('AUTHENTICATION_FAILED', message);
  if (status === 408) return new PaymentProviderError('TIMEOUT', message, true);
  if (status === 429) return new PaymentProviderError('RATE_LIMITED', message, true);
  if (status === 424 || status >= 500) return new PaymentProviderError('PROVIDER_UNAVAILABLE', message, true);
  if (status === 409 || status === 402) return new PaymentProviderError('UNKNOWN', message, true);
  if (status === 404) return new PaymentProviderError('INVALID_REQUEST', notFoundMessage);
  if (error.type === 'api_error') return new PaymentProviderError('UNKNOWN', message, true);
  if (status >= 400) return new PaymentProviderError('INVALID_REQUEST', message);
  return new PaymentProviderError('UNKNOWN', message, true);
}
