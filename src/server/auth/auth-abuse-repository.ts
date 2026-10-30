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
  // One PostgreSQL statement owns both quota admission and the Retry-After clock.
  // A separate clock read could cross a fixed-window boundary after a rejection.
  const rows = await db.$queryRaw<Array<{ allowed: boolean; retryAfterSeconds: number }>>`
    WITH clock AS (
      SELECT statement_timestamp() AS "now"
    ), admitted AS (
      INSERT INTO "auth_attempt_windows" ("operation", "scope", "subjectHash", "windowStart", "attempts")
      SELECT
        ${operation}, ${scope}, ${subjectHash},
        date_bin(INTERVAL '15 minutes', clock."now", TIMESTAMPTZ '2000-01-01 00:00:00+00'),
        1
      FROM clock
      WHERE true
      ON CONFLICT ("operation", "scope", "subjectHash", "windowStart")
      DO UPDATE SET "attempts" = "auth_attempt_windows"."attempts" + 1
      WHERE "auth_attempt_windows"."attempts" < ${limit}
      RETURNING 1
    )
    SELECT
      EXISTS (SELECT 1 FROM admitted) AS "allowed",
      GREATEST(1, LEAST(${AUTH_ATTEMPT_WINDOW_SECONDS},
        CEIL(EXTRACT(EPOCH FROM (
          date_bin(INTERVAL '15 minutes', clock."now", TIMESTAMPTZ '2000-01-01 00:00:00+00')
          + INTERVAL '15 minutes' - clock."now"
        )))::integer
      )) AS "retryAfterSeconds"
    FROM clock
  `;
  const decision = rows[0];
  if (rows.length !== 1 || typeof decision.allowed !== 'boolean' ||
      !Number.isInteger(decision.retryAfterSeconds) ||
      decision.retryAfterSeconds < 1 || decision.retryAfterSeconds > AUTH_ATTEMPT_WINDOW_SECONDS) {
    throw new Error('Authentication quota admission returned an invalid result.');
  }
  return decision.allowed
    ? { allowed: true } as const
    : { allowed: false, retryAfterSeconds: decision.retryAfterSeconds } as const;
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

  const decision = await admitAuthAttemptWithBudgets(limits, (scope, limit) =>
    consumeWindow(operation, scope, scope === 'identity' ? identityDigest : globalDigest, limit));
  await pruneExpiredWindowsBestEffort();
  return decision;
}
