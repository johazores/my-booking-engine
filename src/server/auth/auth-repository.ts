import { db } from '../database.ts';

interface RegisteredUserInput {
  email: string;
  displayName?: string;
  passwordHash: string;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
}

interface SessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export function createRegisteredUserWithSession({
  email,
  displayName,
  passwordHash,
  sessionTokenHash,
  sessionExpiresAt,
}: RegisteredUserInput) {
  return db.user.create({
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
          expiresAt: sessionExpiresAt,
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

export function createAuthSession({ userId, tokenHash, expiresAt }: SessionInput) {
  return db.authSession.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });
}

export function findActiveAuthSession(tokenHash: string, now = new Date()) {
  return db.authSession.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
      user: {
        status: 'ACTIVE',
      },
    },
    include: {
      user: true,
    },
  });
}

export function revokeAuthSession(tokenHash: string, revokedAt = new Date()) {
  return db.authSession.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt,
    },
  });
}
