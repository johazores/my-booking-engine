import {
  validateSignInInput,
  validateSignUpInput,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isCanonicalSessionToken,
  verifyPassword,
} from './auth-domain.ts';
import { assertAuthRequestNotAborted } from './auth-request-abort.ts';
import {
  createAuthSession,
  createRegisteredUserWithSession,
  findActiveAuthSession,
  findPasswordCredentialByEmail,
  revokeAuthSession,
} from './auth-repository.ts';

export class AuthConflictError extends Error {}
export class InvalidCredentialsError extends Error {}

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
}, signal?: AbortSignal) {
  const { email, password, displayName } = validateSignUpInput(input);
  assertAuthRequestNotAborted(signal);
  const passwordHash = await hashPassword(password, signal);
  assertAuthRequestNotAborted(signal);
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  try {
    const { user, expiresAt } = await createRegisteredUserWithSession({
      email,
      displayName,
      passwordHash,
      sessionTokenHash: tokenHash,
    }, signal);

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
}, signal?: AbortSignal) {
  const { email, password } = validateSignInInput(input);
  assertAuthRequestNotAborted(signal);
  const credential = await findPasswordCredentialByEmail(email);
  assertAuthRequestNotAborted(signal);

  if (!credential) {
    await hashPassword('invalid-credential-padding', signal);
    throw new InvalidCredentialsError('Invalid email or password.');
  }

  const passwordMatches = await verifyPassword(password, credential.passwordHash, signal);
  if (!passwordMatches) {
    throw new InvalidCredentialsError('Invalid email or password.');
  }

  assertAuthRequestNotAborted(signal);
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = await createAuthSession({
    userId: credential.userId,
    tokenHash,
  }, signal);
  // Password verification may have raced with account suspension.
  if (!expiresAt) throw new InvalidCredentialsError('Invalid email or password.');

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
  if (!isCanonicalSessionToken(token)) {
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
  if (!isCanonicalSessionToken(token)) {
    return;
  }

  await revokeAuthSession(hashSessionToken(token));
}
