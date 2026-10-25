import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

/**
 * Native AbortSignal authority is checked without trusting a caller-overridden
 * `aborted` property. Reject an already-aborted request before provider I/O.
 * Preserve the original signal so later timeout/cancellation still propagates.
 */
export function assertTravelportStaysAbortSignalReady(signal: AbortSignal | null | undefined): void {
  if (signal == null) return;
  try {
    if (Reflect.get(AbortSignal.prototype, 'aborted', signal) === false) return;
  } catch {
    // Invalid brand, revoked proxy, or hostile signal: never leak its exception.
  }
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', 'Travelport request abort signal is invalid.');
}
