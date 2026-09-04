import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import {
  PublicIssuedTaxInvoiceAuthorizationError,
  PublicIssuedTaxInvoicePersistenceError,
  listPublicBookingIssuedTaxInvoices,
} from '@/server/payments/public-issued-tax-invoice-service.ts';
import {
  HospitalityTaxInvoicePdfValidationError,
  createHospitalityTaxInvoicePdf,
} from '@/server/payments/hospitality-tax-invoice-pdf-domain.ts';

const noStoreHeaders = { 'cache-control': 'no-store' };
type RouteContext = { params: Promise<{ 'organization-slug': string; 'document-number': string }> };

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: noStoreHeaders });
}

export async function POST(request: Request, context: RouteContext) {
  try {
    if (!isSameOriginPublicBookingWrite(request)) return jsonError('invalid-origin', 403);

    const { 'organization-slug': organizationSlug, 'document-number': rawDocumentNumber } = await context.params;
    const documentNumber = decodeURIComponent(rawDocumentNumber).trim().toUpperCase();
    if (!/^AU-TAX-[0-9]{8,}$/.test(documentNumber)) return jsonError('invoice-unavailable', 404);

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('invalid-request', 400);
    const input = body as { bookingCapability?: unknown };
    if (typeof input.bookingCapability !== 'string') return jsonError('invalid-request', 400);

    const history = await listPublicBookingIssuedTaxInvoices({
      organizationSlug,
      bookingCapability: input.bookingCapability,
    });
    const invoice = history.items.find((item) => item.documentNumber === documentNumber);
    if (!invoice) return jsonError('invoice-unavailable', 404);

    const pdf = createHospitalityTaxInvoicePdf(invoice);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${documentNumber}.pdf"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-length': pdf.byteLength.toString(),
      },
    });
  } catch (error) {
    if (error instanceof PublicHospitalityBookingUnavailableError || error instanceof PublicIssuedTaxInvoiceAuthorizationError) {
      return jsonError('invoice-unavailable', 404);
    }
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) return jsonError('invoice-evidence-invalid', 500);
    if (error instanceof PublicBookingCapabilityConfigurationError) return jsonError('invoice-unavailable', 503);
    if (error instanceof HospitalityTaxInvoicePdfValidationError) return jsonError('invoice-pdf-unavailable', 422);
    return jsonError('internal-error', 500);
  }
}
