import {
  HospitalitySupplierProviderError,
  type HospitalitySupplierFailureCode,
} from './hospitality-supplier-provider.ts';

export const HOSPITALITY_SUPPLIER_PRE_PROVIDER_EXECUTION_FAILURE_CODE = 'PRE_PROVIDER_EXECUTION_FAILED' as const;

export type HospitalitySupplierPreProviderFailure = Readonly<{
  failureCode: HospitalitySupplierFailureCode | typeof HOSPITALITY_SUPPLIER_PRE_PROVIDER_EXECUTION_FAILURE_CODE;
  retryable: boolean;
}>;

/**
 * Converts a failure that happened before an external supplier request marker into durable retry authority.
 *
 * Only typed provider failures can authorize automatic retry, and only when the provider-neutral
 * error contract explicitly marks that failure retryable. Unexpected application/configuration
 * failures fail closed so an operator cannot loop a broken commercial path indefinitely.
 */
export function classifyHospitalitySupplierPreProviderFailure(error: unknown): HospitalitySupplierPreProviderFailure {
  if (error instanceof HospitalitySupplierProviderError) {
    return Object.freeze({
      failureCode: error.code,
      retryable: error.retryable,
    });
  }

  return Object.freeze({
    failureCode: HOSPITALITY_SUPPLIER_PRE_PROVIDER_EXECUTION_FAILURE_CODE,
    retryable: false,
  });
}
