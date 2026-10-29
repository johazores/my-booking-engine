import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Authorization integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('authorization services enforce tenant scope, least privilege, audit writes, and the last-admin invariant', async () => {
  const [{ db }, authorization, roles, statuses] = await Promise.all([
    import('../database.ts'),
    import('./authorization-service.ts'),
    import('../memberships/membership-role-service.ts'),
    import('../memberships/membership-status-service.ts'),
  ]);

  const suffix = `${process.pid}-${Date.now()}`;
  // Preassign cleanup identities before any fixture write.
  const createdOrganizationIds: string[] = [crypto.randomUUID(), crypto.randomUUID()];
  const createdUserIds: string[] = Array.from({ length: 5 }, () => crypto.randomUUID());

  try {
    const admin = await db.user.create({ data: { id: createdUserIds[0], email: `auth-admin-${suffix}@example.test` } });
    const manager = await db.user.create({ data: { id: createdUserIds[1], email: `auth-manager-${suffix}@example.test` } });
    const staff = await db.user.create({ data: { id: createdUserIds[2], email: `auth-staff-${suffix}@example.test` } });
    const otherAdmin = await db.user.create({ data: { id: createdUserIds[3], email: `auth-other-${suffix}@example.test` } });
    const platformAdmin = await db.user.create({ data: { id: createdUserIds[4], email: `auth-platform-${suffix}@example.test`, platformRole: 'ADMIN' } });
    const organization = await db.organization.create({ data: { id: createdOrganizationIds[0], slug: `auth-a-${suffix}`, name: 'Authorization A', kind: 'HOTEL' } });
    const otherOrganization = await db.organization.create({ data: { id: createdOrganizationIds[1], slug: `auth-b-${suffix}`, name: 'Authorization B', kind: 'HOTEL' } });
    // Sequential setup prevents teardown racing unfinished parallel inserts.
    const adminMembership = await db.organizationMembership.create({ data: { organizationId: organization.id, userId: admin.id, role: 'ADMIN' } });
    const managerMembership = await db.organizationMembership.create({ data: { organizationId: organization.id, userId: manager.id, role: 'MANAGER' } });
    const staffMembership = await db.organizationMembership.create({ data: { organizationId: organization.id, userId: staff.id, role: 'STAFF' } });
    const otherMembership = await db.organizationMembership.create({ data: { organizationId: otherOrganization.id, userId: otherAdmin.id, role: 'ADMIN' } });

    assert.equal((await authorization.readOrganizationAuthorization({ organizationId: organization.id, userId: admin.id }))?.role, 'ADMIN');
    assert.equal((await authorization.readOrganizationAuthorization({ organizationId: organization.id, userId: platformAdmin.id }))?.platformAdmin, true);
    assert.equal(await authorization.readOrganizationAuthorization({ organizationId: otherOrganization.id, userId: manager.id }), null);

    await authorization.requireOrganizationPermission({ organizationId: organization.id, userId: manager.id, permission: 'membership:manage' });
    await assert.rejects(
      authorization.requireOrganizationPermission({ organizationId: organization.id, userId: manager.id, permission: 'membership-role:manage' }),
      authorization.OrganizationPermissionDeniedError,
    );
    await assert.rejects(
      authorization.requireOrganizationPermission({ organizationId: organization.id, userId: staff.id, permission: 'membership:manage' }),
      authorization.OrganizationPermissionDeniedError,
    );

    const suspended = await statuses.updateMembershipStatus({
      organizationId: organization.id,
      actorUserId: manager.id,
      membershipId: staffMembership.id,
      status: 'SUSPENDED',
    });
    assert.equal(suspended.status, 'SUSPENDED');

    await assert.rejects(
      statuses.updateMembershipStatus({ organizationId: organization.id, actorUserId: manager.id, membershipId: otherMembership.id, status: 'SUSPENDED' }),
      statuses.MembershipStatusValidationError,
    );
    await assert.rejects(
      statuses.updateMembershipStatus({ organizationId: organization.id, actorUserId: staff.id, membershipId: managerMembership.id, status: 'SUSPENDED' }),
      authorization.OrganizationPermissionDeniedError,
    );
    await assert.rejects(
      statuses.updateMembershipStatus({ organizationId: organization.id, actorUserId: admin.id, membershipId: adminMembership.id, status: 'SUSPENDED' }),
      statuses.MembershipStatusConflictError,
    );
    await assert.rejects(
      roles.updateMembershipRole({ organizationId: organization.id, actorUserId: admin.id, membershipId: adminMembership.id, role: 'STAFF' }),
      roles.MembershipRoleConflictError,
    );

    const promoted = await roles.updateMembershipRole({
      organizationId: organization.id,
      actorUserId: platformAdmin.id,
      membershipId: managerMembership.id,
      role: 'ADMIN',
    });
    assert.equal(promoted.role, 'ADMIN');

    const archived = await statuses.updateMembershipStatus({
      organizationId: organization.id,
      actorUserId: admin.id,
      membershipId: staffMembership.id,
      status: 'ARCHIVED',
    });
    assert.equal(archived.status, 'ARCHIVED');
    await assert.rejects(
      statuses.updateMembershipStatus({ organizationId: organization.id, actorUserId: admin.id, membershipId: staffMembership.id, status: 'ACTIVE' }),
      statuses.MembershipStatusValidationError,
    );

    const auditEvents = await db.auditEvent.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true, actorUserId: true, resourceId: true, beforeData: true, afterData: true },
    });
    assert.deepEqual(auditEvents.map((event) => event.action), [
      'membership.status.changed',
      'membership.role.changed',
      'membership.status.changed',
    ]);
    assert.equal(auditEvents.every((event) => Boolean(event.actorUserId && event.resourceId)), true);
  } finally {
    try {
      if (createdOrganizationIds.length > 0) await db.auditEvent.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } });
      if (createdOrganizationIds.length > 0 || createdUserIds.length > 0) {
        await db.organizationMembership.deleteMany({
          where: { OR: [{ organizationId: { in: createdOrganizationIds } }, { userId: { in: createdUserIds } }] },
        });
      }
      if (createdOrganizationIds.length > 0) await db.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
      if (createdUserIds.length > 0) await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    } finally {
      await db.$disconnect();
    }
  }
});
