import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import {
  HospitalityIssuedInvoicePersistenceError,
  HospitalityIssuedInvoiceUnavailableError,
  getHospitalityIssuedTaxInvoiceDocument,
} from '@/server/payments/hospitality-issued-invoice-read-service.ts';
import {
  HospitalityTaxInvoicePdfValidationError,
  createHospitalityTaxInvoicePdf,
} from '@/server/payments/hospitality-tax-invoice-pdf-domain.ts';

type RouteContext = { params: Promise<{ 'document-number': string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const apiContext = await requireHospitalityBookingApiContext(request);
    if (apiContext.response) return apiContext.response;

    const { 'document-number': rawDocumentNumber } = await context.params;
    const invoice = await getHospitalityIssuedTaxInvoiceDocument({
      organizationId: apiContext.organizationId,
      actorUserId: apiContext.actorUserId,
      documentNumber: decodeURIComponent(rawDocumentNumber),
    });
    const pdf = createHospitalityTaxInvoicePdf(invoice);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${invoice.documentNumber}.pdf"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-length': pdf.byteLength.toString(),
      },
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceUnavailableError) {
      return hospitalityBookingJson({ error: 'invoice-unavailable' }, 404);
    }
    if (error instanceof HospitalityIssuedInvoicePersistenceError) {
      return hospitalityBookingJson({ error: 'invoice-evidence-invalid', message: 'Stored invoice evidence failed integrity validation.' }, 500);
    }
    if (error instanceof HospitalityTaxInvoicePdfValidationError) {
      return hospitalityBookingJson({ error: 'invoice-pdf-unavailable', message: 'This invoice cannot be represented losslessly by the current PDF renderer.' }, 422);
    }
    return hospitalityBookingApiError(error);
  }
}
