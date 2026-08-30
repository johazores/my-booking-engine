export const ORGANIZATION_SLUG_MAX_LENGTH = 63;
export const ORGANIZATION_SLUG_MIN_LENGTH = 3;

export type OrganizationLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

const organizationTransitions: Record<
  OrganizationLifecycleStatus,
  readonly OrganizationLifecycleStatus[]
> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function normalizeOrganizationSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function validateOrganizationSlug(value: string) {
  if (
    value.length < ORGANIZATION_SLUG_MIN_LENGTH ||
    value.length > ORGANIZATION_SLUG_MAX_LENGTH
  ) {
    return false;
  }

  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function createOrganizationSlug(value: string) {
  const slug = normalizeOrganizationSlug(value);

  if (!validateOrganizationSlug(slug)) {
    throw new Error(
      `Organization slug must be ${ORGANIZATION_SLUG_MIN_LENGTH}-${ORGANIZATION_SLUG_MAX_LENGTH} characters using lowercase letters, numbers, and single hyphens.`,
    );
  }

  return slug;
}

export function canTransitionOrganizationStatus(
  from: OrganizationLifecycleStatus,
  to: OrganizationLifecycleStatus,
) {
  return organizationTransitions[from].includes(to);
}

export function assertOrganizationStatusTransition(
  from: OrganizationLifecycleStatus,
  to: OrganizationLifecycleStatus,
) {
  if (!canTransitionOrganizationStatus(from, to)) {
    throw new Error(`Organization status cannot transition from ${from} to ${to}.`);
  }
}
