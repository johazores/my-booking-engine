import { isExactHospitalitySupplierMachineToken } from './hospitality-supplier-machine-token.ts';

export const HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE =
  'SUPPLIER_CONFIRMATION_MISSING' as const;

export const HOSPITALITY_SUPPLIER_CONFIRMATION_MISMATCH_FAILURE_CODE =
  'SUPPLIER_CONFIRMATION_MISMATCH' as const;

export type HospitalitySupplierReservationRecoveryConfirmationStatus = 'FOUND' | 'NOT_FOUND';

const MAX_SUPPLIER_CONFIRMATION_REFERENCE_LENGTH = 512;

export function requiresSupplierConfirmationForReservationRecovery(lastFailureCode: unknown) {
  return lastFailureCode === HOSPITALITY_SUPPLIER_CONFIRMATION_MISSING_FAILURE_CODE;
}

export function supplierConfirmationMatchesDurableReservation(
  durableSupplierConfirmationReference: unknown,
  recoveredSupplierConfirmationReference: unknown,
) {
  if (
    recoveredSupplierConfirmationReference !== null
    && recoveredSupplierConfirmationReference !== undefined
    && !isExactHospitalitySupplierMachineToken(
      recoveredSupplierConfirmationReference,
      MAX_SUPPLIER_CONFIRMATION_REFERENCE_LENGTH,
    )
  ) {
    return false;
  }
  if (durableSupplierConfirmationReference === null || durableSupplierConfirmationReference === undefined) {
    return true;
  }
  if (!isExactHospitalitySupplierMachineToken(
    durableSupplierConfirmationReference,
    MAX_SUPPLIER_CONFIRMATION_REFERENCE_LENGTH,
  )) {
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
