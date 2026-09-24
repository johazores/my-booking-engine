import { db } from '../database.ts';
import {
  activeTenantOwnedCollectionScope,
  activeTenantOwnedResourceScope,
  type TenantActorScopeInput,
} from '../tenancy/tenant-scope.ts';

interface MembershipAccessInput extends TenantActorScopeInput {
  membershipId: string;
}

interface MembershipPageInput extends TenantActorScopeInput {
  page?: number;
  pageSize?: number;
}

const DEFAULT_MEMBERSHIP_PAGE_SIZE = 20;
const MAX_MEMBERSHIP_PAGE_SIZE = 50;
const MAX_COMPLETE_MEMBERSHIP_ROWS = 1_000;

const membershipListSelect = {
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      email: true,
      displayName: true,
      status: true,
    },
  },
} as const;

function normalizePage(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return DEFAULT_MEMBERSHIP_PAGE_SIZE;
  return Math.min(value as number, MAX_MEMBERSHIP_PAGE_SIZE);
}

export async function listMembershipsForOrganization(input: TenantActorScopeInput) {
  const rows = await db.organizationMembership.findMany({
    where: activeTenantOwnedCollectionScope(input),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_COMPLETE_MEMBERSHIP_ROWS + 1,
    select: membershipListSelect,
  });

  if (rows.length > MAX_COMPLETE_MEMBERSHIP_ROWS) {
    throw new Error('Organization membership collection exceeds the complete-read safety limit. Use the paginated membership reader.');
  }

  return rows;
}

export async function listMembershipsForOrganizationPage(input: MembershipPageInput) {
  const where = activeTenantOwnedCollectionScope(input);
  const pageSize = normalizePageSize(input.pageSize);
  const requestedPage = normalizePage(input.page);

  return db.$transaction(async (transaction) => {
    const total = await transaction.organizationMembership.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const items = await transaction.organizationMembership.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: membershipListSelect,
    });

    return Object.freeze({ items, total, page, pageSize, totalPages });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function readOrganizationMembershipStats(input: TenantActorScopeInput) {
  const where = activeTenantOwnedCollectionScope(input);

  return db.$transaction(async (transaction) => {
    const [total, active] = await Promise.all([
      transaction.organizationMembership.count({ where }),
      transaction.organizationMembership.count({ where: { AND: [where, { status: 'ACTIVE' }] } }),
    ]);

    return Object.freeze({ total, active });
  }, { isolationLevel: 'RepeatableRead' });
}

export function findMembershipForOrganization({
  membershipId,
  organizationId,
  userId,
}: MembershipAccessInput) {
  return db.organizationMembership.findFirst({
    where: activeTenantOwnedResourceScope({
      organizationId,
      userId,
      resourceId: membershipId,
    }),
    select: membershipListSelect,
  });
}
