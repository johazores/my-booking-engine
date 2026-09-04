import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import {
  HospitalityAdjustmentNotePdfValidationError,
  createHospitalityAdjustmentNotePdf,
} from '@/server/payments/hospitality-adjustment-note-pdf-domain.ts';
import {
  PublicIssuedTaxInvoiceAuthorizationError,
  PublicIssuedTaxInvoicePersistenceError,
  listPublicBookingIssuedTaxInvoices,
} from '@/server/payments/public-issued-tax-invoice-service.ts';

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
    if (!/^AU-ADJ-[0-9]{8,}$/.test(documentNumber)) return jsonError('adjustment-note-unavailable', 404);

    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('invalid-request', 400);
    const input = body as { bookingCapability?: unknown };
    if (typeof input.bookingCapability !== 'string') return jsonError('invalid-request', 400);

    const history = await listPublicBookingIssuedTaxInvoices({
      organizationSlug,
      bookingCapability: input.bookingCapability,
    });
    const document = history.adjustmentNotes.items.find((item) => item.documentNumber === documentNumber);
    if (!document) return jsonError('adjustment-note-unavailable', 404);

    const pdf = createHospitalityAdjustmentNotePdf(document);
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
      return jsonError('adjustment-note-unavailable', 404);
    }
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) return jsonError('adjustment-note-evidence-invalid', 500);
    if (error instanceof PublicBookingCapabilityConfigurationError) return jsonError('adjustment-note-unavailable', 503);
    if (error instanceof HospitalityAdjustmentNotePdfValidationError) return jsonError('adjustment-note-pdf-unavailable', 422);
    return jsonError('internal-error', 500);
  }
}
