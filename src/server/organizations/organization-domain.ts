export const ORGANIZATION_SLUG_MAX_LENGTH = 63;
export const ORGANIZATION_SLUG_MIN_LENGTH = 3;
export const ORGANIZATION_NAME_MAX_LENGTH = 160;
export const ORGANIZATION_NAME_MIN_LENGTH = 2;

export type OrganizationLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type OrganizationKindValue =
  | 'HOTEL'
  | 'RESORT'
  | 'TRAVEL_AGENCY'
  | 'TOUR_OPERATOR'
  | 'APPOINTMENT_BUSINESS'
  | 'RENTAL_BUSINESS'
  | 'MARKETPLACE'
  | 'OTHER';

export const ORGANIZATION_KINDS: readonly OrganizationKindValue[] = [
  'HOTEL',
  'RESORT',
  'TRAVEL_AGENCY',
  'TOUR_OPERATOR',
  'APPOINTMENT_BUSINESS',
  'RENTAL_BUSINESS',
  'MARKETPLACE',
  'OTHER',
];

const organizationTransitions: Record<OrganizationLifecycleStatus, readonly OrganizationLifecycleStatus[]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export class OrganizationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrganizationValidationError';
  }
}

export function normalizeOrganizationSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

export function validateOrganizationSlug(value: string) {
  if (value.length < ORGANIZATION_SLUG_MIN_LENGTH || value.length > ORGANIZATION_SLUG_MAX_LENGTH) return false;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function createOrganizationSlug(value: string) {
  const slug = normalizeOrganizationSlug(value);
  if (!validateOrganizationSlug(slug)) {
    throw new OrganizationValidationError(`Organization slug must be ${ORGANIZATION_SLUG_MIN_LENGTH}-${ORGANIZATION_SLUG_MAX_LENGTH} characters using lowercase letters, numbers, and single hyphens.`);
  }
  return slug;
}

export function createOrganizationName(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < ORGANIZATION_NAME_MIN_LENGTH || name.length > ORGANIZATION_NAME_MAX_LENGTH) {
    throw new OrganizationValidationError(`Organization name must be ${ORGANIZATION_NAME_MIN_LENGTH}-${ORGANIZATION_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

export function createOrganizationKind(value: string): OrganizationKindValue {
  if (!ORGANIZATION_KINDS.includes(value as OrganizationKindValue)) {
    throw new OrganizationValidationError('Select a supported organization type.');
  }
  return value as OrganizationKindValue;
}

export function createOrganizationTimezone(value: string) {
  const timezone = value.trim();
  if (!timezone || timezone.length > 80) throw new OrganizationValidationError('Provide a valid IANA timezone.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new OrganizationValidationError('Provide a valid IANA timezone.');
  }
  return timezone;
}

export function createOrganizationCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new OrganizationValidationError('Currency must be a three-letter code.');
  return currency;
}

export function canTransitionOrganizationStatus(from: OrganizationLifecycleStatus, to: OrganizationLifecycleStatus) {
  return organizationTransitions[from].includes(to);
}

export function assertOrganizationStatusTransition(from: OrganizationLifecycleStatus, to: OrganizationLifecycleStatus) {
  if (!canTransitionOrganizationStatus(from, to)) throw new Error(`Organization status cannot transition from ${from} to ${to}.`);
}

export function assertOrganizationArchiveConfirmation(value: string, canonicalSlug: string) {
  if (value.trim() !== canonicalSlug) {
    throw new OrganizationValidationError(`Type ${canonicalSlug} to confirm organization archival.`);
  }
}
