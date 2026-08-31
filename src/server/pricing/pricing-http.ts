import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { AvailabilityValidationError } from '../availability/availability-domain.ts';
import { PricingValidationError } from './money.ts';
import { HospitalityPricingConflictError, HospitalityPricingUnavailableError } from './hospitality-pricing-service.ts';

export function pricingFormField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export function pricingErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof HospitalityPricingConflictError) return 'conflict';
  if (error instanceof HospitalityPricingUnavailableError) return 'unavailable';
  if (error instanceof PricingValidationError || error instanceof AvailabilityValidationError) return 'validation';
  return 'server';
}
