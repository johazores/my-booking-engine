export const STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES = 262_144;

type StripeWebhookRequestBodyErrorCode =
  | 'INVALID_CONTENT_LENGTH'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_BODY'
  | 'INVALID_ENCODING'
  | 'BODY_ABORTED';

export class StripeWebhookRequestBodyError extends Error {
  readonly code: StripeWebhookRequestBodyErrorCode;

  constructor(code: StripeWebhookRequestBodyErrorCode, message: string) {
    super(message);
    this.name = 'StripeWebhookRequestBodyError';
    this.code = code;
  }
}

function cancelRequestBody(request: Request): void {
  if (request.body !== null) void request.body.cancel().catch(() => undefined);
}

function payloadTooLarge(request?: Request): never {
  if (request) cancelRequestBody(request);
  throw new StripeWebhookRequestBodyError('PAYLOAD_TOO_LARGE', 'Stripe webhook payload is too large.');
}

function invalidBody(message = 'Stripe webhook request body is invalid.'): never {
  throw new StripeWebhookRequestBodyError('INVALID_BODY', message);
}

function requestAborted(): StripeWebhookRequestBodyError {
  return new StripeWebhookRequestBodyError('BODY_ABORTED', 'Stripe webhook request body was aborted.');
}

function assertDeclaredContentLength(request: Request): void {
  const value = request.headers.get('content-length');
  if (value === null) return;
  if (!/^(?:0|[1-9]\d*)$/.test(value) || value.length > 16) {
    cancelRequestBody(request);
    throw new StripeWebhookRequestBodyError('INVALID_CONTENT_LENGTH', 'Stripe webhook Content-Length is invalid.');
  }
  const declaredLength = Number(value);
  if (!Number.isSafeInteger(declaredLength)) {
    cancelRequestBody(request);
    throw new StripeWebhookRequestBodyError('INVALID_CONTENT_LENGTH', 'Stripe webhook Content-Length is invalid.');
  }
  if (declaredLength > STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES) payloadTooLarge(request);
}

async function readRequestChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) throw requestAborted();

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      void reader.cancel().catch(() => undefined);
      reject(requestAborted());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => settle(resolve, result),
      (error: unknown) => settle(reject, error),
    );
  });
}

/**
 * Reads the Stripe webhook raw body without allowing Request.text() to buffer an
 * unbounded public request before SF can apply its webhook payload limit.
 */
export async function readStripeWebhookRequestBody(request: Request): Promise<string> {
  assertDeclaredContentLength(request);
  if (request.signal.aborted) {
    cancelRequestBody(request);
    throw requestAborted();
  }
  if (request.body === null) return '';

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    invalidBody();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await readRequestChunk(reader, request.signal);
      } catch (error) {
        if (error instanceof StripeWebhookRequestBodyError) throw error;
        invalidBody();
      }
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        await reader.cancel().catch(() => undefined);
        invalidBody();
      }
      totalBytes += result.value.byteLength;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        payloadTooLarge();
      }
      chunks.push(result.value.slice());
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Request lifetime ends here; a failed release cannot weaken the byte limit.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new StripeWebhookRequestBodyError('INVALID_ENCODING', 'Stripe webhook payload must be valid UTF-8.');
  }
}
