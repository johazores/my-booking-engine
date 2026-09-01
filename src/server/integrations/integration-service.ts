import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { decryptIntegrationCredentials, encryptIntegrationCredentials, type IntegrationCredentials } from './integration-crypto.ts';
import {
  normalizeIntegrationCapabilities,
  normalizeIntegrationDisplayName,
  normalizeIntegrationProviderCode,
  publicIntegrationRecord,
} from './integration-domain.ts';

export class IntegrationUnavailableError extends Error {
  constructor(message = 'Integration is not available in this organization.') {
    super(message);
    this.name = 'IntegrationUnavailableError';
  }
}

export async function saveIntegration(input: {
  organizationId: string;
  actorUserId: string;
  providerCode: unknown;
  displayName: unknown;
  capabilities: unknown;
  credentials: unknown;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'integration:manage',
  });

  const providerCode = normalizeIntegrationProviderCode(input.providerCode);
  const displayName = normalizeIntegrationDisplayName(input.displayName);
  const capabilities = normalizeIntegrationCapabilities(input.capabilities);
  const encryptedCredentials = encryptIntegrationCredentials(input.credentials);

  return db.$transaction(async (transaction) => {
    const existing = await transaction.integration.findUnique({
      where: { organizationId_providerCode: { organizationId: input.organizationId, providerCode } },
    });
    const integration = existing
      ? await transaction.integration.update({
          where: { id: existing.id },
          data: {
            displayName,
            capabilities,
            encryptedCredentials,
            credentialVersion: { increment: 1 },
            status: 'ACTIVE',
          },
        })
      : await transaction.integration.create({
          data: {
            organizationId: input.organizationId,
            providerCode,
            displayName,
            capabilities,
            encryptedCredentials,
          },
        });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: existing ? 'integration.credentials-rotated' : 'integration.configured',
        resourceType: 'integration',
        resourceId: integration.id,
        afterData: {
          providerCode: integration.providerCode,
          displayName: integration.displayName,
          status: integration.status,
          capabilities: integration.capabilities,
          credentialVersion: integration.credentialVersion,
        },
      },
    });

    return publicIntegrationRecord(integration);
  });
}

export async function listIntegrations(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'integration:read',
  });
  const integrations = await db.integration.findMany({
    where: { organizationId: input.organizationId },
    orderBy: [{ providerCode: 'asc' }, { id: 'asc' }],
  });
  return integrations.map(publicIntegrationRecord);
}

export async function enableIntegration(input: {
  organizationId: string;
  actorUserId: string;
  integrationId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.integrationId, 'integrationId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'integration:manage',
  });

  return db.$transaction(async (transaction) => {
    const existing = await transaction.integration.findFirst({
      where: { id: input.integrationId, organizationId: input.organizationId },
    });
    if (!existing) throw new IntegrationUnavailableError();
    const integration = existing.status === 'ACTIVE'
      ? existing
      : await transaction.integration.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });

    if (existing.status !== 'ACTIVE') {
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'integration.enabled',
          resourceType: 'integration',
          resourceId: integration.id,
          afterData: {
            providerCode: integration.providerCode,
            status: integration.status,
            credentialVersion: integration.credentialVersion,
          },
        },
      });
    }
    return publicIntegrationRecord(integration);
  });
}

export async function disableIntegration(input: {
  organizationId: string;
  actorUserId: string;
  integrationId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.integrationId, 'integrationId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'integration:manage',
  });

  return db.$transaction(async (transaction) => {
    const existing = await transaction.integration.findFirst({
      where: { id: input.integrationId, organizationId: input.organizationId },
    });
    if (!existing) throw new IntegrationUnavailableError();
    const integration = existing.status === 'DISABLED'
      ? existing
      : await transaction.integration.update({ where: { id: existing.id }, data: { status: 'DISABLED' } });

    if (existing.status !== 'DISABLED') {
      await transaction.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: 'integration.disabled',
          resourceType: 'integration',
          resourceId: integration.id,
          afterData: {
            providerCode: integration.providerCode,
            status: integration.status,
            credentialVersion: integration.credentialVersion,
          },
        },
      });
    }
    return publicIntegrationRecord(integration);
  });
}

export async function loadActiveIntegrationCredentials(input: {
  organizationId: string;
  providerCode: unknown;
}): Promise<{ integration: ReturnType<typeof publicIntegrationRecord>; credentials: IntegrationCredentials }> {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const providerCode = normalizeIntegrationProviderCode(input.providerCode);
  const integration = await db.integration.findUnique({
    where: { organizationId_providerCode: { organizationId: input.organizationId, providerCode } },
  });
  if (!integration || integration.status !== 'ACTIVE') throw new IntegrationUnavailableError();
  return {
    integration: publicIntegrationRecord(integration),
    credentials: decryptIntegrationCredentials(integration.encryptedCredentials),
  };
}
