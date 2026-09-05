import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import {
  HospitalityIssuedAdjustmentNotePersistenceError,
  HospitalityIssuedAdjustmentNoteUnavailableError,
  getHospitalityIssuedAdjustmentNoteDocument,
} from '@/server/payments/hospitality-issued-adjustment-note-read-service.ts';
import {
  HospitalityAdjustmentNotePdfValidationError,
  createHospitalityAdjustmentNotePdf,
} from '@/server/payments/hospitality-adjustment-note-pdf-domain.ts';

type RouteContext = { params: Promise<{ 'document-number': string }> };

export async function GET(request: Request, context: RouteContext) {
  const observation = createRequestObservation(request, {
    operation: 'hospitality-adjustment-note.pdf.download',
    documentType: 'adjustment-note',
  });
  let organizationId: string | undefined;
  const finish = (response: Response) => observation.finish(response, { organizationId });

  try {
    const apiContext = await requireHospitalityBookingApiContext(request);
    if (apiContext.response) return finish(apiContext.response);
    organizationId = apiContext.organizationId;

    const { 'document-number': rawDocumentNumber } = await context.params;
    const document = await getHospitalityIssuedAdjustmentNoteDocument({
      organizationId: apiContext.organizationId,
      actorUserId: apiContext.actorUserId,
      documentNumber: decodeURIComponent(rawDocumentNumber),
    });
    const pdf = createHospitalityAdjustmentNotePdf(document);
    return finish(new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${document.documentNumber}.pdf"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-length': pdf.byteLength.toString(),
      },
    }));
  } catch (error) {
    if (error instanceof HospitalityIssuedAdjustmentNoteUnavailableError) {
      return finish(hospitalityBookingJson({ error: 'adjustment-note-unavailable' }, 404));
    }
    if (error instanceof HospitalityIssuedAdjustmentNotePersistenceError) {
      return finish(hospitalityBookingJson({ error: 'adjustment-note-evidence-invalid', message: 'Stored adjustment-note evidence failed integrity validation.' }, 500));
    }
    if (error instanceof HospitalityAdjustmentNotePdfValidationError) {
      return finish(hospitalityBookingJson({ error: 'adjustment-note-pdf-unavailable', message: 'This adjustment note cannot be represented losslessly by the current PDF renderer.' }, 422));
    }
    return finish(hospitalityBookingApiError(error));
  }
}
