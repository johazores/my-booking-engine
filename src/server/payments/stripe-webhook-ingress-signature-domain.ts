export const STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS = 4_096;

/**
 * Performs only cheap public-ingress framing checks. This is deliberately not
 * signature verification: the tenant-specific provider adapter still owns HMAC
 * verification and timestamp tolerance after the bounded raw body is acquired.
 */
export function hasPlausibleStripeWebhookSignatureHeader(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS) {
    return false;
  }

  let timestamp: number | undefined;
  let hasValidV1 = false;
  for (const part of value.split(',')) {
    const [key, candidate] = part.trim().split('=', 2);
    if (key === 't' && candidate && /^\d+$/.test(candidate)) {
      timestamp = Number(candidate);
      continue;
    }
    if (key === 'v1' && candidate && /^[0-9a-f]{64}$/i.test(candidate)) {
      hasValidV1 = true;
    }
  }

  return Boolean(timestamp && Number.isSafeInteger(timestamp) && hasValidV1);
}
