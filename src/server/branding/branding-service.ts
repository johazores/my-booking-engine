import { db } from '../database.ts';
import { readOrganizationAuthorization, requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { createOrganizationSlug } from '../organizations/organization-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  brandingFontStack,
  normalizeOrganizationBranding,
  type BrandingFont,
  type OrganizationBrandingInput,
} from './branding-domain.ts';

export class BrandingConflictError extends Error {
  constructor() {
    super('Custom domain is already in use.');
    this.name = 'BrandingConflictError';
  }
}

export class BrandingUnavailableError extends Error {
  constructor() {
    super('Organization branding is unavailable.');
    this.name = 'BrandingUnavailableError';
  }
}

const brandingSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  secondaryColor: true,
  accentColor: true,
  fontFamily: true,
  contactEmail: true,
  contactPhone: true,
  websiteUrl: true,
  emailFromName: true,
  emailReplyTo: true,
  publicBookingTitle: true,
  publicBookingDescription: true,
  customDomain: true,
} as const;

const publicBrandingSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  secondaryColor: true,
  accentColor: true,
  fontFamily: true,
  contactEmail: true,
  contactPhone: true,
  websiteUrl: true,
  publicBookingTitle: true,
  publicBookingDescription: true,
} as const;

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function readOrganizationBranding(input: { organizationId: string; userId: string }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.userId, 'userId');
  const authorization = await readOrganizationAuthorization(input);
  if (!authorization) return null;

  const organization = await db.organization.findFirst({
    where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
    select: brandingSelect,
  });
  if (!organization) return null;

  return {
    ...organization,
    fontFamily: organization.fontFamily as BrandingFont,
    fontStack: brandingFontStack(organization.fontFamily as BrandingFont),
  };
}

export async function readPublicOrganizationBrandingBySlug(slug: string) {
  const canonicalSlug = createOrganizationSlug(slug);
  const organization = await db.organization.findFirst({
    where: { slug: canonicalSlug, status: 'ACTIVE', deletedAt: null },
    select: publicBrandingSelect,
  });
  if (!organization) return null;
  return {
    ...organization,
    fontFamily: organization.fontFamily as BrandingFont,
    fontStack: brandingFontStack(organization.fontFamily as BrandingFont),
  };
}

export async function updateOrganizationBranding(input: {
  organizationId: string;
  actorUserId: string;
  branding: OrganizationBrandingInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'organization-settings:manage',
  });

  const next = normalizeOrganizationBranding(input.branding);

  try {
    return await db.$transaction(async (transaction) => {
      const current = await transaction.organization.findFirst({
        where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
        select: brandingSelect,
      });
      if (!current) throw new BrandingUnavailableError();

      const comparableCurrent = {
        logoUrl: current.logoUrl,
        faviconUrl: current.faviconUrl,
        primaryColor: current.primaryColor,
        secondaryColor: current.secondaryColor,
        accentColor: current.accentColor,
        fontFamily: current.fontFamily,
        contactEmail: current.contactEmail,
        contactPhone: current.contactPhone,
        websiteUrl: current.websiteUrl,
        emailFromName: current.emailFromName,
        emailReplyTo: current.emailReplyTo,
        publicBookingTitle: current.publicBookingTitle,
        publicBookingDescription: current.publicBookingDescription,
        customDomain: current.customDomain,
      };

      if (JSON.stringify(comparableCurrent) === JSON.stringify(next)) return current;

      const updated = await transaction.organization.update({
        where: { id: current.id },
        data: next,
        select: brandingSelect,
      });

      await transaction.auditEvent.create({
        data: {
          organizationId: current.id,
          actorUserId: input.actorUserId,
          action: 'organization.branding.updated',
          resourceType: 'organization',
          resourceId: current.id,
          beforeData: comparableCurrent,
          afterData: next,
        },
      });

      return updated;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new BrandingConflictError();
    throw error;
  }
}
