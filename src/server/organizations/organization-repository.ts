import { db } from '@/server/database';

interface OrganizationAccessInput {
  organizationId: string;
  userId: string;
}

interface OrganizationSlugAccessInput {
  organizationSlug: string;
  userId: string;
}

const activeMembershipScope = (userId: string) => ({
  deletedAt: null,
  status: 'ACTIVE' as const,
  memberships: {
    some: {
      userId,
      status: 'ACTIVE' as const,
    },
  },
});

export function listOrganizationsForUser(userId: string) {
  return db.organization.findMany({
    where: activeMembershipScope(userId),
    orderBy: {
      name: 'asc',
    },
  });
}

export function findOrganizationForUser({
  organizationId,
  userId,
}: OrganizationAccessInput) {
  return db.organization.findFirst({
    where: {
      ...activeMembershipScope(userId),
      id: organizationId,
    },
  });
}

export function findOrganizationBySlugForUser({
  organizationSlug,
  userId,
}: OrganizationSlugAccessInput) {
  return db.organization.findFirst({
    where: {
      ...activeMembershipScope(userId),
      slug: organizationSlug,
    },
  });
}
