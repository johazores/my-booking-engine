export const HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE =
  'SUPPLIER_CONFIRMATION_MISSING' as const;

export const HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE =
  'SUPPLIER_CONFIRMATION_MISMATCH' as const;

export type HospitalitySupplierReservationRecoveryConfirmationStatus = 'FOUND' | 'NOT_FOUND';

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

export function hospitalitySupplierReservationRecoveryConfirmationFailureCode(input: Readonly<{
  status: HospitalitySupplierReservationRecoveryConfirmationStatus;
  lastFailureCode: unknown;
  durableSupplierConfirmationReference: unknown;
  recoveredSupplierConfirmationReference: unknown;
}>) {
  if (input.status === 'NOT_FOUND') {
    if (
      (input.durableSupplierConfirmationReference !== null
        && input.durableSupplierConfirmationReference !== undefined)
      || (input.recoveredSupplierConfirmationReference !== null
        && input.recoveredSupplierConfirmationReference !== undefined)
    ) {
      return HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE;
    }
    return null;
  }

  if (
    !supplierConfirmationMatchesDurableReservation(
      input.durableSupplierConfirmationReference,
      input.recoveredSupplierConfirmationReference,
    )
  ) {
    return HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE;
  }

  if (
    requiresSupplierConfirmationForReservationRecovery(input.lastFailureCode)
    && !input.recoveredSupplierConfirmationReference
  ) {
    return HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE;
  }

  return null;
}
