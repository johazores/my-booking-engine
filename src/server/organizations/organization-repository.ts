import { db } from '../database.ts';
import {
  activeOrganizationAccessScope,
  activeOrganizationMembershipScope,
} from '../tenancy/tenant-scope.ts';
import { validateOrganizationSlug } from './organization-domain.ts';

interface OrganizationAccessInput {
  organizationId: string;
  userId: string;
}

interface OrganizationSlugAccessInput {
  organizationSlug: string;
  userId: string;
}

interface OrganizationPageInput {
  userId: string;
  page?: number;
  pageSize?: number;
}

const DEFAULT_ORGANIZATION_PAGE_SIZE = 20;
const MAX_ORGANIZATION_PAGE_SIZE = 50;
const MAX_COMPLETE_ORGANIZATION_ROWS = 1_000;

function normalizePage(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return DEFAULT_ORGANIZATION_PAGE_SIZE;
  return Math.min(value as number, MAX_ORGANIZATION_PAGE_SIZE);
}

export async function listOrganizationsForUser(userId: string) {
  const rows = await db.organization.findMany({
    where: activeOrganizationMembershipScope(userId),
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: MAX_COMPLETE_ORGANIZATION_ROWS + 1,
  });

  if (rows.length > MAX_COMPLETE_ORGANIZATION_ROWS) {
    throw new Error('Organization access collection exceeds the complete-read safety limit. Use the paginated organization reader.');
  }

  return rows;
}

export async function listOrganizationsForUserPage(input: OrganizationPageInput) {
  const where = activeOrganizationMembershipScope(input.userId);
  const pageSize = normalizePageSize(input.pageSize);
  const requestedPage = normalizePage(input.page);

  return db.$transaction(async (transaction) => {
    const total = await transaction.organization.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const items = await transaction.organization.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return Object.freeze({ items, total, page, pageSize, totalPages });
  }, { isolationLevel: 'RepeatableRead' });
}

export function findOrganizationForUser({
  organizationId,
  userId,
}: OrganizationAccessInput) {
  return db.organization.findFirst({
    where: activeOrganizationAccessScope({ organizationId, userId }),
  });
}

export function findOrganizationBySlugForUser({
  organizationSlug,
  userId,
}: OrganizationSlugAccessInput) {
  if (!validateOrganizationSlug(organizationSlug)) {
    throw new Error('organizationSlug must be a canonical organization slug.');
  }

  return db.organization.findFirst({
    where: {
      ...activeOrganizationMembershipScope(userId),
      slug: organizationSlug,
    },
  });
}
