import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import {
  HospitalityIssuedAdjustmentNoteExportLimitError,
  HospitalityIssuedAdjustmentNotePersistenceError,
  createHospitalityIssuedAdjustmentNoteAccountingExport,
} from '@/server/payments/hospitality-issued-adjustment-note-read-service.ts';

export async function GET(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return context.response;

    const exportResult = await createHospitalityIssuedAdjustmentNoteAccountingExport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
    return new Response(exportResult.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="sf-au-adjustment-notes.csv"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteExportLimitError) {
      return hospitalityBookingJson({ error: 'adjustment-note-export-too-large', message: error.message }, 409);
    }
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) {
      return hospitalityBookingJson({ error: 'adjustment-note-evidence-invalid', message: 'Stored adjustment-note evidence failed integrity validation.' }, 500);
    }
    return hospitalityBookingApiError(error);
  }
}
