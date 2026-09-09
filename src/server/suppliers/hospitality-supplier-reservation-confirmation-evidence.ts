export const HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE =
  'SUPPLIER_CONFIRMATION_MISSING' as const;

export function requiresSupplierConfirmationForReservationRecovery(lastFailureCode: unknown) {
  return lastFailureCode === HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE;
}
