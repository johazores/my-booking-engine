/** Transport-only JSON object reader; caller owns authentication and validation. */
export async function readBoundedJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;

  const contentType = request.headers.get('content-type');
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return null;

  const contentLength = request.headers.get('content-length');
  let declaredBytes: number | null = null;
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) return null;
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) return null;
  }

  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let rawBody = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes || (declaredBytes !== null && totalBytes > declaredBytes)) {
        await reader.cancel();
        return null;
      }
      rawBody += decoder.decode(value, { stream: true });
    }
    if (declaredBytes !== null && totalBytes !== declaredBytes) return null;
    rawBody += decoder.decode();
  } catch {
    try { await reader.cancel(); } catch { /* Stream may already be closed. */ }
    return null;
  } finally {
    reader.releaseLock();
  }

  try {
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
