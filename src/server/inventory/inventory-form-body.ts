/** Bounded text-only browser form reader for authenticated inventory mutations. */
export const INVENTORY_FORM_REQUEST_MAX_BYTES = 64 * 1024;
export const INVENTORY_FORM_MAX_FIELDS = 64;

const SUPPORTED_FORM_MEDIA_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
]);

export async function readBoundedInventoryFormData(
  request: Request,
  maxBytes = INVENTORY_FORM_REQUEST_MAX_BYTES,
): Promise<FormData | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;

  const contentType = request.headers.get('content-type');
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !mediaType || !SUPPORTED_FORM_MEDIA_TYPES.has(mediaType)) return null;

  const lengthHeader = request.headers.get('content-length');
  if (lengthHeader !== null) {
    if (!/^[0-9]+$/.test(lengthHeader)) return null;
    const declaredBytes = Number(lengthHeader);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) return null;
  }

  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    try { await reader.cancel(); } catch { /* Stream already failed. */ }
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    // Inventory endpoints accept text metadata, never uploaded binary files.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const form = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: bytes.buffer,
    }).formData();
    const fieldNames = new Set<string>();
    for (const [name, value] of form.entries()) {
      // Inventory mutations use scalar fields. Duplicate keys are ambiguous
      // because formField() reads only the first submitted value.
      if (typeof value !== 'string' || name.length > 100 || fieldNames.has(name)) return null;
      fieldNames.add(name);
      if (fieldNames.size > INVENTORY_FORM_MAX_FIELDS) return null;
    }
    return form;
  } catch {
    return null;
  }
}
