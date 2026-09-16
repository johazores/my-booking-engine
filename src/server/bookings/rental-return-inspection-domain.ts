import { RentalInventoryValidationError } from '../inventory/rental-domain.ts';

export type RentalReturnInspectionOutcome = 'CLEAR' | 'DAMAGE_REPORTED' | 'UNSAFE';

export type RentalReturnInspectionInput = Readonly<{
  outcome: string;
  notes?: string;
}>;

function normalizeNotes(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (normalized.length > 2000) {
    throw new RentalInventoryValidationError('Return inspection notes are too long.');
  }
  return normalized || null;
}

export function normalizeRentalReturnInspectionInput(input: RentalReturnInspectionInput) {
  const outcome = input.outcome.trim().toUpperCase();
  if (outcome !== 'CLEAR' && outcome !== 'DAMAGE_REPORTED' && outcome !== 'UNSAFE') {
    throw new RentalInventoryValidationError('Return inspection outcome is invalid.');
  }

  const notes = normalizeNotes(input.notes);
  if (outcome !== 'CLEAR' && !notes) {
    throw new RentalInventoryValidationError(
      'Return inspection notes are required when damage or an unsafe condition is reported.',
    );
  }

  return Object.freeze({
    outcome: outcome as RentalReturnInspectionOutcome,
    notes,
  });
}

export function rentalReturnInspectionOperationalReason(
  outcome: Exclude<RentalReturnInspectionOutcome, 'CLEAR'>,
) {
  return outcome === 'DAMAGE_REPORTED'
    ? 'Return inspection: damage reported'
    : 'Return inspection: unsafe condition';
}
