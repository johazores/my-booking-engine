import { HospitalityInventoryValidationError } from './hospitality-domain.ts';

export type HospitalityRatePlanInput = {
  propertyId: string;
  name: string;
  code: string;
  description: string;
};

function normalizedRequiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength) {
    throw new HospitalityInventoryValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function normalizedOptionalText(value: string, label: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new HospitalityInventoryValidationError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

function normalizedRatePlanCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized)) {
    throw new HospitalityInventoryValidationError('Rate plan code must use 1-32 letters, numbers, underscores, or hyphens.');
  }
  return normalized;
}

export function normalizeHospitalityRatePlanInput(input: HospitalityRatePlanInput) {
  return {
    propertyId: input.propertyId.trim(),
    name: normalizedRequiredText(input.name, 'Rate plan name', 120),
    code: normalizedRatePlanCode(input.code),
    description: normalizedOptionalText(input.description, 'Rate plan description', 300),
  };
}
