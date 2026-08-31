import { formatAvailabilityDate } from '../availability/availability-domain.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { normalizeHospitalityChargeRuleInput, percentageAmountMinor, type HospitalityChargeRuleInput } from './hospitality-charge-domain.ts';
import { addMoneyMinor, multiplyMoneyMinor } from './money.ts';

export class HospitalityChargeUnavailableError extends Error {
  constructor(message = 'Tax or fee configuration is not available for this pricing scope.') {
    super(message);
    this.name = 'HospitalityChargeUnavailableError';
  }
}

export class HospitalityChargeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityChargeConflictError';
  }
}

export async function listHospitalityChargeRules(input: { organizationId: string; actorUserId: string; propertyId: string; page: number; pageSize: number }) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });
  const where = { organizationId: input.organizationId, propertyId: input.propertyId };
  const total = await db.hospitalityChargeRule.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(Math.max(1, input.page), totalPages);
  const rules = await db.hospitalityChargeRule.findMany({
    where,
    orderBy: [{ status: 'asc' }, { kind: 'asc' }, { name: 'asc' }, { startDate: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * input.pageSize,
    take: input.pageSize,
    include: { roomType: { select: { name: true, code: true } }, ratePlan: { select: { name: true, code: true } } },
  });
  return { rules, total, page, totalPages };
}

export async function createHospitalityChargeRule(input: { organizationId: string; actorUserId: string; rule: HospitalityChargeRuleInput }) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:manage' });
  const propertyId = input.rule.propertyId.trim();
  assertUuidIdentifier(propertyId, 'propertyId');

  return db.$transaction(async (transaction) => {
    const organization = await transaction.organization.findFirst({ where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null }, select: { currency: true } });
    if (!organization) throw new HospitalityChargeUnavailableError('Active organization is required for pricing.');
    const rule = normalizeHospitalityChargeRuleInput(input.rule, organization.currency);
    if (rule.roomTypeId) assertUuidIdentifier(rule.roomTypeId, 'roomTypeId');
    if (rule.ratePlanId) assertUuidIdentifier(rule.ratePlanId, 'ratePlanId');
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pricing-charge:${input.organizationId}:${rule.propertyId}:${rule.code}`}, 0))`;

    const [property, assignment] = await Promise.all([
      transaction.hospitalityProperty.findFirst({ where: { id: rule.propertyId, organizationId: input.organizationId, status: 'ACTIVE' }, select: { id: true } }),
      rule.roomTypeId && rule.ratePlanId ? transaction.hospitalityRoomTypeRatePlan.findFirst({
        where: {
          organizationId: input.organizationId,
          propertyId: rule.propertyId,
          roomTypeId: rule.roomTypeId,
          ratePlanId: rule.ratePlanId,
          roomType: { is: { status: 'ACTIVE' } },
          ratePlan: { is: { status: 'ACTIVE' } },
        },
        select: { roomTypeId: true },
      }) : Promise.resolve({ roomTypeId: null }),
    ]);
    if (!property || !assignment) throw new HospitalityChargeUnavailableError('Active property and selected pricing scope are required for charges.');

    const overlapping = await transaction.hospitalityChargeRule.count({
      where: {
        organizationId: input.organizationId,
        propertyId: rule.propertyId,
        code: rule.code,
        status: 'ACTIVE',
        startDate: { lte: rule.endDate },
        endDate: { gte: rule.startDate },
        OR: rule.roomTypeId && rule.ratePlanId
          ? [{ roomTypeId: null, ratePlanId: null }, { roomTypeId: rule.roomTypeId, ratePlanId: rule.ratePlanId }]
          : undefined,
      },
    });
    if (overlapping > 0) throw new HospitalityChargeConflictError('An active charge with that code overlaps this date range and applicable scope.');

    const created = await transaction.hospitalityChargeRule.create({ data: { organizationId: input.organizationId, ...rule } });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'pricing.charge.created',
        resourceType: 'hospitality-charge-rule',
        resourceId: created.id,
        afterData: {
          propertyId: created.propertyId,
          roomTypeId: created.roomTypeId,
          ratePlanId: created.ratePlanId,
          code: created.code,
          kind: created.kind,
          calculation: created.calculation,
          percentageBps: created.percentageBps,
          amountMinor: created.amountMinor?.toString() ?? null,
          currency: created.currency,
          startDate: formatAvailabilityDate(created.startDate),
          endDate: formatAvailabilityDate(created.endDate),
        },
      },
    });
    return created;
  }, { isolationLevel: 'Serializable' });
}

export async function archiveHospitalityChargeRule(input: { organizationId: string; actorUserId: string; propertyId: string; chargeRuleId: string }) {
  assertUuidIdentifier(input.propertyId, 'propertyId');
  assertUuidIdentifier(input.chargeRuleId, 'chargeRuleId');
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:manage' });
  return db.$transaction(async (transaction) => {
    const current = await transaction.hospitalityChargeRule.findFirst({
      where: { id: input.chargeRuleId, propertyId: input.propertyId, organizationId: input.organizationId, status: 'ACTIVE', property: { is: { status: 'ACTIVE' } } },
      select: { id: true, status: true },
    });
    if (!current) throw new HospitalityChargeUnavailableError('Active tax or fee rule is not available in this organization.');
    const archivedAt = new Date();
    const updated = await transaction.hospitalityChargeRule.update({ where: { id: current.id }, data: { status: 'ARCHIVED', archivedAt } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'pricing.charge.archived', resourceType: 'hospitality-charge-rule', resourceId: current.id, beforeData: { status: current.status }, afterData: { status: 'ARCHIVED', archivedAt: archivedAt.toISOString() } } });
    return updated;
  }, { isolationLevel: 'Serializable' });
}

export async function quoteHospitalityCharges(input: {
  organizationId: string;
  actorUserId: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  arrivalDate: string;
  departureDate: string;
  quantity: number;
  currency: string;
  nightly: Array<{ date: string; amountMinor: string }>;
}) {
  await requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'pricing:read' });
  const rules = await db.hospitalityChargeRule.findMany({
    where: {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      status: 'ACTIVE',
      startDate: { lt: new Date(`${input.departureDate}T00:00:00.000Z`) },
      endDate: { gte: new Date(`${input.arrivalDate}T00:00:00.000Z`) },
      OR: [{ roomTypeId: null, ratePlanId: null }, { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId }],
    },
    orderBy: [{ kind: 'asc' }, { code: 'asc' }, { id: 'asc' }],
  });

  const charges = rules.flatMap((rule) => {
    const start = formatAvailabilityDate(rule.startDate);
    const end = formatAvailabilityDate(rule.endDate);
    const eligibleNights = input.nightly.filter((night) => night.date >= start && night.date <= end);
    if (eligibleNights.length === 0) return [];
    const eligibleUnitSubtotal = addMoneyMinor(eligibleNights.map((night) => BigInt(night.amountMinor)));
    const eligibleSubtotal = multiplyMoneyMinor(eligibleUnitSubtotal, input.quantity);
    let amountMinor: bigint;
    if (rule.calculation === 'PERCENTAGE') {
      amountMinor = percentageAmountMinor(eligibleSubtotal, rule.percentageBps ?? 0);
    } else if (rule.calculation === 'FIXED_PER_ROOM_NIGHT') {
      if (rule.currency !== input.currency || rule.amountMinor === null) throw new HospitalityChargeUnavailableError(`Charge ${rule.code} does not match the quote currency.`);
      amountMinor = multiplyMoneyMinor(rule.amountMinor, eligibleNights.length * input.quantity);
    } else {
      if (rule.currency !== input.currency || rule.amountMinor === null) throw new HospitalityChargeUnavailableError(`Charge ${rule.code} does not match the quote currency.`);
      amountMinor = rule.amountMinor;
    }
    return [{ id: rule.id, code: rule.code, name: rule.name, kind: rule.kind, calculation: rule.calculation, amountMinor: amountMinor.toString(), currency: input.currency }];
  });
  const taxTotal = addMoneyMinor(charges.filter((charge) => charge.kind === 'TAX').map((charge) => BigInt(charge.amountMinor)));
  const feeTotal = addMoneyMinor(charges.filter((charge) => charge.kind === 'FEE').map((charge) => BigInt(charge.amountMinor)));
  return { charges, taxTotalMinor: taxTotal.toString(), feeTotalMinor: feeTotal.toString(), totalChargesMinor: addMoneyMinor([taxTotal, feeTotal]).toString() };
}
