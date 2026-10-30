import { readBoundedJsonObject } from '../http/bounded-json-body.ts';
import { isSameOriginRequest } from '../http/same-origin.ts';
export const PUBLIC_BOOKING_REQUEST_MAX_BYTES = 64 * 1024;

export function isSameOriginPublicBookingWrite(request: Request) {
  return isSameOriginRequest(request);
}

export async function readPublicBookingJsonObject(
  request: Request,
  maxBytes = PUBLIC_BOOKING_REQUEST_MAX_BYTES,
): Promise<Record<string, unknown> | null> {
  return readBoundedJsonObject(request, maxBytes);
}
