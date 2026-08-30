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

export function normalizeUserEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validateUserEmail(value: string) {
  if (!value || value.length > USER_EMAIL_MAX_LENGTH) {
    return false;
  }

  if (value !== normalizeUserEmail(value)) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function createCanonicalUserEmail(value: string) {
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
