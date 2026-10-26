/** Shared fail-closed framing for JSON, forms, and raw signed webhooks. */
export type RequestBodyFraming =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'valid'; length: number }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'too-large' }>;

export function inspectRequestBodyFraming(request: Request, maxBytes: number): RequestBodyFraming {
  const rawLength = request.headers.get('content-length');
  if (rawLength === null) return { kind: 'absent' };
  // Proxy and application readers must not disagree about request boundaries.
  if (request.headers.has('transfer-encoding')) return { kind: 'invalid' };
  // Reject noncanonical and very long decimal strings before Number conversion.
  if (rawLength.length > 16 || !/^(?:0|[1-9][0-9]*)$/.test(rawLength)) return { kind: 'invalid' };
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0) return { kind: 'invalid' };
  if (length > maxBytes) return { kind: 'too-large' };
  return { kind: 'valid', length };
}

/** One deadline for the entire request-body acquisition, independent of chunk count. */
export const REQUEST_BODY_READ_TIMEOUT_MS = 10_000;

export function resolveRequestBodyTimeoutMs(timeoutMs?: number): number | null {
  const value = timeoutMs ?? REQUEST_BODY_READ_TIMEOUT_MS;
  return Number.isInteger(value) && value > 0 && value <= REQUEST_BODY_READ_TIMEOUT_MS ? value : null;
}

/** Drop rejected unread bodies without waiting for a potentially stalled cancellation. */
export function discardUnreadRequestBody(request: Request): void {
  const body = request.body;
  if (!body || body.locked || request.bodyUsed) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Concurrently closed or locked streams cannot delay preflight rejection.
  }
}

/** Best-effort cancellation; a throwing or unsettled cancel cannot block the rejection. */
export function cancelRequestBodyReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // An already closed or invalid reader must not mask the original failure.
  }
}

/** A stalled read or cancellation must never keep a public mutation open. */
export function readRequestBodyChunkBeforeDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  requestSignal: AbortSignal,
  deadlineSignal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  const cancel = () => cancelRequestBodyReader(reader);
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
    const fail = () => {
      if (settled) return;
      // Settle and remove listeners before cancellation, which may itself abort.
      finish(null);
      cancel();
    };
    const onAbort = fail;
    requestSignal.addEventListener('abort', onAbort, { once: true });
    deadlineSignal.addEventListener('abort', onAbort, { once: true });
    if (requestSignal.aborted || deadlineSignal.aborted) {
      onAbort();
      return;
    }
    // A malformed custom/injected reader result must not throw inside a
    // detached Promise callback and leave the mutation waiting for its deadline.
    const accept = (result: ReadableStreamReadResult<Uint8Array>) => {
      if (settled) return;
      try {
        if (!result || typeof result.done !== 'boolean' ||
            (!result.done && !(result.value instanceof Uint8Array))) {
          fail();
          return;
        }
      } catch {
        fail();
        return;
      }
      finish(result);
    };
    try {
      reader.read().then(accept, fail);
    } catch {
      fail();
    }
  });
}
