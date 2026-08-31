import { parseAvailabilityDate } from '../availability/availability-domain.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from './money.ts';

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
  if (amountMinor < 0n || !Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new PricingValidationError('Percentage calculation inputs are invalid.');
  return ((amountMinor * BigInt(basisPoints)) + 5_000n) / 10_000n;
}
