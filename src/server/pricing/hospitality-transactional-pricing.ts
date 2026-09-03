import { createHash } from 'node:crypto';

import { formatAvailabilityDate, normalizeAvailabilityRequest, type AvailabilityRequestInput } from '../availability/availability-domain.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { hospitalityAddonAmountMinor, normalizeHospitalityAddonSelections, type HospitalityAddonSelectionInput } from './hospitality-addon-domain.ts';
import { percentageAmountMinor } from './hospitality-charge-domain.ts';
import { addMoneyMinor, multiplyMoneyMinor } from './money.ts';

const DAY_MS = 86_400_000;

type HospitalityPricingReader = Pick<
  typeof db,
  'organization' | 'hospitalityRoomTypeRatePlan' | 'hospitalityBaseRate' | 'hospitalityChargeRule' | 'hospitalityAddon'
>;

export class HospitalityTransactionalPricingUnavailableError extends Error {
  constructor(message = 'Current pricing is not available for the requested stay.') {
    super(message);
    this.name = 'HospitalityTransactionalPricingUnavailableError';
  }
}

function enumerateOccupiedNights(arrivalDate: Date, departureDate: Date) {
  const nights: Date[] = [];
  for (let time = arrivalDate.getTime(); time < departureDate.getTime(); time += DAY_MS) nights.push(new Date(time));
  return nights;
}

export async function quoteHospitalityPriceFromReader(input: {
  reader: HospitalityPricingReader;
  organizationId: string;
  request: AvailabilityRequestInput;
  addonSelections?: HospitalityAddonSelectionInput[];
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  const request = normalizeAvailabilityRequest(input.request);
  assertUuidIdentifier(request.propertyId, 'propertyId');
  assertUuidIdentifier(request.roomTypeId, 'roomTypeId');
  assertUuidIdentifier(request.ratePlanId, 'ratePlanId');

  const [organization, assignment] = await Promise.all([
    input.reader.organization.findFirst({
      where: { id: input.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { currency: true },
    }),
    input.reader.hospitalityRoomTypeRatePlan.findFirst({
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
  if (!organization || !assignment) {
    throw new HospitalityTransactionalPricingUnavailableError('Active room type and rate plan assignment are required for pricing.');
  }

  const rates = await input.reader.hospitalityBaseRate.findMany({
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
    if (applicable.length !== 1) {
      throw new HospitalityTransactionalPricingUnavailableError(
        applicable.length === 0
          ? `No active base rate covers ${formatAvailabilityDate(date)}.`
          : `Multiple active base rates cover ${formatAvailabilityDate(date)}.`,
      );
    }
    return { date: formatAvailabilityDate(date), amountMinor: applicable[0].amountMinor.toString() };
  });

  const unitSubtotal = addMoneyMinor(nightly.map((night) => BigInt(night.amountMinor)));
  const accommodationSubtotalMinor = multiplyMoneyMinor(unitSubtotal, request.quantity);

  const chargeRules = await input.reader.hospitalityChargeRule.findMany({
    where: {
      organizationId: input.organizationId,
      propertyId: request.propertyId,
      status: 'ACTIVE',
      startDate: { lt: request.departureDate },
      endDate: { gte: request.arrivalDate },
      OR: [{ roomTypeId: null, ratePlanId: null }, { roomTypeId: request.roomTypeId, ratePlanId: request.ratePlanId }],
    },
    orderBy: [{ kind: 'asc' }, { code: 'asc' }, { id: 'asc' }],
  });

  const charges = chargeRules.flatMap((rule) => {
    const start = formatAvailabilityDate(rule.startDate);
    const end = formatAvailabilityDate(rule.endDate);
    const eligibleNights = nightly.filter((night) => night.date >= start && night.date <= end);
    if (eligibleNights.length === 0) return [];

    const eligibleUnitSubtotal = addMoneyMinor(eligibleNights.map((night) => BigInt(night.amountMinor)));
    const eligibleSubtotal = multiplyMoneyMinor(eligibleUnitSubtotal, request.quantity);
    let amountMinor: bigint;
    if (rule.calculation === 'PERCENTAGE') {
      amountMinor = percentageAmountMinor(eligibleSubtotal, rule.percentageBps ?? 0);
    } else if (rule.calculation === 'FIXED_PER_ROOM_NIGHT') {
      if (rule.currency !== organization.currency || rule.amountMinor === null) {
        throw new HospitalityTransactionalPricingUnavailableError(`Charge ${rule.code} does not match the quote currency.`);
      }
      amountMinor = multiplyMoneyMinor(rule.amountMinor, eligibleNights.length * request.quantity);
    } else {
      if (rule.currency !== organization.currency || rule.amountMinor === null) {
        throw new HospitalityTransactionalPricingUnavailableError(`Charge ${rule.code} does not match the quote currency.`);
      }
      amountMinor = rule.amountMinor;
    }

    return [{
      id: rule.id,
      code: rule.code,
      name: rule.name,
      kind: rule.kind,
      calculation: rule.calculation,
      amountMinor: amountMinor.toString(),
    }];
  });

  const taxTotalMinor = addMoneyMinor(charges.filter((charge) => charge.kind === 'TAX').map((charge) => BigInt(charge.amountMinor)));
  const feeTotalMinor = addMoneyMinor(charges.filter((charge) => charge.kind === 'FEE').map((charge) => BigInt(charge.amountMinor)));

  const selections = normalizeHospitalityAddonSelections(input.addonSelections ?? []);
  let addons: Array<{ id: string; code: string; name: string; pricingModel: string; selectedQuantity: number; amountMinor: string }> = [];
  if (selections.length > 0) {
    const lastOccupiedDate = new Date(request.departureDate.getTime() - DAY_MS);
    const records = await input.reader.hospitalityAddon.findMany({
      where: {
        id: { in: selections.map((selection) => selection.addonId) },
        organizationId: input.organizationId,
        propertyId: request.propertyId,
        status: 'ACTIVE',
        startDate: { lte: request.arrivalDate },
        endDate: { gte: lastOccupiedDate },
        OR: [{ roomTypeId: null, ratePlanId: null }, { roomTypeId: request.roomTypeId, ratePlanId: request.ratePlanId }],
      },
    });
    if (records.length !== selections.length) {
      throw new HospitalityTransactionalPricingUnavailableError('One or more selected add-ons are unavailable for the requested stay.');
    }
    const byId = new Map(records.map((record) => [record.id, record]));
    addons = selections.map((selection) => {
      const record = byId.get(selection.addonId);
      if (!record || record.currency !== organization.currency) {
        throw new HospitalityTransactionalPricingUnavailableError('Selected add-on does not match the requested pricing currency.');
      }
      if (selection.quantity > record.maxQuantity) {
        throw new HospitalityTransactionalPricingUnavailableError(`Selected quantity for ${record.code} exceeds the configured maximum.`);
      }
      const amountMinor = hospitalityAddonAmountMinor({
        amountMinor: record.amountMinor,
        pricingModel: record.pricingModel,
        selectedQuantity: selection.quantity,
        roomQuantity: request.quantity,
        stayNights: request.stayNights,
        maxQuantity: record.maxQuantity,
      });
      return {
        id: record.id,
        code: record.code,
        name: record.name,
        pricingModel: record.pricingModel,
        selectedQuantity: selection.quantity,
        amountMinor: amountMinor.toString(),
      };
    });
  }

  const addonTotalMinor = addMoneyMinor(addons.map((addon) => BigInt(addon.amountMinor)));
  const totalMinor = addMoneyMinor([accommodationSubtotalMinor, taxTotalMinor, feeTotalMinor, addonTotalMinor]);
  const fingerprintPayload = {
    currency: organization.currency,
    quantity: request.quantity,
    nightly,
    charges: charges.map((charge) => ({
      id: charge.id,
      code: charge.code,
      kind: charge.kind,
      calculation: charge.calculation,
      amountMinor: charge.amountMinor,
    })),
    addons: addons.map((addon) => ({
      id: addon.id,
      code: addon.code,
      pricingModel: addon.pricingModel,
      selectedQuantity: addon.selectedQuantity,
      amountMinor: addon.amountMinor,
    })),
  };

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
    charges,
    addons,
    accommodationSubtotalMinor: accommodationSubtotalMinor.toString(),
    taxTotalMinor: taxTotalMinor.toString(),
    feeTotalMinor: feeTotalMinor.toString(),
    addonTotalMinor: addonTotalMinor.toString(),
    totalMinor: totalMinor.toString(),
    fingerprint: createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex'),
  };
}
