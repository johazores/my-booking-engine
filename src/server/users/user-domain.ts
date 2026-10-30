export const USER_EMAIL_MAX_LENGTH = 320;

export type UserLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

const userStatusTransitions: Record<
  UserLifecycleStatus,
  readonly UserLifecycleStatus[]
> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

// Default-ignorable code points also include grapheme joiners, variation
// selectors, and invisible tags outside the Unicode format category.
const UNSAFE_IDENTITY_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

export function hasUnsafeIdentityControls(value: string) {
  return UNSAFE_IDENTITY_CHARACTER.test(value);
}

export function normalizeUserEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateUserEmail(value: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > USER_EMAIL_MAX_LENGTH ||
    hasUnsafeIdentityControls(value)
  ) {
    return false;
  }

  if (value !== normalizeUserEmail(value)) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createCanonicalUserEmail(value: string) {
  if (typeof value !== 'string' || hasUnsafeIdentityControls(value)) {
    throw new Error('User email must be a valid canonical email address.');
  }
  const email = normalizeUserEmail(value);

  if (!validateUserEmail(email)) {
    throw new Error('User email must be a valid canonical email address.');
  }

  return email;
}

export function canTransitionUserStatus(
  from: UserLifecycleStatus,
  to: UserLifecycleStatus,
) {
  return userStatusTransitions[from].includes(to);
}

export function assertUserStatusTransition(
  from: UserLifecycleStatus,
  to: UserLifecycleStatus,
) {
  if (!canTransitionUserStatus(from, to)) {
    throw new Error(`User status cannot transition from ${from} to ${to}.`);
  }
}
