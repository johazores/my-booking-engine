import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Organization management integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('organization settings and archival enforce permission, tenant scope, audit history, and active-access removal', async () => {
  const [{ db }, management] = await Promise.all([
    import('../database.ts'),
    import('./organization-management-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const slug = `org-${runId}`.slice(0, 63);
  try {
    const admin = await db.user.create({ data: { id: adminId, email: `organization-admin-${runId}@example.test`, status: 'ACTIVE' } });
    const outsider = await db.user.create({ data: { id: outsiderId, email: `organization-outsider-${runId}@example.test`, status: 'ACTIVE' } });
    const organization = await db.organization.create({ data: { id: organizationId, name: 'Organization Management Test', slug, kind: 'OTHER', timezone: 'UTC', currency: 'USD' } });
    await db.organizationMembership.create({ data: { organizationId, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' } });

    await assert.rejects(
      management.updateOrganizationSettings({
        organizationId: organization.id,
        actorUserId: outsider.id,
        name: 'Cross Tenant Write',
        slug,
        kind: 'OTHER',
        timezone: 'UTC',
        currency: 'USD',
      }),
      /permission/i,
    );

    const updated = await management.updateOrganizationSettings({
      organizationId: organization.id,
      actorUserId: admin.id,
      name: 'Updated Organization',
      slug,
      kind: 'TRAVEL_AGENCY',
      timezone: 'Asia/Manila',
      currency: 'php',
    });
    assert.equal(updated.name, 'Updated Organization');
    assert.equal(updated.kind, 'TRAVEL_AGENCY');
    assert.equal(updated.timezone, 'Asia/Manila');
    assert.equal(updated.currency, 'PHP');

    const settingsAudit = await db.auditEvent.findFirst({
      where: { organizationId: organization.id, action: 'organization.settings.updated' },
    });
    assert.equal(settingsAudit?.actorUserId, admin.id);

    await assert.rejects(
      management.archiveOrganization({ organizationId: organization.id, actorUserId: admin.id, confirmation: 'wrong-slug' }),
      /confirmation/i,
    );

    const stillActive = await db.organization.findUnique({ where: { id: organization.id } });
    assert.equal(stillActive?.status, 'ACTIVE');
    assert.equal(stillActive?.deletedAt, null);

    await management.archiveOrganization({ organizationId: organization.id, actorUserId: admin.id, confirmation: slug });

    const archived = await db.organization.findUnique({ where: { id: organization.id } });
    assert.equal(archived?.status, 'ARCHIVED');
    assert.ok(archived?.deletedAt);

    const archiveAudit = await db.auditEvent.findFirst({
      where: { organizationId: organization.id, action: 'organization.archived' },
    });
    assert.equal(archiveAudit?.actorUserId, admin.id);

    const activeMembershipAccess = await db.organization.findFirst({
      where: {
        id: organization.id,
        status: 'ACTIVE',
        deletedAt: null,
        memberships: { some: { userId: admin.id, status: 'ACTIVE' } },
      },
    });
    assert.equal(activeMembershipAccess, null);
  } finally {
    try {
      await db.auditEvent.deleteMany({ where: { organizationId } });
      await db.organizationMembership.deleteMany({ where: { organizationId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
      await db.user.deleteMany({ where: { id: { in: [adminId, outsiderId] } } });
    } finally {
      await db.$disconnect();
    }
  }
});
