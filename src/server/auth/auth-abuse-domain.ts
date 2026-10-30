import { createHmac } from 'node:crypto';
import { normalizeUserEmail } from '../users/user-domain.ts';
import { assertAuthRequestNotAborted } from './auth-request-abort.ts';

export type AuthAttemptOperation = 'sign-in' | 'sign-up';
export type AuthAttemptScope = 'identity' | 'global';
export type AuthAttemptDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; retryAfterSeconds: number }>;
export const AUTH_ATTEMPT_WINDOW_SECONDS = 900;
export const AUTH_ATTEMPT_LIMITS: Record<AuthAttemptOperation, { identity: number; global: number }> = {
  'sign-in': { identity: 10, global: 5000 },
  'sign-up': { identity: 4, global: 1500 },
};

export function decodeAuthAbuseSecret(value: string | undefined): Buffer {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('SF_AUTH_ABUSE_SECRET must be a canonical 32-byte base64url secret.');
  }
  const key = Buffer.from(value, 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== value) {
    throw new Error('SF_AUTH_ABUSE_SECRET must be a canonical 32-byte base64url secret.');
  }
  return key;
}

export function createAuthAttemptDigest(
  operation: AuthAttemptOperation,
  scope: AuthAttemptScope,
  email: string,
  secret: Buffer,
): string {
  const subject = scope === 'global' ? 'all-requests' : normalizeUserEmail(email);
  return createHmac('sha256', secret)
    .update(operation).update('\0').update(scope).update('\0').update(subject).digest('hex');
}

export async function admitAuthAttemptWithBudgets(
  limits: Readonly<{ identity: number; global: number }>,
  consume: (scope: AuthAttemptScope, limit: number) => Promise<AuthAttemptDecision>,
  signal?: AbortSignal,
): Promise<AuthAttemptDecision> {
  // Stop abandoned requests before each independent database quota write.
  // An already-started write cannot be cancelled or refunded.
  assertAuthRequestNotAborted(signal);
  const identity = await consume('identity', limits.identity);
  assertAuthRequestNotAborted(signal);
  if (!identity.allowed) return identity;
  const global = await consume('global', limits.global);
  assertAuthRequestNotAborted(signal);
  return global;
}

/** Retention is optional and must never add work to rejected attempts or fail admission. */
export async function runBestEffortAuthRetention(
  admitted: boolean,
  shouldPrune: () => boolean,
  prune: () => Promise<unknown>,
): Promise<void> {
  if (!admitted) return;
  try {
    if (shouldPrune()) await prune();
  } catch {
    // Neither random sampling nor maintenance failures may override admission.
  }
}
