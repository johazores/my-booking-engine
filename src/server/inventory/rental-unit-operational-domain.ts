import { RentalInventoryValidationError } from './rental-domain.ts';

export type RentalUnitOperationalStatusInput = Readonly<{
  status: string;
  reason?: string;
}>;

export function normalizeRentalUnitOperationalStatusInput(
  input: RentalUnitOperationalStatusInput,
) {
  const status = input.status.trim().toUpperCase();
  if (status !== 'AVAILABLE' && status !== 'OUT_OF_SERVICE') {
    throw new RentalInventoryValidationError('Rental unit operational status is invalid.');
  }

  const suppliedReason = input.reason?.trim() ?? '';
  if (suppliedReason.length > 500) {
    throw new RentalInventoryValidationError('Rental unit operational reason is too long.');
  }
  if (status === 'OUT_OF_SERVICE' && !suppliedReason) {
    throw new RentalInventoryValidationError(
      'A reason is required when taking a rental unit out of service.',
    );
  }

  return Object.freeze({
    status,
    reason: status === 'OUT_OF_SERVICE' ? suppliedReason : null,
  });
}
