import { PublicBookingCapabilityConfigurationError } from '@/server/bookings/public-booking-capability.ts';
import { isSameOriginPublicBookingWrite } from '@/server/bookings/public-booking-http-policy.ts';
import { PublicHospitalityBookingUnavailableError } from '@/server/bookings/public-hospitality-search-service.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import {
  HospitalityAdjustmentNotePdfValidationError,
  createHospitalityAdjustmentNotePdf,
} from '@/server/payments/hospitality-adjustment-note-pdf-domain.ts';
import { readPublicTaxDocumentBookingCapability } from '@/server/payments/public-tax-document-http.ts';
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
  const observation = createRequestObservation(request, {
    operation: 'public-booking.adjustment-note.pdf.download',
    documentType: 'adjustment-note',
  });
  const finish = (response: Response) => observation.finish(response);

  try {
    if (!isSameOriginPublicBookingWrite(request)) return finish(jsonError('invalid-origin', 403));

    const { 'organization-slug': organizationSlug, 'document-number': rawDocumentNumber } = await context.params;
    const documentNumber = decodeURIComponent(rawDocumentNumber).trim().toUpperCase();
    if (!/^AU-ADJ-[0-9]{8,}$/.test(documentNumber)) return finish(jsonError('adjustment-note-unavailable', 404));

    const bookingCapability = await readPublicTaxDocumentBookingCapability(request);
    if (bookingCapability === null) return finish(jsonError('invalid-request', 400));

    const history = await listPublicBookingIssuedTaxInvoices({
      organizationSlug,
      bookingCapability,
    });
    const document = history.adjustmentNotes.items.find((item) => item.documentNumber === documentNumber);
    if (!document) return finish(jsonError('adjustment-note-unavailable', 404));

    const pdf = createHospitalityAdjustmentNotePdf(document);
    return finish(new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${documentNumber}.pdf"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-length': pdf.byteLength.toString(),
      },
    }));
  } catch (error) {
    if (error instanceof PublicHospitalityBookingUnavailableError || error instanceof PublicIssuedTaxInvoiceAuthorizationError) {
      return finish(jsonError('adjustment-note-unavailable', 404));
    }
    if (error instanceof PublicIssuedTaxInvoicePersistenceError) return finish(jsonError('adjustment-note-evidence-invalid', 500));
    if (error instanceof PublicBookingCapabilityConfigurationError) return finish(jsonError('adjustment-note-unavailable', 503));
    if (error instanceof HospitalityAdjustmentNotePdfValidationError) return finish(jsonError('adjustment-note-pdf-unavailable', 422));
    return finish(jsonError('internal-error', 500));
  }
}
