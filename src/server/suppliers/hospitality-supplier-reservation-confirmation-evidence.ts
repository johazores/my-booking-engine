export const HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE =
  'SUPPLIER_CONFIRMATION_MISSING' as const;

export const HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE =
  'SUPPLIER_CONFIRMATION_MISMATCH' as const;

export function requiresSupplierConfirmationForReservationRecovery(lastFailureCode: unknown) {
  return lastFailureCode === HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE;
}

export function supplierConfirmationMatchesDurableReservation(
  durableSupplierConfirmationReference: unknown,
  recoveredSupplierConfirmationReference: unknown,
) {
  if (durableSupplierConfirmationReference === null || durableSupplierConfirmationReference === undefined) {
    return true;
  }
  if (
    typeof durableSupplierConfirmationReference !== 'string'
    || !durableSupplierConfirmationReference
    || durableSupplierConfirmationReference.trim() !== durableSupplierConfirmationReference
    || /[\r\n]/.test(durableSupplierConfirmationReference)
  ) {
    return false;
  }
  return recoveredSupplierConfirmationReference === durableSupplierConfirmationReference;
}
