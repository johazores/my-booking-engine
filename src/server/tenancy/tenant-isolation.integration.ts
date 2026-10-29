import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error(
    'Tenant isolation integration tests must run through npm run test:database with TEST_DATABASE_URL.',
  );
}

test('tenant repositories deny cross-tenant and inactive-principal access across every current read path', async () => {
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
  const invitedUserEmail = `sf-invited-${suffix}@example.test`;

  // Preassign cleanup identities before any fixture write.
  const createdOrganizationIds: string[] = [crypto.randomUUID(), crypto.randomUUID()];
  const createdUserIds: string[] = Array.from({ length: 3 }, () => crypto.randomUUID());

  try {
    const userA = await db.user.create({ data: { id: createdUserIds[0], email: userAEmail } });
    const userB = await db.user.create({ data: { id: createdUserIds[1], email: userBEmail } });
    const invitedUser = await db.user.create({ data: { id: createdUserIds[2], email: invitedUserEmail } });
    const tenantA = await db.organization.create({ data: { id: createdOrganizationIds[0], slug: tenantASlug, name: 'SF Tenant A', kind: 'HOTEL' } });
    const tenantB = await db.organization.create({ data: { id: createdOrganizationIds[1], slug: tenantBSlug, name: 'SF Tenant B', kind: 'HOTEL' } });
    // Sequential setup prevents teardown racing unfinished parallel inserts.
    const membershipA = await db.organizationMembership.create({ data: { organizationId: tenantA.id, userId: userA.id } });
    const membershipB = await db.organizationMembership.create({ data: { organizationId: tenantB.id, userId: userB.id } });
    const invitedMembership = await db.organizationMembership.create({ data: { organizationId: tenantA.id, userId: invitedUser.id, status: 'INVITED' } });

    assert.equal(
      (await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: userA.id,
      }))?.id,
      tenantA.id,
    );
    assert.equal(
      (await organizationRepository.findOrganizationBySlugForUser({
        organizationSlug: tenantA.slug,
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
    assert.equal(
      await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: userB.id,
      }),
      null,
    );
    assert.equal(
      await organizationRepository.findOrganizationBySlugForUser({
        organizationSlug: tenantA.slug,
        userId: userB.id,
      }),
      null,
    );

    assert.deepEqual(
      (await organizationRepository.listOrganizationsForUser(userA.id)).map(
        (organization) => organization.id,
      ),
      [tenantA.id],
    );
    assert.deepEqual(
      (await organizationRepository.listOrganizationsForUser(userB.id)).map(
        (organization) => organization.id,
      ),
      [tenantB.id],
    );
    assert.deepEqual(
      await organizationRepository.listOrganizationsForUser(invitedUser.id),
      [],
    );
    assert.equal(
      await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: invitedUser.id,
      }),
      null,
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
    assert.equal(
      await membershipRepository.findMembershipForOrganization({
        organizationId: tenantA.id,
        userId: userB.id,
        membershipId: membershipA.id,
      }),
      null,
    );
    assert.deepEqual(
      await membershipRepository.listMembershipsForOrganization({
        organizationId: tenantA.id,
        userId: userB.id,
      }),
      [],
    );

    const membershipsForTenantA = await membershipRepository.listMembershipsForOrganization({
      organizationId: tenantA.id,
      userId: userA.id,
    });
    assert.equal(membershipsForTenantA.length, 2);
    assert.deepEqual(
      new Set(membershipsForTenantA.map((membership) => membership.id)),
      new Set([membershipA.id, invitedMembership.id]),
    );
    assert.equal(
      membershipsForTenantA.every(
        (membership) => membership.organizationId === tenantA.id,
      ),
      true,
    );

    await db.organization.update({
      where: { id: tenantA.id },
      data: { status: 'SUSPENDED' },
    });

    assert.equal(
      await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      null,
    );
    assert.equal(
      await organizationRepository.findOrganizationBySlugForUser({
        organizationSlug: tenantA.slug,
        userId: userA.id,
      }),
      null,
    );
    assert.deepEqual(await organizationRepository.listOrganizationsForUser(userA.id), []);
    assert.deepEqual(
      await membershipRepository.listMembershipsForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      [],
    );
    assert.equal(
      await membershipRepository.findMembershipForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
        membershipId: membershipA.id,
      }),
      null,
    );

    await db.organization.update({
      where: { id: tenantA.id },
      data: { status: 'ACTIVE' },
    });
    await db.user.update({
      where: { id: userA.id },
      data: { status: 'SUSPENDED' },
    });

    assert.equal(
      await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      null,
    );
    assert.deepEqual(await organizationRepository.listOrganizationsForUser(userA.id), []);
    assert.deepEqual(
      await membershipRepository.listMembershipsForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      [],
    );
    assert.equal(
      await membershipRepository.findMembershipForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
        membershipId: membershipA.id,
      }),
      null,
    );

    await db.user.update({
      where: { id: userA.id },
      data: { status: 'ACTIVE' },
    });
    await db.organizationMembership.update({
      where: { id: membershipA.id },
      data: { status: 'SUSPENDED' },
    });

    assert.equal(
      await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      null,
    );
    assert.deepEqual(
      await membershipRepository.listMembershipsForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      [],
    );
    assert.equal(
      await membershipRepository.findMembershipForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
        membershipId: membershipA.id,
      }),
      null,
    );

    await db.organizationMembership.update({
      where: { id: membershipA.id },
      data: { status: 'ARCHIVED' },
    });

    assert.equal(
      await organizationRepository.findOrganizationForUser({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      null,
    );
    assert.deepEqual(
      await membershipRepository.listMembershipsForOrganization({
        organizationId: tenantA.id,
        userId: userA.id,
      }),
      [],
    );
  } finally {
    try {
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

    } finally {
      await db.$disconnect();
    }
  }
});
