import { db } from '../database.ts';
import {
  activeOrganizationAccessScope,
  activeOrganizationMembershipScope,
} from '../tenancy/tenant-scope.ts';

interface OrganizationAccessInput {
  organizationId: string;
  userId: string;
}

interface OrganizationSlugAccessInput {
  organizationSlug: string;
  userId: string;
}

export function listOrganizationsForUser(userId: string) {
  return db.organization.findMany({
    where: activeOrganizationMembershipScope(userId),
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
    where: activeOrganizationAccessScope({ organizationId, userId }),
  });
}

export function findOrganizationBySlugForUser({
  organizationSlug,
  userId,
}: OrganizationSlugAccessInput) {
  return db.organization.findFirst({
    where: {
      ...activeOrganizationMembershipScope(userId),
      slug: organizationSlug,
    },
  });
}
