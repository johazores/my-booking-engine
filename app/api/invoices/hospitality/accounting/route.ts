import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import {
  HospitalityIssuedInvoiceExportLimitError,
  HospitalityIssuedInvoicePersistenceError,
  createHospitalityIssuedTaxInvoiceAccountingExport,
} from '@/server/payments/hospitality-issued-invoice-read-service.ts';

export async function GET(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return context.response;

    const exportResult = await createHospitalityIssuedTaxInvoiceAccountingExport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
    return new Response(exportResult.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="sf-au-tax-invoices.csv"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceExportLimitError) {
      return hospitalityBookingJson({ error: 'invoice-export-too-large', message: error.message }, 409);
    }
    if (error instanceof HospitalityIssuedInvoicePersistenceError) {
      return hospitalityBookingJson({ error: 'invoice-evidence-invalid', message: 'Stored invoice evidence failed integrity validation.' }, 500);
    }
    return hospitalityBookingApiError(error);
  }
}
