import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { HospitalityInventoryValidationError } from './hospitality-domain.ts';
import {
  HospitalityInventoryConflictError,
  HospitalityInventoryDependencyError,
  HospitalityInventoryUnavailableError,
} from './hospitality-service.ts';

export function formField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export function inventoryErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof HospitalityInventoryConflictError) return 'conflict';
  if (error instanceof HospitalityInventoryDependencyError) return 'dependency';
  if (error instanceof HospitalityInventoryUnavailableError) return 'unavailable';
  if (error instanceof HospitalityInventoryValidationError) return 'validation';
  return 'server';
}
