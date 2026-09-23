export const STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS = 4_096;

export type StripeWebhookSignatureEnvelope = Readonly<{
  timestamp: number;
  signatures: readonly string[];
}>;

/**
 * Parses only the framing needed by Stripe webhook signature verification.
 * The parser intentionally does not perform HMAC verification or timestamp
 * tolerance checks; those remain provider-adapter authority after the bounded
 * raw body is acquired. Ambiguous duplicate timestamps fail closed while
 * multiple v1 candidates remain valid for signing-secret rotation.
 */
export function parseStripeWebhookSignatureHeader(value: unknown): StripeWebhookSignatureEnvelope | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > STRIPE_WEBHOOK_MAX_SIGNATURE_HEADER_CHARS) {
    return null;
  }

  let timestamp: number | undefined;
  let timestampSeen = false;
  const signatures: string[] = [];

  for (const rawPart of value.split(',')) {
    const part = rawPart.trim();
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = part.slice(0, separatorIndex);
    const candidate = part.slice(separatorIndex + 1);

    if (key === 't') {
      if (timestampSeen) return null;
      timestampSeen = true;
      if (!candidate || !/^\d+$/.test(candidate)) return null;
      const parsedTimestamp = Number(candidate);
      if (!parsedTimestamp || !Number.isSafeInteger(parsedTimestamp)) return null;
      timestamp = parsedTimestamp;
      continue;
    }

    if (key === 'v1' && /^[0-9a-f]{64}$/i.test(candidate)) {
      signatures.push(candidate);
    }
  }

  if (timestamp === undefined || signatures.length === 0) return null;
  return Object.freeze({ timestamp, signatures: Object.freeze([...signatures]) });
}

/**
 * Performs only cheap public-ingress framing checks. This is deliberately not
 * signature verification: the tenant-specific provider adapter still owns HMAC
 * verification and timestamp tolerance after the bounded raw body is acquired.
 */
export function hasPlausibleStripeWebhookSignatureHeader(value: unknown): value is string {
  return parseStripeWebhookSignatureHeader(value) !== null;
}
