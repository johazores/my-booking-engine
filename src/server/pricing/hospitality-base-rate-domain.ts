import { parseAvailabilityDate } from '../availability/availability-domain.ts';
import { requirePricingText } from './pricing-boundary.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from './money.ts';

export type HospitalityBaseRateInput = {
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  startDate: string;
  endDate: string;
  amount: string;
};

export function normalizeHospitalityBaseRateInput(input: HospitalityBaseRateInput, currency: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PricingValidationError('Base rate input must be an object.');
  const startDate = parseAvailabilityDate(requirePricingText(input.startDate, 'Start date'), 'Start date');
  const endDate = parseAvailabilityDate(requirePricingText(input.endDate, 'End date'), 'End date');
  if (endDate < startDate) throw new PricingValidationError('End date must be on or after start date.');
  const { amountMinor, currency: normalizedCurrency } = parseMoneyMajorToMinor(requirePricingText(input.amount, 'Base rate amount'), currency);
  if (amountMinor <= 0n) throw new PricingValidationError('Base rate must be greater than zero.');
  return {
    propertyId: requirePricingText(input.propertyId, 'Property ID').trim(),
    roomTypeId: requirePricingText(input.roomTypeId, 'Room type ID').trim(),
    ratePlanId: requirePricingText(input.ratePlanId, 'Rate plan ID').trim(),
    startDate,
    endDate,
    amountMinor,
    currency: normalizedCurrency,
  };
}

export function baseRateWindowsOverlap(input: {
  startDate: Date;
  endDate: Date;
}, existing: {
  startDate: Date;
  endDate: Date;
}) {
  return input.startDate <= existing.endDate && input.endDate >= existing.startDate;
}
