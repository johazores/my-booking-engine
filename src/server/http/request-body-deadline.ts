/** One deadline for the entire request-body acquisition, independent of chunk count. */
export const REQUEST_BODY_READ_TIMEOUT_MS = 10_000;

export function resolveRequestBodyTimeoutMs(timeoutMs?: number): number | null {
  const value = timeoutMs ?? REQUEST_BODY_READ_TIMEOUT_MS;
  return Number.isInteger(value) && value > 0 && value <= REQUEST_BODY_READ_TIMEOUT_MS ? value : null;
}

/** A stalled read or cancellation must never keep a public mutation open. */
export function readRequestBodyChunkBeforeDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  requestSignal: AbortSignal,
  deadlineSignal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  const cancel = () => {
    try { void reader.cancel().catch(() => undefined); } catch { /* Already closed. */ }
  };
  if (requestSignal.aborted || deadlineSignal.aborted) {
    cancel();
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      requestSignal.removeEventListener('abort', onAbort);
      deadlineSignal.removeEventListener('abort', onAbort);
    };
    const finish = (result: ReadableStreamReadResult<Uint8Array> | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onAbort = () => {
      cancel();
      finish(null);
    };
    requestSignal.addEventListener('abort', onAbort, { once: true });
    deadlineSignal.addEventListener('abort', onAbort, { once: true });
    if (requestSignal.aborted || deadlineSignal.aborted) {
      onAbort();
      return;
    }
    try {
      reader.read().then(finish, () => finish(null));
    } catch {
      finish(null);
    }
  });
}
