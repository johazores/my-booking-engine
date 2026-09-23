import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { decryptIntegrationCredentials, encryptIntegrationCredentials, type IntegrationCredentials } from './integration-crypto.ts';
import {
  normalizeIntegrationCapabilities,
  normalizeIntegrationDisplayName,
  normalizeIntegrationProviderCode,
  publicIntegrationRecord,
  readCurrentIntegrationHealth,
} from './integration-domain.ts';

const DEFAULT_INTEGRATION_PAGE_SIZE = 20;
const MAX_INTEGRATION_PAGE_SIZE = 50;
const MAX_COMPLETE_INTEGRATION_ROWS = 1_000;

export class IntegrationUnavailableError extends Error {
  constructor(message = 'Integration is not available in this organization.') {
    super(message);
    this.name = 'IntegrationUnavailableError';
  }
}

export class IntegrationLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationLifecycleError';
  }
}

export class IntegrationWriteConflictError extends IntegrationLifecycleError {
  constructor() {
    super('Integration changed concurrently. Refresh and retry the operation.');
    this.name = 'IntegrationWriteConflictError';
  }
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return null;
  return error.code;
}

function isIntegrationWriteConflict(error: unknown) {
  const code = prismaErrorCode(error);
  return code === 'P2002' || code === 'P2025' || code === 'P2034';
}

function normalizePage(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : 1;
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isSafeInteger(value) || (value ?? 0) < 1) return DEFAULT_INTEGRATION_PAGE_SIZE;
  return Math.min(value as number, MAX_INTEGRATION_PAGE_SIZE);
}

async function requireIntegrationReadAccess(input: { organizationId: string; actorUserId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'integration:read',
  });
}

async function readIntegrationHealthEvent(input: { organizationId: string; integrationId: string }) {
  return db.auditEvent.findFirst({
    where: {
      organizationId: input.organizationId,
      action: 'integration.connection-tested',
      resourceType: 'integration',
      resourceId: input.integrationId,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true, afterData: true },
  });
}

async function runIntegrationWrite<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof IntegrationUnavailableError || error instanceof IntegrationLifecycleError) throw error;
    if (isIntegrationWriteConflict(error)) throw new IntegrationWriteConflictError();
    throw error;
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

  return runIntegrationWrite(() => db.$transaction(async (transaction) => {
    const existing = await transaction.integration.findUnique({
      where: { organizationId_providerCode: { organizationId: input.organizationId, providerCode } },
    });
    const integration = existing
      ? await transaction.integration.update({
          where: {
            id: existing.id,
            organizationId: input.organizationId,
            providerCode: existing.providerCode,
            status: existing.status,
            credentialVersion: existing.credentialVersion,
          },
          data: {
            displayName,
            capabilities,
            encryptedCredentials,
            credentialVersion: { increment: 1 },
            status: 'ACTIVE',
            archivedAt: null,
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
        action: existing?.status === 'ARCHIVED'
          ? 'integration.reconfigured'
          : existing
            ? 'integration.credentials-rotated'
            : 'integration.configured',
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
  }, { isolationLevel: 'Serializable' }));
}

export async function readIntegrationByProviderCode(input: {
  organizationId: string;
  actorUserId: string;
  providerCode: unknown;
}) {
  await requireIntegrationReadAccess(input);
  const providerCode = normalizeIntegrationProviderCode(input.providerCode);
  const integration = await db.integration.findUnique({
    where: {
      organizationId_providerCode: {
        organizationId: input.organizationId,
        providerCode,
      },
    },
  });
  if (!integration) return null;

  const healthEvent = await readIntegrationHealthEvent({
    organizationId: input.organizationId,
    integrationId: integration.id,
  });
  return publicIntegrationRecord(
    integration,
    readCurrentIntegrationHealth({
      integrationStatus: integration.status,
      credentialVersion: integration.credentialVersion,
      event: healthEvent,
    }),
  );
}

export async function listIntegrationsPage(input: {
  organizationId: string;
  actorUserId: string;
  page?: number;
  pageSize?: number;
  excludeProviderCodes?: readonly unknown[];
}) {
  await requireIntegrationReadAccess(input);
  const pageSize = normalizePageSize(input.pageSize);
  const requestedPage = normalizePage(input.page);
  const excludeProviderCodes = [...new Set(
    (input.excludeProviderCodes ?? []).map((providerCode) => normalizeIntegrationProviderCode(providerCode)),
  )].sort();
  const where = excludeProviderCodes.length > 0
    ? { organizationId: input.organizationId, providerCode: { notIn: excludeProviderCodes } }
    : { organizationId: input.organizationId };
  const total = await db.integration.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const integrations = await db.integration.findMany({
    where,
    orderBy: [{ providerCode: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const healthEvents = await Promise.all(integrations.map((integration) => readIntegrationHealthEvent({
    organizationId: input.organizationId,
    integrationId: integration.id,
  })));
  const items = integrations.map((integration, index) => publicIntegrationRecord(
    integration,
    readCurrentIntegrationHealth({
      integrationStatus: integration.status,
      credentialVersion: integration.credentialVersion,
      event: healthEvents[index] ?? null,
    }),
  ));

  return Object.freeze({
    items: Object.freeze(items),
    total,
    page,
    pageSize,
    totalPages,
  });
}

export async function listIntegrations(input: { organizationId: string; actorUserId: string }) {
  await requireIntegrationReadAccess(input);
  const integrations = await db.integration.findMany({
    where: { organizationId: input.organizationId },
    orderBy: [{ providerCode: 'asc' }, { id: 'asc' }],
    take: MAX_COMPLETE_INTEGRATION_ROWS + 1,
  });
  if (integrations.length > MAX_COMPLETE_INTEGRATION_ROWS) {
    throw new Error('Integration collection exceeds the complete-read safety limit. Use the paginated integration reader.');
  }
  if (integrations.length === 0) return [];

  const healthEvents = await Promise.all(integrations.map((integration) => readIntegrationHealthEvent({
    organizationId: input.organizationId,
    integrationId: integration.id,
  })));

  return integrations.map((integration, index) => publicIntegrationRecord(
    integration,
    readCurrentIntegrationHealth({
      integrationStatus: integration.status,
      credentialVersion: integration.credentialVersion,
      event: healthEvents[index] ?? null,
    }),
  ));
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

  return runIntegrationWrite(() => db.$transaction(async (transaction) => {
    const existing = await transaction.integration.findFirst({
      where: { id: input.integrationId, organizationId: input.organizationId },
    });
    if (!existing) throw new IntegrationUnavailableError();
    if (existing.status === 'ARCHIVED') {
      throw new IntegrationLifecycleError('Archived integrations require fresh credentials before they can be activated.');
    }
    const integration = existing.status === 'ACTIVE'
      ? existing
      : await transaction.integration.update({
          where: {
            id: existing.id,
            organizationId: input.organizationId,
            providerCode: existing.providerCode,
            status: existing.status,
            credentialVersion: existing.credentialVersion,
          },
          data: { status: 'ACTIVE' },
        });

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
  }, { isolationLevel: 'Serializable' }));
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

  return runIntegrationWrite(() => db.$transaction(async (transaction) => {
    const existing = await transaction.integration.findFirst({
      where: { id: input.integrationId, organizationId: input.organizationId },
    });
    if (!existing) throw new IntegrationUnavailableError();
    if (existing.status === 'ARCHIVED') {
      throw new IntegrationLifecycleError('Archived integrations cannot change lifecycle state.');
    }
    const integration = existing.status === 'DISABLED'
      ? existing
      : await transaction.integration.update({
          where: {
            id: existing.id,
            organizationId: input.organizationId,
            providerCode: existing.providerCode,
            status: existing.status,
            credentialVersion: existing.credentialVersion,
          },
          data: { status: 'DISABLED' },
        });

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
  }, { isolationLevel: 'Serializable' }));
}

export async function archiveIntegration(input: {
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

  return runIntegrationWrite(() => db.$transaction(async (transaction) => {
    const existing = await transaction.integration.findFirst({
      where: { id: input.integrationId, organizationId: input.organizationId },
    });
    if (!existing) throw new IntegrationUnavailableError();
    if (existing.status === 'ARCHIVED') return publicIntegrationRecord(existing);
    if (existing.status !== 'DISABLED') {
      throw new IntegrationLifecycleError('Disable the integration before archiving it.');
    }

    const integration = await transaction.integration.update({
      where: {
        id: existing.id,
        organizationId: input.organizationId,
        providerCode: existing.providerCode,
        status: existing.status,
        credentialVersion: existing.credentialVersion,
      },
      data: {
        status: 'ARCHIVED',
        encryptedCredentials: null,
        archivedAt: new Date(),
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'integration.archived',
        resourceType: 'integration',
        resourceId: integration.id,
        beforeData: {
          providerCode: existing.providerCode,
          status: existing.status,
          credentialVersion: existing.credentialVersion,
        },
        afterData: {
          providerCode: integration.providerCode,
          status: integration.status,
          credentialVersion: integration.credentialVersion,
          credentialsPurged: true,
        },
      },
    });
    return publicIntegrationRecord(integration);
  }, { isolationLevel: 'Serializable' }));
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
  if (!integration || integration.status !== 'ACTIVE' || !integration.encryptedCredentials) throw new IntegrationUnavailableError();
  return {
    integration: publicIntegrationRecord(integration),
    credentials: decryptIntegrationCredentials(integration.encryptedCredentials),
  };
}
