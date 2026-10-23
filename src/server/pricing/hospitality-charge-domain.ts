import { parseAvailabilityDate } from '../availability/availability-domain.ts';
import { multiplyMoneyMinor, parseMoneyMajorToMinor, PricingValidationError } from './money.ts';

export type HospitalityChargeKind = 'TAX' | 'FEE';
export type HospitalityChargeCalculation = 'PERCENTAGE' | 'FIXED_PER_BOOKING' | 'FIXED_PER_ROOM_NIGHT';

export type HospitalityChargeRuleInput = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  name: string;
  code: string;
  kind: string;
  calculation: string;
  value: string;
  startDate: string;
  endDate: string;
};

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) throw new PricingValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  return normalized;
}

function chargeCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) throw new PricingValidationError('Charge code must use 1-32 letters, numbers, underscores, or hyphens.');
  return normalized;
}

function chargeKind(value: string): HospitalityChargeKind {
  const normalized = value.trim().toUpperCase();
  if (normalized !== 'TAX' && normalized !== 'FEE') throw new PricingValidationError('Charge kind must be tax or fee.');
  return normalized;
}

function chargeCalculation(value: string): HospitalityChargeCalculation {
  const normalized = value.trim().toUpperCase();
  if (!['PERCENTAGE', 'FIXED_PER_BOOKING', 'FIXED_PER_ROOM_NIGHT'].includes(normalized)) throw new PricingValidationError('Charge calculation is not supported.');
  return normalized as HospitalityChargeCalculation;
}

export function parsePercentageToBasisPoints(value: string) {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new PricingValidationError('Percentage must use at most two decimal places.');
  const [whole, fraction = ''] = normalized.split('.');
  const basisPoints = (Number.parseInt(whole, 10) * 100) + Number.parseInt(fraction.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 1 || basisPoints > 10_000) throw new PricingValidationError('Percentage must be greater than 0% and no more than 100%.');
  return basisPoints;
}

export function normalizeHospitalityChargeRuleInput(input: HospitalityChargeRuleInput, currency: string) {
  const roomTypeId = input.roomTypeId.trim() || null;
  const ratePlanId = input.ratePlanId.trim() || null;
  if ((roomTypeId === null) !== (ratePlanId === null)) throw new PricingValidationError('Charge scope must be property-wide or use both a room type and rate plan.');
  const startDate = parseAvailabilityDate(input.startDate, 'Start date');
  const endDate = parseAvailabilityDate(input.endDate, 'End date');
  if (endDate < startDate) throw new PricingValidationError('End date must be on or after start date.');
  const calculation = chargeCalculation(input.calculation);
  let percentageBps: number | null = null;
  let amountMinor: bigint | null = null;
  let fixedCurrency: string | null = null;
  if (calculation === 'PERCENTAGE') {
    percentageBps = parsePercentageToBasisPoints(input.value);
  } else {
    const money = parseMoneyMajorToMinor(input.value, currency);
    if (money.amountMinor <= 0n) throw new PricingValidationError('Fixed charge amount must be greater than zero.');
    amountMinor = money.amountMinor;
    fixedCurrency = money.currency;
  }
  return {
    propertyId: input.propertyId.trim(),
    roomTypeId,
    ratePlanId,
    name: requiredText(input.name, 'Charge name', 120),
    code: chargeCode(input.code),
    kind: chargeKind(input.kind),
    calculation,
    percentageBps,
    amountMinor,
    currency: fixedCurrency,
    startDate,
    endDate,
  };
}

export function percentageAmountMinor(amountMinor: bigint, basisPoints: number) {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new PricingValidationError('Percentage calculation inputs are invalid.');
  const boundedAmount = multiplyMoneyMinor(amountMinor, 1);
  return ((boundedAmount * BigInt(basisPoints)) + 5_000n) / 10_000n;
}

/**
 * Derive a charge from persisted rule evidence. Unknown or inconsistent stored
 * configurations must not silently become fixed booking charges or zero tax.
 */
export function calculateHospitalityChargeAmountMinor(input: {
  kind: string;
  calculation: string;
  percentageBps: number | null;
  amountMinor: bigint | null;
  currency: string | null;
  quoteCurrency: string;
  eligibleUnitSubtotalMinor: bigint;
  eligibleNights: number;
  roomQuantity: number;
}) {
  if (input.kind !== 'TAX' && input.kind !== 'FEE') {
    throw new PricingValidationError('Stored charge kind is not supported.');
  }
  if (!['PERCENTAGE', 'FIXED_PER_BOOKING', 'FIXED_PER_ROOM_NIGHT'].includes(input.calculation)) {
    throw new PricingValidationError('Stored charge calculation is not supported.');
  }
  if (!Number.isSafeInteger(input.eligibleNights) || input.eligibleNights < 1 || input.eligibleNights > 366) {
    throw new PricingValidationError('Charge stay length is outside the supported range.');
  }
  if (!Number.isSafeInteger(input.roomQuantity) || input.roomQuantity < 1 || input.roomQuantity > 50) {
    throw new PricingValidationError('Charge room quantity is outside the supported range.');
  }

  const eligibleSubtotal = multiplyMoneyMinor(input.eligibleUnitSubtotalMinor, input.roomQuantity);
  if (input.calculation === 'PERCENTAGE') {
    if (!Number.isSafeInteger(input.percentageBps) || input.percentageBps === null || input.percentageBps < 1 || input.percentageBps > 10_000 || input.amountMinor !== null || input.currency !== null) {
      throw new PricingValidationError('Stored percentage charge configuration is invalid.');
    }
    return percentageAmountMinor(eligibleSubtotal, input.percentageBps);
  }

  if (input.percentageBps !== null || typeof input.amountMinor !== 'bigint' || input.amountMinor <= 0n || input.currency !== input.quoteCurrency) {
    throw new PricingValidationError('Stored fixed charge configuration is invalid.');
  }
  return multiplyMoneyMinor(input.amountMinor, input.calculation === 'FIXED_PER_ROOM_NIGHT'
    ? input.eligibleNights * input.roomQuantity
    : 1);
}

