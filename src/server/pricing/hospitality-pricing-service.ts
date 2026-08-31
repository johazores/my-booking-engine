import { createHash } from 'node:crypto';

import { formatAvailabilityDate, normalizeAvailabilityRequest, type AvailabilityRequestInput } from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeHospitalityBaseRateInput, type HospitalityBaseRateInput } from './hospitality-base-rate-domain.ts';
import { quoteHospitalityCharges } from './hospitality-charge-service.ts';
import { hospitalityPricingScopeLockKey } from './pricing-lock.ts';
import { addMoneyMinor, multiplyMoneyMinor } from './money.ts';

export class HospitalityPricingUnavailableError extends Error {
  constructor(message = 'Pricing is not available for the requested stay.') {
    super(message);
    this.name = 'HospitalityPricingUnavailableError';
  }
}

export class HospitalityPricingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityPricingConflictError';
  }
}

const DAY_MS = 86_400_000;

function enumerateOccupiedNights(arrivalDate: Date, departureDate: Date) {
  const nights: Date[] = [];
  for (let time = arrivalDate.getTime(); time < departureDate.getTime(); time += DAY_MS) nights.push(new Date(time));
  return nights;
}

export async function listHospitalityBaseRates(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  page: number;
  pageSize: number;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(input.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });
  const where = { organizationId: input.organizationId, propertyId: input.propertyId, roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId };
  const total = await db.hospitalityBaseRate.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const baseRates = await db.hospitalityBaseRate.findMany({
    where,
    orderBy: [{ status: 'asc' }, { startDate: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
  });
  return { baseRates, total, page, totalPages };
}

export async function createHospitalityBaseRate(input: {
  organizationId: string;
  actorUserId: string;
  baseRate: HospitalityBaseRateInput;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:manage' });

  const propertyId = input.baseRate.propertyId.trim();
  const roomTypeId = input.baseRate.roomTypeId.trim();
  const ratePlanId = input.baseRate.ratePlanId.trim();
  assertUuidIdentifier(propertyId, 'propertyId');
  assertUuidIdentifier(roomTypeId, 'roomTypeId');
  assertUuidIdentifier(ratePlanId, 'ratePlanId');

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hospitalityPricingScopeLockKey({ organizationId: input.organizationId, propertyId, roomTypeId, ratePlanId })}, 0))`;
    const [organization, assignment] = await Promise.all([
      transaction.organization.findFirst({ where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null }, select: { currency: true } }),
      transaction.hospitalityRoomTypeRatePlan.findFirst({
        where: {
          organizationId: input.organizationId,
          propertyId,
          roomTypeId,
          ratePlanId,
          roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
          ratePlan: { is: { status: 'ACTIVE' } },
        },
        select: { roomTypeId: true },
      }),
    ]);
    if (!organization || !assignment) throw new HospitalityPricingUnavailableError('Active room type and rate plan assignment are required for pricing.');
    const rate = normalizeHospitalityBaseRateInput(input.baseRate, organization.currency);
    const overlapping = await transaction.hospitalityBaseRate.count({
      where: {
        organizationId: input.organizationId,
        propertyId: rate.propertyId,
        roomTypeId: rate.roomTypeId,
        ratePlanId: rate.ratePlanId,
        status: 'ACTIVE',
        startDate: { lte: rate.endDate },
        endDate: { gte: rate.startDate },
      },
    });
    if (overlapping > 0) throw new HospitalityPricingConflictError('Active base-rate date windows cannot overlap for the same room type and rate plan.');

    const created = await transaction.hospitalityBaseRate.create({ data: { organizationId: input.organizationId, ...rate } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'pricing.base-rate.created',
        resourceType: 'hospitality-base-rate',
        resourceId: created.id,
        afterData: {
          propertyId: created.propertyId,
          roomTypeId: created.roomTypeId,
          ratePlanId: created.ratePlanId,
          startDate: formatAvailabilityDate(created.startDate),
          endDate: formatAvailabilityDate(created.endDate),
          amountMinor: created.amountMinor.toString(),
          currency: created.currency,
        },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveHospitalityBaseRate(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  baseRateId: string;
}) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.baseRateId, 'baseRateId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:manage' });
  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityBaseRate.findFirst({
      where: { id: input.baseRateId, propertyId: input.propertyId, organizationId: input.organizationId, status: 'ACTIVE' },
      select: { id: true, status: true },
    });
    if (!current) throw new HospitalityPricingUnavailableError('Active base rate is not available in this organization.');
    const archivedAt = new Date();
    const updated = await transaction.hospitalityBaseRate.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'pricing.base-rate.archived',
        resourceType: 'hospitality-base-rate',
        resourceId: current.id,
        beforeData: { status: current.status },
        afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() },
      },
    });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function quoteHospitalityBasePrice(input: {
  organizationId: string;
  actorUserId: string;
  request: AvailabilityRequestInput;
}) {
  const request = normalizeAvailabilityRequest(input.request);
  assertUuidIdentifier(request.propertyId, 'propertyId');
  assertUuidIdentifier(request.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(request.ratePlanId, 'ratePlanId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });

  const [organization, assignment] = await Promise.all([
    db.organization.findFirst({ where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null }, select: { currency: true } }),
    db.hospitalityRoomTypeRatePlan.findFirst({
      where: {
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        roomTypeId: request.roomTypeId,
        ratePlanId: request.ratePlanId,
        roomType: { is: { status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } } },
        ratePlan: { is: { status: 'ACTIVE' } },
      },
      select: { roomTypeId: true },
    }),
  ]);
  if (!organization || !assignment) throw new HospitalityPricingUnavailableError('Active room type and rate plan assignment are required for pricing.');

  const rates = await db.hospitalityBaseRate.findMany({
    where: {
      organizationId: input.organizationId,
      propertyId: request.propertyId,
      roomTypeId: request.roomTypeId,
      ratePlanId: request.ratePlanId,
      status: 'ACTIVE',
      startDate: { lt: request.departureDate },
      endDate: { gte: request.arrivalDate },
      currency: organization.currency,
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  });

  const nightly = enumerateOccupiedNights(request.arrivalDate, request.departureDate).map((date) => {
    const applicable = rates.filter((rate) => rate.startDate <= date && rate.endDate >= date);
    if (applicable.length !== 1) throw new HospitalityPricingUnavailableError(applicable.length === 0 ? `No active base rate covers ${formatAvailabilityDate(date)}.` : `Multiple active base rates cover ${formatAvailabilityDate(date)}.`);
    return { date: formatAvailabilityDate(date), amountMinor: applicable[0].amountMinor.toString() };
  });
  const unitSubtotal = addMoneyMinor(nightly.map((night) => BigInt(night.amountMinor)));
  const totalMinor = multiplyMoneyMinor(unitSubtotal, request.quantity);
  const fingerprintPayload = { currency: organization.currency, quantity: request.quantity, nightly };
  const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex');

  return {
    propertyId: request.propertyId,
    roomTypeId: request.roomTypeId,
    ratePlanId: request.ratePlanId,
    arrivalDate: formatAvailabilityDate(request.arrivalDate),
    departureDate: formatAvailabilityDate(request.departureDate),
    stayNights: request.stayNights,
    quantity: request.quantity,
    currency: organization.currency,
    nightly,
    accommodationSubtotal: { amountMinor: totalMinor.toString(), currency: organization.currency },
    fingerprint,
  };
}

export async function quoteHospitalityPrice(input: {
  organizationId: string;
  actorUserId: string;
  request: AvailabilityRequestInput;
}) {
  const base = await quoteHospitalityBasePrice(input);
  const adjustments = await quoteHospitalityCharges({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    propertyId: base.propertyId,
    roomTypeId: base.roomTypeId,
    ratePlanId: base.ratePlanId,
    arrivalDate: base.arrivalDate,
    departureDate: base.departureDate,
    quantity: base.quantity,
    currency: base.currency,
    nightly: base.nightly,
  });
  const totalMinor = addMoneyMinor([BigInt(base.accommodationSubtotal.amountMinor), BigInt(adjustments.totalChargesMinor)]);
  const fingerprintPayload = {
    currency: base.currency,
    quantity: base.quantity,
    nightly: base.nightly,
    charges: adjustments.charges.map((charge) => ({ id: charge.id, code: charge.code, kind: charge.kind, calculation: charge.calculation, amountMinor: charge.amountMinor })),
  };
  return {
    ...base,
    taxes: { amountMinor: adjustments.taxTotalMinor, currency: base.currency },
    fees: { amountMinor: adjustments.feeTotalMinor, currency: base.currency },
    charges: adjustments.charges,
    total: { amountMinor: totalMinor.toString(), currency: base.currency },
    fingerprint: createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex'),
  };
}

export async function revalidateHospitalityBasePrice(input: {
  organizationId: string;
  actorUserId: string;
  request: AvailabilityRequestInput;
  expectedFingerprint: string;
}) {
  const latest = await quoteHospitalityBasePrice({ organizationId: input.organizationId, actorUserId: input.actorUserId, request: input.request });
  return { changed: latest.fingerprint !== input.expectedFingerprint.trim().toLowerCase(), latest };
}

export async function revalidateHospitalityPrice(input: {
  organizationId: string;
  actorUserId: string;
  request: AvailabilityRequestInput;
  expectedFingerprint: string;
}) {
  const latest = await quoteHospitalityPrice({ organizationId: input.organizationId, actorUserId: input.actorUserId, request: input.request });
  return { changed: latest.fingerprint !== input.expectedFingerprint.trim().toLowerCase(), latest };
}
