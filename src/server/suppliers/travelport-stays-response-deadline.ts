/** Native abort state, never a caller-shadowed `aborted` property. */
export function isTravelportStaysSignalAborted(signal: AbortSignal): boolean {
  return Reflect.get(AbortSignal.prototype, 'aborted', signal) as boolean;
}

export function travelportStaysResponseAbortError(): Error {
  const error = new Error('Travelport provider response was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * An injected Fetch or ReadableStream reader may ignore AbortSignal. Keep the
 * caller-owned deadline authoritative without awaiting a stalled operation.
 * Late Fetch responses can be disposed by the caller without being accepted.
 */
export function awaitTravelportStaysOperation<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | null | undefined,
  onLateResult?: (value: T) => void,
): Promise<T> {
  if (!signal) return Promise.resolve().then(operation);
  if (isTravelportStaysSignalAborted(signal)) return Promise.reject(travelportStaysResponseAbortError());

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const detach = () => AbortSignal.prototype.removeEventListener.call(signal, 'abort', onAbort);
    const discardLate = (value: T) => {
      try {
        onLateResult?.(value);
      } catch {
        // Disposal is best-effort; never replace caller abort authority.
      }
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      detach();
      reject(travelportStaysResponseAbortError());
    };

    AbortSignal.prototype.addEventListener.call(signal, 'abort', onAbort, { once: true });
    if (isTravelportStaysSignalAborted(signal)) {
      onAbort();
      return;
    }
    try {
      Promise.resolve(operation()).then(
        (value) => {
          if (settled) {
            discardLate(value);
            return;
          }
          settled = true;
          detach();
          if (isTravelportStaysSignalAborted(signal)) {
            discardLate(value);
            reject(travelportStaysResponseAbortError());
            return;
          }
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          detach();
          reject(isTravelportStaysSignalAborted(signal) ? travelportStaysResponseAbortError() : error);
        },
      );
    } catch (error) {
      if (settled) return;
      settled = true;
      detach();
      reject(isTravelportStaysSignalAborted(signal) ? travelportStaysResponseAbortError() : error);
    }
  });
}
