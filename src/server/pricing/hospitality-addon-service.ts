import { formatAvailabilityDate, parseAvailabilityDate } from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  hospitalityAddonAmountMinor,
  normalizeHospitalityAddonInput,
  normalizeHospitalityAddonSelections,
  type HospitalityAddonInput,
  type HospitalityAddonSelectionInput,
} from './hospitality-addon-domain.ts';
import { addMoneyMinor, PricingValidationError } from './money.ts';
import { normalizePricingPagination } from './pricing-boundary.ts';

export class HospitalityAddonUnavailableError extends Error {
  constructor(message = 'Add-on configuration is not available for this pricing scope.') {
    super(message);
    this.name = 'HospitalityAddonUnavailableError';
  }
}

export class HospitalityAddonConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityAddonConflictError';
  }
}

const DAY_MS = 86_400_000;

export async function listHospitalityAddons(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });
  const pagination = normalizePricingPagination(input.page, input.pageSize);
  const where = { organizationId: input.organizationId, propertyId: input.propertyId };
  const total = await db.hospitalityAddon.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const addons = await db.hospitalityAddon.findMany({
    where,
    orderBy: [{ status: 'asc' }, { name: 'asc' }, { startDate: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * pagination.pageSize,
    take: pagination.pageSize,
    include: { roomType: { select: { name: true, code: true } }, ratePlan: { select: { name: true, code: true } } },
  });
  return { addons, total, page, totalPages };
}

export async function createHospitalityAddon(input: {
  organizationId: string;
  actorUserId: string;
  addon: HospitalityAddonInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:manage' });
  const propertyId = input.addon.propertyId.trim();
  assertUuidIdentifier(propertyId, 'propertyId');

  return db.$transaction(async (transaction) => {
    const organization = await transaction.organization.findFirst({
      where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { currency: true },
    });
    if (!organization) throw new HospitalityAddonUnavailableError('Active organization is required for add-on pricing.');
    const addon = normalizeHospitalityAddonInput(input.addon, organization.currency);
    if (addon.roomTypeId) assertUuidIdentifier(addon.roomTypeId, 'roomTypeId');
    if (addon.ratePlanId) assertUuidIdentifier(addon.ratePlanId, 'ratePlanId');
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pricing-addon:${input.organizationId}:${addon.propertyId}:${addon.code}`}, 0))`;

    const [property, assignment] = await Promise.all([
      transaction.hospitalityProperty.findFirst({
        where: { id: addon.propertyId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      }),
      addon.roomTypeId && addon.ratePlanId
        ? transaction.hospitalityRoomTypeRatePlan.findFirst({
            where: {
              organizationId: input.organizationId,
              propertyId: addon.propertyId,
              roomTypeId: addon.roomTypeId,
              ratePlanId: addon.ratePlanId,
              roomType: { is: { status: 'ACTIVE' } },
              ratePlan: { is: { status: 'ACTIVE' } },
            },
            select: { roomTypeId: true },
          })
        : Promise.resolve({ roomTypeId: null }),
    ]);
    if (!property || !assignment) throw new HospitalityAddonUnavailableError('Active property and selected pricing scope are required for add-ons.');

    const overlapping = await transaction.hospitalityAddon.count({
      where: {
        organizationId: input.organizationId,
        propertyId: addon.propertyId,
        code: addon.code,
        status: 'ACTIVE',
        startDate: { lte: addon.endDate },
        endDate: { gte: addon.startDate },
        OR: addon.roomTypeId && addon.ratePlanId
          ? [{ roomTypeId: null, ratePlanId: null }, { roomTypeId: addon.roomTypeId, ratePlanId: addon.ratePlanId }]
          : undefined,
      },
    });
    if (overlapping > 0) throw new HospitalityAddonConflictError('An active add-on with that code overlaps this date range and applicable scope.');

    const created = await transaction.hospitalityAddon.create({ data: { organizationId: input.organizationId, ...addon } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'pricing.addon.created',
        resourceType: 'hospitality-addon',
        resourceId: created.id,
        afterData: {
          propertyId: created.propertyId,
          roomTypeId: created.roomTypeId,
          ratePlanId: created.ratePlanId,
          code: created.code,
          pricingModel: created.pricingModel,
          amountMinor: created.amountMinor.toString(),
          currency: created.currency,
          maxQuantity: created.maxQuantity,
          startDate: formatAvailabilityDate(created.startDate),
          endDate: formatAvailabilityDate(created.endDate),
        },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveHospitalityAddon(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  addonId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.addonId, 'addonId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:manage' });
  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityAddon.findFirst({
      where: {
        id: input.addonId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        status: 'ACTIVE',
        property: { is: { status: 'ACTIVE' } },
      },
      select: { id: true, status: true },
    });
    if (!current) throw new HospitalityAddonUnavailableError('Active add-on is not available in this organization.');
    const archivedAt = new Date();
    const updated = await transaction.hospitalityAddon.update({
      where: { id: current.id },
      data: { status: 'ARCHIVED', archivedAt },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'pricing.addon.archived',
        resourceType: 'hospitality-addon',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function quoteHospitalityAddons(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: string;
  departureDate: string;
  stayNights: number;
  roomQuantity: number;
  currency: string;
  selections: HospitalityAddonSelectionInput[];
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });

  const arrivalDate = parseAvailabilityDate(input.arrivalDate, 'Arrival date');
  const departureDate = parseAvailabilityDate(input.departureDate, 'Departure date');
  const derivedStayNights = Math.round((departureDate.getTime() - arrivalDate.getTime()) / DAY_MS);
  if (derivedStayNights < 1 || derivedStayNights > 366) throw new PricingValidationError('Stay length must be between 1 and 366 nights for add-on pricing.');
  if (input.stayNights !== derivedStayNights) throw new PricingValidationError('Add-on stay length does not match the requested dates.');
  if (!Number.isSafeInteger(input.roomQuantity) || input.roomQuantity < 1 || input.roomQuantity > 50) throw new PricingValidationError('Room quantity must be between 1 and 50 for add-on pricing.');
  const lastOccupiedDate = new Date(departureDate.getTime() - DAY_MS);

  const selections = normalizeHospitalityAddonSelections(input.selections);
  if (selections.length === 0) return { addons: [], totalAddonsMinor: '0' };

  const records = await db.hospitalityAddon.findMany({
    where: {
      id: { in: selections.map((selection) => selection.addonId) },
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      status: 'ACTIVE',
      startDate: { lte: arrivalDate },
      endDate: { gte: lastOccupiedDate },
      OR: [{ roomTypeId: null, ratePlanId: null }, { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId }],
    },
  });
  if (records.length !== selections.length) throw new HospitalityAddonUnavailableError('One or more selected add-ons are unavailable for the requested stay.');
  const byId = new Map(records.map((record) => [record.id, record]));
  const addons = selections.map((selection) => {
    const record = byId.get(selection.addonId);
    if (!record || record.currency !== input.currency) throw new HospitalityAddonUnavailableError('Selected add-on does not match the requested pricing currency.');
    if (selection.quantity > record.maxQuantity) throw new HospitalityAddonUnavailableError(`Selected quantity for ${record.code} exceeds the configured maximum.`);
    const amountMinor = hospitalityAddonAmountMinor({
      amountMinor: record.amountMinor,
      pricingModel: record.pricingModel,
      selectedQuantity: selection.quantity,
      roomQuantity: input.roomQuantity,
      stayNights: derivedStayNights,
      maxQuantity: record.maxQuantity,
    });
    return {
      id: record.id,
      code: record.code,
      name: record.name,
      pricingModel: record.pricingModel,
      selectedQuantity: selection.quantity,
      amountMinor: amountMinor.toString(),
      currency: input.currency,
    };
  });
  return {
    addons,
    totalAddonsMinor: addMoneyMinor(addons.map((addon) => BigInt(addon.amountMinor))).toString(),
  };
}
