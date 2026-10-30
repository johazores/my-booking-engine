import { db } from '../database.ts';
import { createSessionExpiry } from './auth-domain.ts';

interface RegisteredUserInput {
  email: string;
  displayName?: string;
  passwordHash: string;
  sessionTokenHash: string;
}

interface SessionInput {
  userId: string;
  tokenHash: string;
}

interface ActiveAuthSessionRow {
  id: string;
  expiresAt: Date;
  userId: string;
  email: string;
  displayName: string | null;
  status: 'ACTIVE';
}

/** Session creation uses PostgreSQL time, not a potentially skewed application clock. */
async function readDatabaseClock() {
  const rows = await db.$queryRaw<Array<{ now: Date }>>`SELECT statement_timestamp() AS "now"`;
  if (rows.length !== 1 || !(rows[0].now instanceof Date) ||
      !Number.isFinite(rows[0].now.getTime())) {
    throw new Error('Unable to resolve the authentication database clock.');
  }
  return rows[0].now;
}

export async function createRegisteredUserWithSession({
  email,
  displayName,
  passwordHash,
  sessionTokenHash,
}: RegisteredUserInput) {
  const expiresAt = createSessionExpiry(await readDatabaseClock());
  // Nested credential/session creation remains atomic with user creation.
  const user = await db.user.create({
    data: {
      email,
      displayName,
      passwordCredential: {
        create: {
          passwordHash,
        },
      },
      authSessions: {
        create: {
          tokenHash: sessionTokenHash,
          expiresAt,
        },
      },
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
    },
  });
  return { user, expiresAt };
}

export function findPasswordCredentialByEmail(email: string) {
  return db.passwordCredential.findFirst({
    where: {
      user: {
        email,
        status: 'ACTIVE',
      },
    },
    include: {
      user: true,
    },
  });
}

export async function createAuthSession({ userId, tokenHash }: SessionInput) {
  const expiresAt = createSessionExpiry(await readDatabaseClock());
  await db.authSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });
  return expiresAt;
}

/** Check expiry and principal status together against the database clock. */
export async function findActiveAuthSession(tokenHash: string) {
  const rows = await db.$queryRaw<ActiveAuthSessionRow[]>`
    SELECT s."id", s."expiresAt", u."id" AS "userId",
           u."email", u."displayName", u."status"
    FROM "auth_sessions" AS s
    INNER JOIN "users" AS u ON u."id" = s."userId"
    WHERE s."tokenHash" = ${tokenHash}
      AND s."revokedAt" IS NULL
      AND s."expiresAt" > statement_timestamp()
      AND u."status" = 'ACTIVE'
    LIMIT 1
  `;
  const session = rows[0];
  if (!session) return null;
  return {
    id: session.id,
    expiresAt: session.expiresAt,
    user: {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      status: session.status,
    },
  };
}

/** Revocation evidence must also use PostgreSQL time across all replicas. */
export function revokeAuthSession(tokenHash: string) {
  return db.$executeRaw`
    UPDATE "auth_sessions"
    SET "revokedAt" = statement_timestamp()
    WHERE "tokenHash" = ${tokenHash}
      AND "revokedAt" IS NULL
  `;
}
