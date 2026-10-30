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

/** Reject hidden identity formatting, directional controls, and unpaired surrogates. */
export function hasUnsafeIdentityControls(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      (codePoint >= 0x2028 && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0x00ad || codePoint === 0x061c ||
      codePoint === 0x180e || codePoint === 0x200b ||
      codePoint === 0x200e || codePoint === 0x200f ||
      codePoint === 0xfeff
    ) return true;
  }
  return false;
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
