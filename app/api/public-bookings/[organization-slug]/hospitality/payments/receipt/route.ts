import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite, readPublicBookingJsonObject } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import {
  getPublicBookingPaymentReceipt,
  PublicPaymentReceiptAuthorizationError,
} from '@/server/payments/public-payment-receipt-service.ts';
import { PaymentConflictError, PaymentUnavailableError } from '@/server/payments/payment-service.ts';

const noStoreHeaders = { 'cache-control': 'no-store' };
const PUBLIC_PAYMENT_RECEIPT_REQUEST_MAX_BYTES = 8 * 1024;
const PUBLIC_PAYMENT_RECEIPT_CAPABILITY_MAX_CHARACTERS = 4096;
type RouteContext = { params: Promise<{ 'organization-slug': string }> };

function errorResponse(error: unknown) {
  if (
    error instanceof PublicHospitalityBookingUnavailableError
    || error instanceof PublicPaymentReceiptAuthorizationError
    || error instanceof PaymentUnavailableError
  ) {
    return Response.json({ error: 'receipt-unavailable' }, { status: 404, headers: noStoreHeaders });
  }
  if (error instanceof PaymentConflictError) {
    return Response.json({ error: 'receipt-not-ready' }, { status: 409, headers: noStoreHeaders });
  }
  if (error instanceof PublicBookingCapabilityConfigurationError) {
    return Response.json({ error: 'receipt-unavailable' }, { status: 503, headers: noStoreHeaders });
  }
  return Response.json({ error: 'internal-error' }, { status: 500, headers: noStoreHeaders });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginPublicBookingWrite(request)) {
      return Response.json({ error: 'invalid-origin' }, { status: 403, headers: noStoreHeaders });
    }

    const { 'organization-slug': organizationSlug } = await context.params;
    const body = await readPublicBookingJsonObject(request, PUBLIC_PAYMENT_RECEIPT_REQUEST_MAX_BYTES);
    if (!body) {
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders });
    }
    const input = body as { bookingCapability?: unknown };
    if (
      typeof input.bookingCapability !== 'string'
      || input.bookingCapability.length === 0
      || input.bookingCapability.length > PUBLIC_PAYMENT_RECEIPT_CAPABILITY_MAX_CHARACTERS
    ) {
      return Response.json({ error: 'invalid-request' }, { status: 400, headers: noStoreHeaders });
    }

    const receipt = await getPublicBookingPaymentReceipt({ organizationSlug, bookingCapability: input.bookingCapability });
    return Response.json(receipt, { status: 200, headers: noStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
