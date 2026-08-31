import { db } from '../database.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  assertOrganizationArchiveConfirmation,
  assertOrganizationStatusTransition,
  createOrganizationCurrency,
  createOrganizationKind,
  createOrganizationName,
  createOrganizationSlug,
  createOrganizationTimezone,
} from './organization-domain.ts';

export class OrganizationSettingsConflictError extends Error {
  constructor() {
    super('Organization slug is already in use.');
    this.name = 'OrganizationSettingsConflictError';
  }
}

export class OrganizationSettingsDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrganizationSettingsDependencyError';
  }
}

export class OrganizationUnavailableError extends Error {
  constructor() {
    super('The organization is no longer available.');
    this.name = 'OrganizationUnavailableError';
  }
}

export class OrganizationArchiveConfirmationError extends Error {
  constructor() {
    super('Organization archive confirmation did not match.');
    this.name = 'OrganizationArchiveConfirmationError';
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function updateOrganizationSettings(input: {
  organizationId: string;
  actorUserId: string;
  name: string;
  slug: string;
  kind: string;
  timezone: string;
  currency: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'organization-settings:manage' });

  const next = {
    name: createOrganizationName(input.name),
    slug: createOrganizationSlug(input.slug),
    kind: createOrganizationKind(input.kind),
    timezone: createOrganizationTimezone(input.timezone),
    currency: createOrganizationCurrency(input.currency),
  };

  try {
    return await db.$transaction(async (transaction) => {
      const current = await transaction.organization.findFirst({
        where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
        select: { id: true, name: true, slug: true, kind: true, timezone: true, currency: true },
      });
      if (!current) throw new OrganizationUnavailableError();

      const unchanged = current.name === next.name && current.slug === next.slug && current.kind === next.kind && current.timezone === next.timezone && current.currency === next.currency;
      if (unchanged) return current;

      if (current.currency !== next.currency) {
        const [activeBaseRates, activeFixedCharges] = await Promise.all([
          transaction.hospitalityBaseRate.count({ where: { organizationId: current.id, status: 'ACTIVE' } }),
          transaction.hospitalityChargeRule.count({ where: { organizationId: current.id, status: 'ACTIVE', amountMinor: { not: null } } }),
        ]);
        if (activeBaseRates > 0) throw new OrganizationSettingsDependencyError('Archive active base rates before changing the organization currency.');
        if (activeFixedCharges > 0) throw new OrganizationSettingsDependencyError('Archive active fixed taxes and fees before changing the organization currency.');
      }

      const updated = await transaction.organization.update({ where: { id: current.id }, data: next });
      await transaction.auditEvent.create({
        data: {
          organizationId: current.id,
          actorUserId: input.actorUserId,
          action: 'organization.settings.updated',
          resourceType: 'organization',
          resourceId: current.id,
          beforeData: { name: current.name, slug: current.slug, kind: current.kind, timezone: current.timezone, currency: current.currency },
          afterData: next,
        },
      });
      return updated;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new OrganizationSettingsConflictError();
    throw error;
  }
}

export async function archiveOrganization(input: { organizationId: string; actorUserId: string; confirmation: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'organization:manage' });

  return db.$transaction(async (transaction) => {
    const current = await transaction.organization.findFirst({
      where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (!current) throw new OrganizationUnavailableError();
    try {
      assertOrganizationArchiveConfirmation(input.confirmation, current.slug);
    } catch {
      throw new OrganizationArchiveConfirmationError();
    }
    assertOrganizationStatusTransition(current.status, 'ARCHIVED');
    const archivedAt = new Date();
    const updated = await transaction.organization.update({ where: { id: current.id }, data: { status: 'ARCHIVED', deletedAt: archivedAt } });
    await transaction.auditEvent.create({
      data: { organizationId: current.id, actorUserId: input.actorUserId, action: 'organization.archived', resourceType: 'organization', resourceId: current.id, beforeData: { status: current.status, deletedAt: null }, afterData: { status: 'ARCHIVED', deletedAt: archivedAt.toISOString() } },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}
