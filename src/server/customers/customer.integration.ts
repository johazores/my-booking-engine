import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Customer integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

test('customer workflow enforces tenant scope, permissions, lifecycle, pagination, and audit history', async () => {
  const [{ db }, customers] = await Promise.all([
    import('../database.ts'),
    import('./customer-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminA = await db.user.create({ data: { email: `customer-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `customer-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `customer-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const outsider = await db.user.create({ data: { email: `customer-outsider-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Customer Tenant A', slug: `customer-a-${runId}`.slice(0, 63), kind: 'OTHER' } });
  const organizationB = await db.organization.create({ data: { name: 'Customer Tenant B', slug: `customer-b-${runId}`.slice(0, 63), kind: 'OTHER' } });
  await db.organizationMembership.createMany({
    data: [
      { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
      { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
    ],
  });

  try {
    await assert.rejects(
      customers.createCustomer({
        organizationId: organizationA.id,
        actorUserId: outsider.id,
        customer: { firstName: 'No', lastName: 'Access', email: '', phone: '', notes: '' },
      }),
      /permission/i,
    );

    const customerA = await customers.createCustomer({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      customer: { firstName: 'Ana', lastName: 'Santos', email: `ana-${runId}@example.test`, phone: '+63 917 555 0100', notes: 'Tenant A' },
    });
    const customerB = await customers.createCustomer({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      customer: { firstName: 'Ben', lastName: 'TenantB', email: `ben-${runId}@example.test`, phone: '', notes: '' },
    });

    await assert.rejects(
      customers.createCustomer({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        customer: { firstName: 'Duplicate', lastName: 'Email', email: `ANA-${runId}@EXAMPLE.TEST`, phone: '', notes: '' },
      }),
      /email/i,
    );

    const tenantAList = await customers.listCustomers({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      search: 'Ana',
      status: 'ACTIVE',
      sort: 'name-asc',
      page: 1,
      pageSize: 20,
    });
    assert.equal(tenantAList.total, 1);
    assert.deepEqual(tenantAList.customers.map((customer) => customer.id), [customerA.id]);
    assert.equal(tenantAList.customers.some((customer) => customer.id === customerB.id), false);

    const crossTenantRead = await customers.readCustomer({ organizationId: organizationA.id, actorUserId: adminA.id, customerId: customerB.id });
    assert.equal(crossTenantRead, null);
    await assert.rejects(
      customers.updateCustomer({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        customerId: customerB.id,
        customer: { firstName: 'Cross', lastName: 'Tenant', email: '', phone: '', notes: '' },
      }),
      /not available/i,
    );

    await customers.updateCustomer({
      organizationId: organizationA.id,
      actorUserId: staffA.id,
      customerId: customerA.id,
      customer: { firstName: 'Ana', lastName: 'Santos', email: `ana-${runId}@example.test`, phone: '+63 917 555 0101', notes: 'Updated' },
    });
    const detail = await customers.readCustomerWithActivity({ organizationId: organizationA.id, actorUserId: adminA.id, customerId: customerA.id });
    assert.equal(detail?.customer.phone, '+63 917 555 0101');
    assert.ok(detail?.activity.some((event) => event.action === 'customer.created'));
    assert.ok(detail?.activity.some((event) => event.action === 'customer.updated'));

    await customers.archiveCustomer({ organizationId: organizationA.id, actorUserId: adminA.id, customerId: customerA.id, confirmation: 'ARCHIVE' });
    const archived = await customers.readCustomer({ organizationId: organizationA.id, actorUserId: adminA.id, customerId: customerA.id });
    assert.equal(archived?.status, 'ARCHIVED');
    assert.ok(archived?.archivedAt);
    await assert.rejects(
      customers.updateCustomer({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        customerId: customerA.id,
        customer: { firstName: 'Archived', lastName: 'Edit', email: '', phone: '', notes: '' },
      }),
      /not available/i,
    );
  } finally {
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.customer.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id, outsider.id] } } });
  }
});
