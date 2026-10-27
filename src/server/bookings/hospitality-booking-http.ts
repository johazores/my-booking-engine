import { readBoundedJsonObject } from '../http/bounded-json-body.ts';
import { isSameOriginAuthRequest, readAuthSession } from '../auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '../authorization/authorization-service.ts';
import { AvailabilityHoldValidationError } from '../availability/availability-hold-domain.ts';
import { AvailabilityValidationError } from '../availability/availability-domain.ts';
import { AvailabilityHoldConflictError, AvailabilityHoldUnavailableError } from '../availability/hospitality-availability-hold-service.ts';
import { AvailabilityUnavailableError } from '../availability/hospitality-availability-service.ts';
import { PaymentInputValidationError } from '../payments/payment-provider.ts';
import { StripeCheckoutReturnOriginConfigurationError } from '../payments/stripe-checkout-return-origin.ts';
import { InvoiceIssuerValidationError } from '../payments/invoice-issuer-domain.ts';
import { HospitalityInvoiceRecipientValidationError } from '../payments/hospitality-invoice-recipient-domain.ts';
import { HospitalityInvoicePreparationValidationError } from '../payments/hospitality-invoice-preparation-domain.ts';
import { PricingValidationError } from '../pricing/money.ts';
import { paymentProviderClientErrorFromThrown } from '../payments/payment-provider-client-error.ts';
import { PaymentConflictError, PaymentUnavailableError } from '../payments/payment-service.ts';
import { HospitalityPricingUnavailableError } from '../pricing/hospitality-pricing-service.ts';
import { HospitalityTransactionalPricingUnavailableError } from '../pricing/hospitality-transactional-pricing.ts';
import { TenantIdentifierValidationError } from '../tenancy/tenant-scope.ts';
import { readActiveOrganizationContext } from '../tenancy/tenant-context.ts';
import { BookingDomainValidationError } from './booking-domain.ts';
import { HospitalityBookingRescheduleValidationError } from './booking-reschedule-domain.ts';
import { HospitalityBookingConflictError, HospitalityBookingPriceChangedError, HospitalityBookingUnavailableError } from './hospitality-booking-service.ts';

const HOSPITALITY_BOOKING_NO_STORE_HEADERS = Object.freeze({ 'cache-control': 'no-store' });

export const HOSPITALITY_BOOKING_REQUEST_MAX_BYTES = 64 * 1024;

export class BookingApiPayloadError extends Error {
  constructor() {
    super('Request body must be a bounded JSON object.');
    this.name = 'BookingApiPayloadError';
  }
}

export async function readHospitalityBookingJsonObject(
  request: Request,
  maxBytes = HOSPITALITY_BOOKING_REQUEST_MAX_BYTES,
): Promise<Record<string, unknown>> {
  const body = await readBoundedJsonObject(request, maxBytes);
  if (!body) throw new BookingApiPayloadError();
  return body;
}

export class BookingApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingApiRequestError';
  }
}

export async function requireHospitalityBookingApiContext(request: Request, options?: { write?: boolean }) {
  if (options?.write && !isSameOriginAuthRequest(request)) {
    throw new BookingApiRequestError('Request origin is not allowed.');
  }
  const session = await readAuthSession();
  if (!session) {
    return { response: Response.json({ error: 'authentication-required' }, { status: 401, headers: HOSPITALITY_BOOKING_NO_STORE_HEADERS }) } as const;
  }
  const activeContext = await readActiveOrganizationContext(session.user.id);
  if (!activeContext.organization) {
    return { response: Response.json({ error: 'organization-required' }, { status: 409, headers: HOSPITALITY_BOOKING_NO_STORE_HEADERS }) } as const;
  }
  return { response: null, organizationId: activeContext.organization.id, actorUserId: session.user.id } as const;
}

export function hospitalityBookingJson(value: unknown, status = 200) {
  return new Response(JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Date) return item.toISOString();
    return item;
  }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...HOSPITALITY_BOOKING_NO_STORE_HEADERS },
  });
}

function bookingApiErrorJson(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: HOSPITALITY_BOOKING_NO_STORE_HEADERS });
}

export function hospitalityBookingApiError(error: unknown) {
  if (error instanceof BookingApiRequestError) return bookingApiErrorJson({ error: 'invalid-request', message: error.message }, 403);
  if (error instanceof BookingApiPayloadError) return bookingApiErrorJson({ error: 'invalid-request' }, 400);
  if (error instanceof OrganizationPermissionDeniedError) return bookingApiErrorJson({ error: 'forbidden' }, 403);
  if (error instanceof HospitalityBookingPriceChangedError) return bookingApiErrorJson({ error: 'price-changed', message: error.message }, 409);
  if (error instanceof HospitalityBookingConflictError || error instanceof AvailabilityHoldConflictError || error instanceof PaymentConflictError) {
    return bookingApiErrorJson({ error: 'conflict', message: error.message }, 409);
  }
  if (error instanceof PaymentUnavailableError) return bookingApiErrorJson({ error: 'payment-unavailable', message: error.message }, 404);
  if (error instanceof StripeCheckoutReturnOriginConfigurationError) return bookingApiErrorJson({ error: 'payment-unavailable' }, 503);

  const providerError = paymentProviderClientErrorFromThrown(error);
  if (providerError) {
    return bookingApiErrorJson({
      error: 'provider-error',
      ...providerError,
    }, providerError.retryable ? 503 : 502);
  }

  if (
    error instanceof HospitalityBookingUnavailableError
    || error instanceof AvailabilityHoldUnavailableError
    || error instanceof AvailabilityUnavailableError
    || error instanceof HospitalityPricingUnavailableError
    || error instanceof HospitalityTransactionalPricingUnavailableError
  ) {
    return bookingApiErrorJson({ error: 'unavailable', message: error.message }, 409);
  }
  if (
    error instanceof AvailabilityValidationError
    || error instanceof AvailabilityHoldValidationError
    || error instanceof BookingDomainValidationError
    || error instanceof TenantIdentifierValidationError
    || error instanceof HospitalityBookingRescheduleValidationError
    || error instanceof PricingValidationError
    || error instanceof PaymentInputValidationError
    || error instanceof InvoiceIssuerValidationError
    || error instanceof HospitalityInvoiceRecipientValidationError
    || error instanceof HospitalityInvoicePreparationValidationError
  ) {
    return bookingApiErrorJson({ error: 'validation', message: error.message }, 400);
  }
  return bookingApiErrorJson({ error: 'internal-error' }, 500);
}
