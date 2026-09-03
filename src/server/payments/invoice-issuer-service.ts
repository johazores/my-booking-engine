import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  InvoiceIssuerValidationError,
  createInvoiceIssuerProfile,
  invoiceIssuerProfileFingerprint,
  parseInvoiceIssuerProfileSnapshot,
  type InvoiceIssuerProfileSnapshot,
} from './invoice-issuer-domain.ts';

export class InvoiceIssuerProfileUnavailableError extends Error {
  constructor(message = 'Invoice issuer profile is not available for this organization.') {
    super(message);
    this.name = 'InvoiceIssuerProfileUnavailableError';
  }
}

export class InvoiceIssuerProfilePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceIssuerProfilePersistenceError';
  }
}

export class InvoiceIssuerProfileWriteConflictError extends Error {
  constructor() {
    super('Invoice issuer profile changed concurrently. Retry the operation.');
    this.name = 'InvoiceIssuerProfileWriteConflictError';
  }
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return null;
  return error.code;
}

function isRetryableProfileWrite(error: unknown) {
  const code = prismaErrorCode(error);
  return code === 'P2002' || code === 'P2034';
}

function assertPersistedIssuerProfile(row: {
  id: string;
  organizationId: string;
  version: number;
  fingerprint: string;
  countryCode: string;
  profileSnapshot: Prisma.JsonValue;
  createdByUserId: string;
  createdAt: Date;
}) {
  let snapshot: InvoiceIssuerProfileSnapshot;
  try {
    snapshot = parseInvoiceIssuerProfileSnapshot(row.profileSnapshot);
  } catch (error) {
    if (error instanceof InvoiceIssuerValidationError) {
      throw new InvoiceIssuerProfilePersistenceError(error.message);
    }
    throw error;
  }
  const expectedFingerprint = invoiceIssuerProfileFingerprint(snapshot);
  if (row.fingerprint !== expectedFingerprint || row.countryCode !== snapshot.countryCode || row.version < 1) {
    throw new InvoiceIssuerProfilePersistenceError('Persisted invoice issuer profile failed integrity validation.');
  }
  return { ...row, snapshot };
}

export async function readCurrentInvoiceIssuerProfile(input: {
  organizationId: string;
  actorUserId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'organization-settings:manage',
  });

  const row = await db.invoiceIssuerProfile.findFirst({
    where: { organizationId: input.organizationId },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  return row ? assertPersistedIssuerProfile(row) : null;
}

export async function createInvoiceIssuerProfileVersion(input: {
  organizationId: string;
  actorUserId: string;
  legalName: unknown;
  addressLine1: unknown;
  addressLine2?: unknown;
  city: unknown;
  region?: unknown;
  postalCode?: unknown;
  countryCode: unknown;
  contactEmail?: unknown;
  registrations?: unknown;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'organization-settings:manage',
  });

  const canonical = createInvoiceIssuerProfile(input);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (transaction) => {
        const organization = await transaction.organization.findFirst({
          where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        });
        if (!organization) throw new InvoiceIssuerProfileUnavailableError();

        const current = await transaction.invoiceIssuerProfile.findFirst({
          where: { organizationId: organization.id },
          orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        });
        if (current?.fingerprint === canonical.fingerprint) {
          return assertPersistedIssuerProfile(current);
        }

        const created = await transaction.invoiceIssuerProfile.create({
          data: {
            organizationId: organization.id,
            version: (current?.version ?? 0) + 1,
            fingerprint: canonical.fingerprint,
            countryCode: canonical.snapshot.countryCode,
            profileSnapshot: toJsonInput(canonical.snapshot),
            createdByUserId: input.actorUserId,
          },
        });

        await transaction.auditEvent.create({
          data: {
            organizationId: organization.id,
            actorUserId: input.actorUserId,
            action: 'organization.invoice-issuer-profile.created',
            resourceType: 'invoice-issuer-profile',
            resourceId: created.id,
            beforeData: current ? {
              version: current.version,
              fingerprint: current.fingerprint,
              countryCode: current.countryCode,
            } : undefined,
            afterData: {
              version: created.version,
              fingerprint: created.fingerprint,
              countryCode: created.countryCode,
              registrationSchemes: canonical.snapshot.registrations.map((registration) => ({
                scheme: registration.scheme,
                countryCode: registration.countryCode,
              })),
            },
          },
        });

        return assertPersistedIssuerProfile(created);
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!isRetryableProfileWrite(error)) throw error;
      if (attempt === 2) throw new InvoiceIssuerProfileWriteConflictError();
    }
  }
  throw new InvoiceIssuerProfileWriteConflictError();
}

export async function readCurrentInvoiceIssuerProfileForPreparation(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
}) {
  const row = await input.transaction.invoiceIssuerProfile.findFirst({
    where: { organizationId: input.organizationId },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  if (!row) throw new InvoiceIssuerProfileUnavailableError('Configure an invoice issuer profile before preparing a legal invoice document.');
  return assertPersistedIssuerProfile(row);
}
