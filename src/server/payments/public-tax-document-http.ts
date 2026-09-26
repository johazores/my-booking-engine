export const PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES = 8 * 1024;
export const PUBLIC_TAX_DOCUMENT_CAPABILITY_MAX_CHARACTERS = 4096;

function hasJsonContentType(request: Request) {
  const contentType = request.headers.get('content-type');
  if (!contentType) return false;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function hasAcceptableContentLength(request: Request) {
  const header = request.headers.get('content-length');
  if (header === null) return true;
  if (!/^[0-9]+$/.test(header)) return false;
  const contentLength = Number(header);
  return Number.isSafeInteger(contentLength) && contentLength <= PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES;
}

async function readBoundedRequestText(request: Request) {
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
      if (receivedBytes > PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES) {
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

export async function readPublicTaxDocumentBookingCapability(request: Request) {
  if (!hasJsonContentType(request) || !hasAcceptableContentLength(request)) return null;

  const rawBody = await readBoundedRequestText(request);
  if (rawBody === null) return null;

  try {
    const body: unknown = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const bookingCapability = (body as { bookingCapability?: unknown }).bookingCapability;
    if (
      typeof bookingCapability !== 'string'
      || bookingCapability.length === 0
      || bookingCapability.length > PUBLIC_TAX_DOCUMENT_CAPABILITY_MAX_CHARACTERS
    ) {
      return null;
    }
    return bookingCapability;
  } catch {
    return null;
  }
}
