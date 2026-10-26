import { readRequestBodyChunkBeforeDeadline, resolveRequestBodyTimeoutMs } from './request-body-deadline.ts';

/** Transport-only JSON object reader; caller owns authentication and validation. */
const JSON_REQUEST_MAX_CHUNKS = 16 * 1024;
export async function readBoundedJsonObject(
  request: Request,
  maxBytes: number,
  options?: Readonly<{ timeoutMs?: number }>,
): Promise<Record<string, unknown> | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;
  const timeoutMs = resolveRequestBodyTimeoutMs(options?.timeoutMs);
  if (timeoutMs === null) return null;

  const contentType = request.headers.get('content-type');
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return null;

  const contentLength = request.headers.get('content-length');
  let declaredBytes: number | null = null;
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) return null;
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) return null;
  }

  if (!request.body || request.bodyUsed) return null;
  let reader;
  try {
    reader = request.body.getReader();
  } catch {
    // A locked or already consumed body is invalid request input.
    return null;
  }
  const deadline = new AbortController();
  const timeoutHandle = setTimeout(() => deadline.abort(), timeoutMs);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let chunkCount = 0;
  let rawBody = '';

  try {
    while (true) {
      const result = await readRequestBodyChunkBeforeDeadline(reader, request.signal, deadline.signal);
      if (!result) return null;
      const { done, value } = result;
      if (done) break;
      chunkCount += 1;
      if (chunkCount > JSON_REQUEST_MAX_CHUNKS) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      if (!(value instanceof Uint8Array)) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      const chunkBytes = Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength', value) as number;
      if (!Number.isSafeInteger(chunkBytes) || chunkBytes > maxBytes - totalBytes) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      totalBytes += chunkBytes;
      if (declaredBytes !== null && totalBytes > declaredBytes) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      rawBody += decoder.decode(value, { stream: true });
    }
    if (request.signal.aborted || deadline.signal.aborted) return null;
    if (declaredBytes !== null && totalBytes !== declaredBytes) return null;
    rawBody += decoder.decode();
  } catch {
    try { void reader.cancel().catch(() => undefined); } catch { /* Stream may already be closed. */ }
    return null;
  } finally {
    clearTimeout(timeoutHandle);
    try { reader.releaseLock(); } catch { /* Aborted readers may retain pending reads. */ }
  }

  try {
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
