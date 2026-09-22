import {
  HospitalitySupplierProviderError,
  inspectHospitalitySupplierProviderFailure,
} from './hospitality-supplier-provider.ts';

/**
 * Preserve already-normalized supplier failure authority thrown by a shared transport boundary
 * while still making the caller-owned timeout authoritative. The thrown error is rematerialized
 * from its canonical code so mutable/custom runtime fields and messages cannot cross the boundary.
 * Unknown or hostile transport failures stay bounded to provider unavailability.
 */
export function throwHospitalitySupplierTransportFailure(error: unknown, signal: AbortSignal): never {
  if (signal.aborted) {
    throw new HospitalitySupplierProviderError('TIMEOUT');
  }
  const providerFailure = inspectHospitalitySupplierProviderFailure(error);
  if (providerFailure) {
    throw new HospitalitySupplierProviderError(providerFailure.code);
  }
  throw new HospitalitySupplierProviderError('PROVIDER_UNAVAILABLE');
}
