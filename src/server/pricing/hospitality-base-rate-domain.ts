import { parseAvailabilityDate } from '../availability/availability-domain.ts';
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
  const startDate = parseAvailabilityDate(input.startDate, 'Start date');
  const endDate = parseAvailabilityDate(input.endDate, 'End date');
  if (endDate < startDate) throw new PricingValidationError('End date must be on or after start date.');
  const { amountMinor, currency: normalizedCurrency } = parseMoneyMajorToMinor(input.amount, currency);
  if (amountMinor <= 0n) throw new PricingValidationError('Base rate must be greater than zero.');
  return {
    propertyId: input.propertyId.trim(),
    roomTypeId: input.roomTypeId.trim(),
    ratePlanId: input.ratePlanId.trim(),
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
