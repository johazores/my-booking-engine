import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import {
  HospitalityIssuedInvoiceExportLimitError,
  HospitalityIssuedInvoicePersistenceError,
  createHospitalityIssuedTaxInvoiceAccountingExport,
} from '@/server/payments/hospitality-issued-invoice-read-service.ts';

export async function GET(request: Request) {
  const observation = createRequestObservation(request, {
    operation: 'hospitality-tax-invoice.accounting-export',
    documentType: 'tax-invoice',
  });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;

    const exportResult = await createHospitalityIssuedTaxInvoiceAccountingExport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
    return finish(new Response(exportResult.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="sf-au-tax-invoices.csv"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }));
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceExportLimitError) {
      return finish(hospitalityBookingJson({ error: 'invoice-export-too-large', message: error.message }, 409));
    }
    if (error instanceof HospitalityIssuedInvoicePersistenceError) {
      return finish(hospitalityBookingJson({ error: 'invoice-evidence-invalid', message: 'Stored invoice evidence failed integrity validation.' }, 500));
    }
    return finish(hospitalityBookingApiError(error));
  }
}
