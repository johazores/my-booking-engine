import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import {
  HospitalityIssuedAdjustmentNoteExportLimitError,
  HospitalityIssuedAdjustmentNotePersistenceError,
  createHospitalityIssuedAdjustmentNoteAccountingExport,
} from '@/server/payments/hospitality-issued-adjustment-note-read-service.ts';

export async function GET(request: Request) {
  const observation = createRequestObservation(request, {
    operation: 'hospitality-adjustment-note.accounting-export',
    documentType: 'adjustment-note',
  });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const context = await requireHospitalityBookingApiContext(request);
    if (context.response) return finish(context.response);
    organizationId = context.organizationId;

    const exportResult = await createHospitalityIssuedAdjustmentNoteAccountingExport({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
    return finish(new Response(exportResult.csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="sf-au-adjustment-notes.csv"',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }));
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteExportLimitError) {
      return finish(hospitalityBookingJson({ error: 'adjustment-note-export-too-large', message: error.message }, 409));
    }
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) {
      return finish(hospitalityBookingJson({ error: 'adjustment-note-evidence-invalid', message: 'Stored adjustment-note evidence failed integrity validation.' }, 500));
    }
    return finish(hospitalityBookingApiError(error));
  }
}
