import { readBoundedJsonObject } from '../http/bounded-json-body.ts';
export const PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES = 8 * 1024;
export const PUBLIC_TAX_DOCUMENT_CAPABILITY_MAX_CHARACTERS = 4096;

export async function readPublicTaxDocumentBookingCapability(request: Request) {
  const body = await readBoundedJsonObject(request, PUBLIC_TAX_DOCUMENT_REQUEST_MAX_BYTES);
  if (!body) return null;
  const bookingCapability = body.bookingCapability;
  if (
    typeof bookingCapability !== 'string'
    || bookingCapability.length === 0
    || bookingCapability.length > PUBLIC_TAX_DOCUMENT_CAPABILITY_MAX_CHARACTERS
  ) return null;
  return bookingCapability;
}
