import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

/**
 * Preserve an already-normalized supplier failure thrown by a shared transport boundary while
 * still making the caller-owned timeout authoritative. Unknown transport failures stay bounded to
 * provider unavailability instead of leaking implementation-specific errors through supplier APIs.
 */
export function throwHospitalitySupplierTransportFailure(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) {
    throw new HospitalitySupplierProviderError('TIMEOUT');
  }
  if (error instanceof HospitalitySupplierProviderError) {
    throw error;
  }
  throw new HospitalitySupplierProviderError('PROVIDER_UNAVAILABLE');
}
