import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error(
    'Tenant isolation integration tests must run through npm run test:database with TEST_DATABASE_URL.',
  );
}

test('Tenant A cannot access Tenant B organizations or memberships through real repositories', async () => {
  const [{ db }, organizationRepository, membershipRepository] = await Promise.all([
    import('../database.ts'),
    import('../organizations/organization-repository.ts'),
    import('../memberships/membership-repository.ts'),
  ]);

  const suffix = `${process.pid}-${Date.now()}`;
  const tenantASlug = `sf-a-${suffix}`;
  const tenantBSlug = `sf-b-${suffix}`;
  const userAEmail = `sf-a-${suffix}@example.test`;
  const userBEmail = `sf-b-${suffix}@example.test`;

  const createdOrganizationIds: string[] = [];
  const createdUserIds: string[] = [];

  try {
    const [userA, userB] = await Promise.all([
      db.user.create({ data: { email: userAEmail } }),
      db.user.create({ data: { email: userBEmail } }),
    ]);

    createdUserIds.push(userA.id, userB.id);

    const [tenantA, tenantB] = await Promise.all([
      db.organization.create({
        data: {
          slug: tenantASlug,
          name: 'SF Tenant A',
          kind: 'HOTEL',
        },
      }),
      db.organization.create({
        data: {
          slug: tenantBSlug,
          name: 'SF Tenant B',
          kind: 'HOTEL',
        },
      }),
    ]);

    createdOrganizationIds.push(tenantA.id, tenantB.id);

    const [membershipA, membershipB] = await Promise.all([
      db.organizationMembership.create({
        data: {
          organizationId: tenantA.id,
          userId: userA.id,
        },
      }),
      db.organizationMembership.create({
        data: {
          organizationId: tenantB.id,
          userId: userB.id,
        },
      }),
    ]);

    assert.equal(
      (await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: userA.id,
      }))?.id,
      tenantA.id,
    );

    assert.equal(
      await organizationRepository.findOrganizationForUser({
        organizationId: tenantB.id,
        userId: userA.id,
      }),
      null,
    );

    assert.equal(
      await organizationRepository.findOrganizationBySlugForUser({
        organizationSlug: tenantB.slug,
        userId: userA.id,
      }),
      null,
    );

    const organizationsForUserA = await organizationRepository.listOrganizationsForUser(userA.id);
    assert.deepEqual(
      organizationsForUserA.map((organization) => organization.id),
      [tenantA.id],
    );

    assert.equal(
      (await membershipRepository.findMembershipForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
        membershipId: membershipA.id,
      }))?.id,
      membershipA.id,
    );

    assert.equal(
      await membershipRepository.findMembershipForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
        membershipId: membershipB.id,
      }),
      null,
    );

    const membershipsForTenantA = await membershipRepository.listMembershipsForOrganization({
      organizationId: tenantA.id,
      userId: userA.id,
    });
    assert.deepEqual(
      membershipsForTenantA.map((membership) => membership.id),
      [membershipA.id],
    );
  } finally {
    if (createdOrganizationIds.length > 0 || createdUserIds.length > 0) {
      await db.organizationMembership.deleteMany({
        where: {
          OR: [
            { organizationId: { in: createdOrganizationIds } },
            { userId: { in: createdUserIds } },
          ],
        },
      });
    }

    if (createdOrganizationIds.length > 0) {
      await db.organization.deleteMany({
        where: { id: { in: createdOrganizationIds } },
      });
    }

    if (createdUserIds.length > 0) {
      await db.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    await db.$disconnect();
  }
});
