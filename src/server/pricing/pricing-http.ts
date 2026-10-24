import { AvailabilityValidationError } from '../availability/availability-domain.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { HospitalityAddonConflictError, HospitalityAddonUnavailableError } from './hospitality-addon-service.ts';
import { HospitalityChargeConflictError, HospitalityChargeUnavailableError } from './hospitality-charge-service.ts';
import { HospitalityPricingConflictError, HospitalityPricingUnavailableError } from './hospitality-pricing-service.ts';
import { TenantIdentifierValidationError, assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { PricingValidationError } from './money.ts';

export function pricingFormField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/** Never build an error redirect from an untrusted form property identifier. */
export function pricingErrorTarget(propertyId: string, section?: 'charges' | 'addons') {
  try {
    const safePropertyId = assertUuidIdentifier(propertyId.trim(), 'propertyId');
    return `/pricing/${safePropertyId}${section ? `/${section}` : ''}`;
  } catch (error) {
    if (error instanceof TenantIdentifierValidationError) return '/pricing';
    throw error;
  }
}

export function pricingErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof HospitalityPricingConflictError || error instanceof HospitalityChargeConflictError || error instanceof HospitalityAddonConflictError) return 'conflict';
  if (error instanceof HospitalityPricingUnavailableError || error instanceof HospitalityChargeUnavailableError || error instanceof HospitalityAddonUnavailableError) return 'unavailable';
  if (error instanceof PricingValidationError || error instanceof AvailabilityValidationError || error instanceof TenantIdentifierValidationError) return 'validation';
  return 'server';
}
