import { createCanonicalUserEmail } from '../users/user-domain.ts';
import {
  AuthValidationError,
  createSessionExpiry,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './auth-domain.ts';
import {
  createAuthSession,
  createRegisteredUserWithSession,
  findActiveAuthSession,
  findPasswordCredentialByEmail,
  revokeAuthSession,
} from './auth-repository.ts';

const DISPLAY_NAME_MAX_LENGTH = 160;

export class AuthConflictError extends Error {}
export class InvalidCredentialsError extends Error {}

function normalizeDisplayName(value?: string) {
  if (value === undefined) {
    return undefined;
  }

  const displayName = value.trim();
  if (!displayName || displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AuthValidationError(
      `Display name must be between 1 and ${DISPLAY_NAME_MAX_LENGTH} characters when provided.`,
    );
  }

  return displayName;
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

export async function registerWithPassword(input: {
  email: string;
  password: string;
  displayName?: string;
}) {
  const email = createCanonicalUserEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName);
  const passwordHash = await hashPassword(input.password);
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = createSessionExpiry();

  try {
    const user = await createRegisteredUserWithSession({
      email,
      displayName,
      passwordHash,
      sessionTokenHash: tokenHash,
      sessionExpiresAt: expiresAt,
    });

    return { user, token, expiresAt };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AuthConflictError('An account with this email already exists.');
    }

    throw error;
  }
}

export async function signInWithPassword(input: {
  email: string;
  password: string;
}) {
  const email = createCanonicalUserEmail(input.email);
  const credential = await findPasswordCredentialByEmail(email);

  if (!credential) {
    await hashPassword('invalid-credential-padding');
    throw new InvalidCredentialsError('Invalid email or password.');
  }

  const passwordMatches = await verifyPassword(input.password, credential.passwordHash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError('Invalid email or password.');
  }

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = createSessionExpiry();
  await createAuthSession({
    userId: credential.userId,
    tokenHash,
    expiresAt,
  });

  return {
    user: {
      id: credential.user.id,
      email: credential.user.email,
      displayName: credential.user.displayName,
      status: credential.user.status,
    },
    token,
    expiresAt,
  };
}

export async function resolveAuthSession(token: string) {
  if (!token) {
    return null;
  }

  const session = await findActiveAuthSession(hashSessionToken(token));
  if (!session) {
    return null;
  }

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    user: {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      status: session.user.status,
    },
  };
}

export async function signOutSession(token: string) {
  if (!token) {
    return;
  }

  await revokeAuthSession(hashSessionToken(token));
}
