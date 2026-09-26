export const PUBLIC_BOOKING_REQUEST_MAX_BYTES = 64 * 1024;

function hasJsonContentType(request: Request) {
  const contentType = request.headers.get('content-type');
  if (!contentType) return false;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function hasAcceptableContentLength(request: Request, maxBytes: number) {
  const header = request.headers.get('content-length');
  if (header === null) return true;
  if (!/^[0-9]+$/.test(header)) return false;
  const contentLength = Number(header);
  return Number.isSafeInteger(contentLength) && contentLength <= maxBytes;
}

async function readBoundedRequestText(request: Request, maxBytes: number) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let receivedBytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be errored or closed.
    }
    return null;
  } finally {
    reader.releaseLock();
  }
}

export function isSameOriginPublicBookingWrite(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function readPublicBookingJsonObject(
  request: Request,
  maxBytes = PUBLIC_BOOKING_REQUEST_MAX_BYTES,
): Promise<Record<string, unknown> | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return null;
  if (!hasJsonContentType(request) || !hasAcceptableContentLength(request, maxBytes)) return null;
  const rawBody = await readBoundedRequestText(request, maxBytes);
  if (rawBody === null) return null;
  try {
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
