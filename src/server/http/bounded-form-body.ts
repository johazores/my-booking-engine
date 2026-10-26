import { discardUnreadRequestBody, readRequestBodyChunkBeforeDeadline, resolveRequestBodyTimeoutMs } from './request-body-deadline.ts';

/** Bounded text-only browser form reader for same-origin mutation endpoints. */
export const FORM_REQUEST_MAX_BYTES = 64 * 1024;
export const FORM_MAX_FIELDS = 64;
const FORM_REQUEST_MAX_CHUNKS = 16 * 1024;

const SUPPORTED_FORM_MEDIA_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
]);

function hasValidUrlEncodedComponents(body: string) {
  // The built-in form parser silently replaces invalid percent-encoded UTF-8.
  // Reject corrupted values rather than persisting replacement characters.
  for (const pair of body.split('&')) {
    const equals = pair.indexOf('=');
    const name = equals < 0 ? pair : pair.slice(0, equals);
    const value = equals < 0 ? '' : pair.slice(equals + 1);
    try {
      decodeURIComponent(name.replace(/\+/g, ' '));
      decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      return false;
    }
  }
  return true;
}

export async function readBoundedFormData(
  request: Request,
  maxBytes = FORM_REQUEST_MAX_BYTES,
  options?: Readonly<{ timeoutMs?: number }>,
): Promise<FormData | null> {
  const rejectPreflight = () => {
    discardUnreadRequestBody(request);
    return null;
  };
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return rejectPreflight();
  const timeoutMs = resolveRequestBodyTimeoutMs(options?.timeoutMs);
  if (timeoutMs === null) return rejectPreflight();

  const contentType = request.headers.get('content-type');
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !mediaType || !SUPPORTED_FORM_MEDIA_TYPES.has(mediaType)) return rejectPreflight();

  const lengthHeader = request.headers.get('content-length');
  let declaredBytes: number | null = null;
  if (lengthHeader !== null) {
    if (!/^[0-9]+$/.test(lengthHeader)) return rejectPreflight();
    declaredBytes = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) return rejectPreflight();
  }

  if (!request.body || request.bodyUsed || request.signal.aborted) return rejectPreflight();
  let reader;
  try {
    reader = request.body.getReader();
  } catch {
    // A locked or already consumed body is invalid request input.
    return rejectPreflight();
  }
  const deadline = new AbortController();
  const timeoutHandle = setTimeout(() => deadline.abort(), timeoutMs);
  // Retain immutable bytes, not references to caller-owned mutable stream chunks.
  let buffered = new Uint8Array(0);
  let totalBytes = 0;
  let chunkCount = 0;
  try {
    while (true) {
      const result = await readRequestBodyChunkBeforeDeadline(reader, request.signal, deadline.signal);
      if (!result) return null;
      const { done, value } = result;
      if (done) break;
      chunkCount += 1;
      if (chunkCount > FORM_REQUEST_MAX_CHUNKS) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      if (!(value instanceof Uint8Array)) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      const chunkBytes = Reflect.get(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength', value) as number;
      if (!Number.isSafeInteger(chunkBytes) || chunkBytes > maxBytes - totalBytes || (declaredBytes !== null && chunkBytes > declaredBytes - totalBytes)) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      const nextTotal = totalBytes + chunkBytes;
      if (chunkBytes > 0) {
        if (nextTotal > buffered.byteLength) {
          const capacity = Math.min(maxBytes, Math.max(nextTotal, buffered.byteLength === 0 ? 1024 : buffered.byteLength * 2));
          const grown = new Uint8Array(capacity);
          Uint8Array.prototype.set.call(grown, buffered);
          buffered = grown;
        }
        Uint8Array.prototype.set.call(buffered, value, totalBytes);
      }
      totalBytes = nextTotal;
    }
  } catch {
    try { void reader.cancel().catch(() => undefined); } catch { /* Stream already failed. */ }
    return null;
  } finally {
    clearTimeout(timeoutHandle);
    try { reader.releaseLock(); } catch { /* Aborted readers may retain pending reads. */ }
  }

  if (request.signal.aborted || deadline.signal.aborted) return null;
  if (declaredBytes !== null && totalBytes !== declaredBytes) return null;

  const bytes = Uint8Array.prototype.slice.call(buffered, 0, totalBytes) as Uint8Array;

  try {
    // Mutation endpoints accept text metadata, never uploaded binary files.
    const decodedBody = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (mediaType === 'application/x-www-form-urlencoded' && !hasValidUrlEncodedComponents(decodedBody)) return null;
    const form = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: bytes.buffer,
    }).formData();
    const fieldNames = new Set<string>();
    for (const [name, value] of form.entries()) {
      // Mutation forms use scalar fields. Duplicate keys are ambiguous
      // because formField() reads only the first submitted value.
      if (typeof value !== 'string' || !name || name.length > 100 || name.includes('\0') || value.includes('\0') || fieldNames.has(name)) return null;
      fieldNames.add(name);
      if (fieldNames.size > FORM_MAX_FIELDS) return null;
    }
    return form;
  } catch {
    return null;
  }
}

/** Routes with an existing validation catch use this throwing adapter. */
export class FormBodyValidationError extends Error {
  constructor() {
    super('Invalid form submission');
    this.name = 'FormBodyValidationError';
  }
}

export async function readBoundedFormDataOrThrow(request: Request, maxBytes = FORM_REQUEST_MAX_BYTES) {
  const form = await readBoundedFormData(request, maxBytes);
  if (!form) throw new FormBodyValidationError();
  return form;
}
