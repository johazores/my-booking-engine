import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
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
  const observation = createRequestObservation(request, {
    operation: 'hospitality-tax-invoice.pdf.download',
    documentType: 'tax-invoice',
  });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const apiContext = await requireHospitalityBookingApiContext(request);
    if (apiContext.response) return finish(apiContext.response);
    organizationId = apiContext.organizationId;

    const { 'document-number': rawDocumentNumber } = await context.params;
    const invoice = await getHospitalityIssuedTaxInvoiceDocument({
      organizationId: apiContext.organizationId,
      actorUserId: apiContext.actorUserId,
      documentNumber: decodeURIComponent(rawDocumentNumber),
    });
    const pdf = createHospitalityTaxInvoicePdf(invoice);
    return finish(new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${invoice.documentNumber}.pdf"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-length': pdf.byteLength.toString(),
      },
    }));
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceUnavailableError) {
      return finish(hospitalityBookingJson({ error: 'invoice-unavailable' }, 404));
    }
    if (error instanceof HospitalityIssuedInvoicePersistenceError) {
      return finish(hospitalityBookingJson({ error: 'invoice-evidence-invalid', message: 'Stored invoice evidence failed integrity validation.' }, 500));
    }
    if (error instanceof HospitalityTaxInvoicePdfValidationError) {
      return finish(hospitalityBookingJson({ error: 'invoice-pdf-unavailable', message: 'This invoice cannot be represented losslessly by the current PDF renderer.' }, 422));
    }
    return finish(hospitalityBookingApiError(error));
  }
}
