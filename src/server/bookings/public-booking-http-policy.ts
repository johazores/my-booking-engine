import { readBoundedJsonObject } from '../http/bounded-json-body.ts';
export const PUBLIC_BOOKING_REQUEST_MAX_BYTES = 64 * 1024;

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
  return readBoundedJsonObject(request, maxBytes);
}
