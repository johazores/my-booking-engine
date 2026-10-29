import { randomBytes } from 'node:crypto';
import { db } from '../database.ts';
import {
  AUTH_ATTEMPT_LIMITS, AUTH_ATTEMPT_WINDOW_SECONDS,
  admitAuthAttemptWithBudgets, createAuthAttemptDigest, decodeAuthAbuseSecret,
  type AuthAttemptOperation, type AuthAttemptScope,
} from './auth-abuse-domain.ts';

async function consumeWindow(
  operation: AuthAttemptOperation, scope: AuthAttemptScope, subjectHash: string, limit: number,
) {
  // PostgreSQL owns the clock and serializes conflicting increments across replicas.
  const rows = await db.$queryRaw<Array<{ attempts: number }>>`
    INSERT INTO "auth_attempt_windows" ("operation", "scope", "subjectHash", "windowStart", "attempts")
    VALUES (
      ${operation}, ${scope}, ${subjectHash},
      date_bin(INTERVAL '15 minutes', statement_timestamp(), TIMESTAMPTZ '2000-01-01 00:00:00+00'),
      1
    )
    ON CONFLICT ("operation", "scope", "subjectHash", "windowStart")
    DO UPDATE SET "attempts" = "auth_attempt_windows"."attempts" + 1
    WHERE "auth_attempt_windows"."attempts" < ${limit}
    RETURNING "attempts"
  `;
  return rows.length === 1;
}

async function pruneExpiredWindowsBestEffort() {
  if (randomBytes(1)[0] !== 0) return;
  try {
    // Use the same authoritative database clock as window creation.
    await db.$executeRaw`DELETE FROM "auth_attempt_windows"
      WHERE "windowStart" < statement_timestamp() - INTERVAL '48 hours'`;
  } catch {
    // Retention cleanup must not replace an already enforced attempt decision.
  }
}

export async function reserveAuthAttempt(operation: AuthAttemptOperation, email: string) {
  // Fail closed on a missing deployment secret, before any credential work.
  const secret = decodeAuthAbuseSecret(process.env.SF_AUTH_ABUSE_SECRET);
  const limits = AUTH_ATTEMPT_LIMITS[operation];
  const globalDigest = createAuthAttemptDigest(operation, 'global', '', secret);
  const identityDigest = createAuthAttemptDigest(operation, 'identity', email, secret);

  const allowed = await admitAuthAttemptWithBudgets(limits, (scope, limit) =>
    consumeWindow(operation, scope, scope === 'identity' ? identityDigest : globalDigest, limit));
  await pruneExpiredWindowsBestEffort();
  return allowed
    ? { allowed: true } as const
    : { allowed: false, retryAfterSeconds: AUTH_ATTEMPT_WINDOW_SECONDS } as const;
}
