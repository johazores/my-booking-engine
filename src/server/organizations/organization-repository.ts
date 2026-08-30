import { db } from '@/server/database';

interface OrganizationAccessInput {
  organizationId: string;
  userId: string;
}

export function listOrganizationsForUser(userId: string) {
  return db.organization.findMany({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      memberships: {
        some: {
          userId,
          status: 'ACTIVE',
        },
      },
    },
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
      id: organizationId,
      deletedAt: null,
      status: 'ACTIVE',
      memberships: {
        some: {
          userId,
          status: 'ACTIVE',
        },
      },
    },
  });
}
