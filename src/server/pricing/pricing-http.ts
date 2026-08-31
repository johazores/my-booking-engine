import { AvailabilityValidationError } from '../availability/availability-domain.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { HospitalityChargeConflictError, HospitalityChargeUnavailableError } from './hospitality-charge-service.ts';
import { HospitalityPricingConflictError, HospitalityPricingUnavailableError } from './hospitality-pricing-service.ts';
import { PricingValidationError } from './money.ts';

export function pricingFormField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export function pricingErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof HospitalityPricingConflictError || error instanceof HospitalityChargeConflictError) return 'conflict';
  if (error instanceof HospitalityPricingUnavailableError || error instanceof HospitalityChargeUnavailableError) return 'unavailable';
  if (error instanceof PricingValidationError || error instanceof AvailabilityValidationError) return 'validation';
  return 'server';
}
