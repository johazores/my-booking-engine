export const TENANT_ACCESS_MEMBERSHIP_STATUS = 'ACTIVE' as const;

export type MembershipLifecycleStatus =
  | 'INVITED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'ARCHIVED';

const membershipStatusTransitions: Record<
  MembershipLifecycleStatus,
  readonly MembershipLifecycleStatus[]
> = {
  INVITED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function isMembershipLifecycleStatus(value: string): value is MembershipLifecycleStatus {
  return value === 'INVITED' || value === 'ACTIVE' || value === 'SUSPENDED' || value === 'ARCHIVED';
}

export function canMembershipAccessTenant(status: MembershipLifecycleStatus) {
  return status === TENANT_ACCESS_MEMBERSHIP_STATUS;
}

export function canTransitionMembershipStatus(
  from: MembershipLifecycleStatus,
  to: MembershipLifecycleStatus,
) {
  return membershipStatusTransitions[from].includes(to);
}

export function assertMembershipStatusTransition(
  from: MembershipLifecycleStatus,
  to: MembershipLifecycleStatus,
) {
  if (!canTransitionMembershipStatus(from, to)) {
    throw new Error(
      `Membership status cannot transition from ${from} to ${to}.`,
    );
  }
}
