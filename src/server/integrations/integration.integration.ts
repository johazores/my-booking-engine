import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Integration persistence tests must run through npm run test:database with TEST_DATABASE_URL.');
}

process.env.SF_INTEGRATION_MASTER_KEY = Buffer.alloc(32, 17).toString('base64url');

test('tenant integrations enforce database ownership, authorization, lifecycle, archive safety, and secret-safe reads', async () => {
  const [{ db }, integrations] = await Promise.all([
    import('../database.ts'),
    import('./integration-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const tenantAAdmin = await db.user.create({
    data: { email: `integration-a-admin-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantAManager = await db.user.create({
    data: { email: `integration-a-manager-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantBAdmin = await db.user.create({
    data: { email: `integration-b-admin-${runId}@example.test`, status: 'ACTIVE' },
  });
  const tenantA = await db.organization.create({
    data: {
      name: 'Integration Tenant A',
      slug: `integration-a-${runId}`.slice(0, 63),
      kind: 'OTHER',
      timezone: 'UTC',
      currency: 'USD',
    },
  });
  const tenantB = await db.organization.create({
    data: {
      name: 'Integration Tenant B',
      slug: `integration-b-${runId}`.slice(0, 63),
      kind: 'OTHER',
      timezone: 'UTC',
      currency: 'USD',
    },
  });

  await db.organizationMembership.createMany({
    data: [
      { organizationId: tenantA.id, userId: tenantAAdmin.id, status: 'ACTIVE', role: 'ADMIN' },
      { organizationId: tenantA.id, userId: tenantAManager.id, status: 'ACTIVE', role: 'MANAGER' },
      { organizationId: tenantB.id, userId: tenantBAdmin.id, status: 'ACTIVE', role: 'ADMIN' },
    ],
  });

  try {
    await assert.rejects(
      integrations.saveIntegration({
        organizationId: tenantA.id,
        actorUserId: tenantAManager.id,
        providerCode: 'stripe',
        displayName: 'Stripe',
        capabilities: ['payment-authorize'],
        credentials: { secretKey: 'sk_test_manager_must_not_store' },
      }),
      /permission/i,
    );

    const configured = await integrations.saveIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      providerCode: 'stripe',
      displayName: 'Stripe Payments',
      capabilities: ['payment-refund', 'payment-authorize', 'payment-capture', 'webhooks'],
      credentials: { secretKey: 'sk_test_initial', webhookSecret: 'whsec_initial' },
    });
    assert.equal(configured.organizationId, tenantA.id);
    assert.equal(configured.credentialVersion, 1);
    assert.equal(configured.archivedAt, null);
    assert.equal('encryptedCredentials' in configured, false);

    const managerList = await integrations.listIntegrations({
      organizationId: tenantA.id,
      actorUserId: tenantAManager.id,
    });
    assert.equal(managerList[0]?.id, configured.id);
    assert.equal('encryptedCredentials' in (managerList[0] ?? {}), false);
    assert.equal(
      (await integrations.listIntegrations({ organizationId: tenantB.id, actorUserId: tenantBAdmin.id })).length,
      0,
    );

    for (const operation of [
      integrations.disableIntegration,
      integrations.enableIntegration,
      integrations.archiveIntegration,
    ]) {
      await assert.rejects(
        operation({
          organizationId: tenantB.id,
          actorUserId: tenantBAdmin.id,
          integrationId: configured.id,
        }),
        /not available/i,
      );
    }

    const rotated = await integrations.saveIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      providerCode: 'stripe',
      displayName: 'Stripe Payments',
      capabilities: ['payment-authorize', 'payment-capture', 'payment-refund', 'webhooks'],
      credentials: { secretKey: 'sk_test_rotated', webhookSecret: 'whsec_rotated' },
    });
    assert.equal(rotated.credentialVersion, 2);
    assert.equal(
      (await integrations.loadActiveIntegrationCredentials({ organizationId: tenantA.id, providerCode: 'stripe' }))
        .credentials.secretKey,
      'sk_test_rotated',
    );

    await assert.rejects(
      integrations.archiveIntegration({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        integrationId: configured.id,
      }),
      /disable/i,
    );

    const disabled = await integrations.disableIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: configured.id,
    });
    assert.equal(disabled.status, 'DISABLED');

    await assert.rejects(
      integrations.enableIntegration({
        organizationId: tenantA.id,
        actorUserId: tenantAManager.id,
        integrationId: configured.id,
      }),
      /permission/i,
    );

    const enabled = await integrations.enableIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: configured.id,
    });
    assert.equal(enabled.status, 'ACTIVE');
    assert.equal(enabled.credentialVersion, 2);

    const enabledRetry = await integrations.enableIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: configured.id,
    });
    assert.equal(enabledRetry.status, 'ACTIVE');
    assert.equal(enabledRetry.credentialVersion, 2);
    assert.equal(
      (await integrations.loadActiveIntegrationCredentials({ organizationId: tenantA.id, providerCode: 'stripe' }))
        .credentials.webhookSecret,
      'whsec_rotated',
    );

    await integrations.disableIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: configured.id,
    });
    await assert.rejects(
      integrations.archiveIntegration({
        organizationId: tenantA.id,
        actorUserId: tenantAManager.id,
        integrationId: configured.id,
      }),
      /permission/i,
    );

    const archived = await integrations.archiveIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: configured.id,
    });
    assert.equal(archived.status, 'ARCHIVED');
    assert.ok(archived.archivedAt instanceof Date);

    const archivedRow = await db.integration.findFirstOrThrow({
      where: { id: configured.id, organizationId: tenantA.id },
    });
    assert.equal(archivedRow.encryptedCredentials, null);

    await assert.rejects(
      integrations.loadActiveIntegrationCredentials({ organizationId: tenantA.id, providerCode: 'stripe' }),
      /not available/i,
    );
    await assert.rejects(
      integrations.enableIntegration({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        integrationId: configured.id,
      }),
      /fresh credentials/i,
    );
    await assert.rejects(
      integrations.disableIntegration({
        organizationId: tenantA.id,
        actorUserId: tenantAAdmin.id,
        integrationId: configured.id,
      }),
      /archived/i,
    );

    const archiveRetry = await integrations.archiveIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      integrationId: configured.id,
    });
    assert.equal(archiveRetry.status, 'ARCHIVED');

    const reconfigured = await integrations.saveIntegration({
      organizationId: tenantA.id,
      actorUserId: tenantAAdmin.id,
      providerCode: 'stripe',
      displayName: 'Stripe Payments',
      capabilities: ['payment-authorize', 'payment-capture', 'payment-refund'],
      credentials: { secretKey: 'sk_test_reconnected' },
    });
    assert.equal(reconfigured.id, configured.id);
    assert.equal(reconfigured.status, 'ACTIVE');
    assert.equal(reconfigured.credentialVersion, 3);
    assert.equal(reconfigured.archivedAt, null);
    assert.equal(
      (await integrations.loadActiveIntegrationCredentials({ organizationId: tenantA.id, providerCode: 'stripe' }))
        .credentials.secretKey,
      'sk_test_reconnected',
    );

    const auditEvents = await db.auditEvent.findMany({
      where: { organizationId: tenantA.id, resourceType: 'integration', resourceId: configured.id },
      orderBy: { createdAt: 'asc' },
    });
    assert.deepEqual(
      auditEvents.map((event) => event.action),
      [
        'integration.configured',
        'integration.credentials-rotated',
        'integration.disabled',
        'integration.enabled',
        'integration.disabled',
        'integration.archived',
        'integration.reconfigured',
      ],
    );
    const auditPayload = JSON.stringify(
      auditEvents.map((event) => ({ beforeData: event.beforeData, afterData: event.afterData })),
    );
    assert.equal(auditPayload.includes('sk_test_'), false);
    assert.equal(auditPayload.includes('whsec_'), false);

    await assert.rejects(
      db.integration.create({
        data: {
          organizationId: crypto.randomUUID(),
          providerCode: 'orphan-provider',
          displayName: 'Orphan Provider',
          status: 'ACTIVE',
          capabilities: ['availability'],
          encryptedCredentials: 'v1.invalid.invalid.invalid',
        },
      }),
    );
  } finally {
    await db.integration.deleteMany({ where: { organizationId: { in: [tenantA.id, tenantB.id] } } });
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [tenantA.id, tenantB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [tenantA.id, tenantB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.user.deleteMany({
      where: { id: { in: [tenantAAdmin.id, tenantAManager.id, tenantBAdmin.id] } },
    });
  }
});
