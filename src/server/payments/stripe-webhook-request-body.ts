import { cancelRequestBodyReader, discardUnreadRequestBody, inspectRequestBodyFraming } from '../http/request-body-deadline.ts';

export const STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES = 262_144;
export const STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS = 10_000;
const STRIPE_WEBHOOK_MAX_CHUNKS = 16 * 1024;

type StripeWebhookRequestBodyErrorCode =
  | 'INVALID_CONTENT_LENGTH'
  | 'CONTENT_LENGTH_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_BODY'
  | 'INVALID_ENCODING'
  | 'BODY_ABORTED'
  | 'BODY_TIMEOUT';

export class StripeWebhookRequestBodyError extends Error {
  readonly code: StripeWebhookRequestBodyErrorCode;

  constructor(code: StripeWebhookRequestBodyErrorCode, message: string) {
    super(message);
    this.name = 'StripeWebhookRequestBodyError';
    this.code = code;
  }
}

export function discardStripeWebhookRequestBody(request: Request): void {
  discardUnreadRequestBody(request);
}

function payloadTooLarge(request?: Request): never {
  if (request) discardStripeWebhookRequestBody(request);
  throw new StripeWebhookRequestBodyError('PAYLOAD_TOO_LARGE', 'Stripe webhook payload is too large.');
}

function invalidBody(message = 'Stripe webhook request body is invalid.'): never {
  throw new StripeWebhookRequestBodyError('INVALID_BODY', message);
}

function contentLengthMismatch(): StripeWebhookRequestBodyError {
  return new StripeWebhookRequestBodyError(
    'CONTENT_LENGTH_MISMATCH',
    'Stripe webhook Content-Length does not match the received body.',
  );
}

function requestAborted(): StripeWebhookRequestBodyError {
  return new StripeWebhookRequestBodyError('BODY_ABORTED', 'Stripe webhook request body was aborted.');
}

function bodyTimedOut(): StripeWebhookRequestBodyError {
  return new StripeWebhookRequestBodyError('BODY_TIMEOUT', 'Stripe webhook request body timed out.');
}

function resolveBodyReadTimeoutMs(request: Request, timeoutMs?: number): number {
  if (timeoutMs === undefined) return STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > STRIPE_WEBHOOK_BODY_READ_TIMEOUT_MS) {
    discardStripeWebhookRequestBody(request);
    throw new StripeWebhookRequestBodyError('INVALID_BODY', 'Stripe webhook body timeout is invalid.');
  }
  return timeoutMs;
}

function declaredContentLength(request: Request): number | null {
  const framing = inspectRequestBodyFraming(request, STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES);
  if (framing.kind === 'invalid') {
    discardStripeWebhookRequestBody(request);
    throw new StripeWebhookRequestBodyError('INVALID_CONTENT_LENGTH', 'Stripe webhook Content-Length is invalid.');
  }
  if (framing.kind === 'too-large') payloadTooLarge(request);
  return framing.kind === 'valid' ? framing.length : null;
}

function growBodyBuffer(buffer: Uint8Array, requiredBytes: number): Uint8Array {
  if (buffer.byteLength >= requiredBytes) return buffer;
  let capacity = Math.max(buffer.byteLength, 8_192);
  while (capacity < requiredBytes) {
    capacity = Math.min(STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES, capacity * 2);
  }
  const expanded = new Uint8Array(capacity);
  expanded.set(buffer);
  return expanded;
}

async function readRequestChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  requestSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (requestSignal.aborted) {
    cancelRequestBodyReader(reader);
    throw requestAborted();
  }
  if (timeoutSignal.aborted) {
    cancelRequestBodyReader(reader);
    throw bodyTimedOut();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      requestSignal.removeEventListener('abort', onRequestAbort);
      timeoutSignal.removeEventListener('abort', onTimeout);
    };
    const settle = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onRequestAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      cancelRequestBodyReader(reader);
      reject(requestAborted());
    };
    const onTimeout = () => {
      if (settled) return;
      settled = true;
      cleanup();
      cancelRequestBodyReader(reader);
      reject(bodyTimedOut());
    };

    requestSignal.addEventListener('abort', onRequestAbort, { once: true });
    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
    if (requestSignal.aborted) {
      onRequestAbort();
      return;
    }
    if (timeoutSignal.aborted) {
      onTimeout();
      return;
    }
    try {
      reader.read().then(
        (result) => settle(resolve, result),
        (error: unknown) => settle(reject, error),
      );
    } catch (error) {
      // A synchronous reader failure must release abort listeners before
      // the caller cancels the reader, just like an asynchronous rejection.
      settle(reject, error);
    }
  });
}

/**
 * Reads the Stripe webhook raw body without allowing Request.text() to buffer an
 * unbounded public request before SF can apply its webhook payload limit.
 */
export async function readStripeWebhookRequestBody(
  request: Request,
  options?: Readonly<{ timeoutMs?: number }>,
): Promise<string> {
  const timeoutMs = resolveBodyReadTimeoutMs(request, options?.timeoutMs);
  const expectedBytes = declaredContentLength(request);
  if (request.signal.aborted) {
    discardStripeWebhookRequestBody(request);
    throw requestAborted();
  }
  // A consumed stream can be unlocked and still return an empty final read.
  // Never treat an already-used webhook body as a fresh signed payload.
  if (request.bodyUsed) invalidBody();
  if (request.body === null) {
    if (expectedBytes !== null && expectedBytes !== 0) throw contentLengthMismatch();
    invalidBody();
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    invalidBody();
  }

  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
  // A declared length gets one exact allocation. Without framing, grow
  // geometrically up to the public byte ceiling instead of retaining one copied
  // allocation per incoming stream chunk or eagerly reserving the full ceiling.
  let bytes = new Uint8Array(expectedBytes ?? 8_192);
  let totalBytes = 0;
  let chunkCount = 0;
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await readRequestChunk(reader, request.signal, timeoutController.signal);
      } catch (error) {
        if (error instanceof StripeWebhookRequestBodyError) throw error;
        cancelRequestBodyReader(reader);
        invalidBody();
      }
      if (result.done) break;
      chunkCount += 1;
      if (chunkCount > STRIPE_WEBHOOK_MAX_CHUNKS) {
        cancelRequestBodyReader(reader);
        invalidBody();
      }
      if (!(result.value instanceof Uint8Array)) {
        cancelRequestBodyReader(reader);
        invalidBody();
      }
      // Request stream chunks are untrusted, including shadowed instance length.
      const chunkBytes = Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength', result.value) as number;
      if (!Number.isSafeInteger(chunkBytes)) {
        cancelRequestBodyReader(reader);
        invalidBody();
      }
      const nextTotal = totalBytes + chunkBytes;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES) {
        cancelRequestBodyReader(reader);
        payloadTooLarge();
      }
      if (expectedBytes !== null && nextTotal > expectedBytes) {
        cancelRequestBodyReader(reader);
        throw contentLengthMismatch();
      }
      bytes = growBodyBuffer(bytes, nextTotal);
      Uint8Array.prototype.set.call(bytes, result.value, totalBytes);
      totalBytes = nextTotal;
    }
    // A last-chunk completion must not turn a concurrent disconnect or
    // whole-body deadline into a successfully acquired signed payload.
    if (request.signal.aborted) throw requestAborted();
    if (timeoutController.signal.aborted) throw bodyTimedOut();
    if (expectedBytes !== null && totalBytes !== expectedBytes) throw contentLengthMismatch();
    // Stripe events are JSON objects; an empty body cannot be signed event evidence.
    if (totalBytes === 0) invalidBody();
  } finally {
    clearTimeout(timeoutHandle);
    try {
      reader.releaseLock();
    } catch {
      // Request lifetime ends here; a failed release cannot weaken the byte limit.
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, totalBytes));
  } catch {
    throw new StripeWebhookRequestBodyError('INVALID_ENCODING', 'Stripe webhook payload must be valid UTF-8.');
  }
}
