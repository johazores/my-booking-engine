import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import {
  HospitalityAdjustmentNoteConflictError,
  HospitalityAdjustmentNotePersistenceError,
  HospitalityAdjustmentNoteUnavailableError,
  HospitalityAdjustmentNoteWriteConflictError,
} from '@/server/payments/hospitality-adjustment-note-service.ts';
import {
  HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError,
  HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError,
  HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError,
  HospitalityCancellationAfterAmendmentAdjustmentNoteWriteConflictError,
} from '@/server/payments/hospitality-cancellation-after-amendment-adjustment-note-service.ts';
import {
  issueHospitalityCancellationAdjustmentNoteForSource,
} from '@/server/payments/hospitality-cancellation-adjustment-product-service.ts';

function adjustmentNoteError(error: unknown) {
  if (
    error instanceof HospitalityAdjustmentNoteConflictError
    || error instanceof HospitalityAdjustmentNoteWriteConflictError
    || error instanceof HospitalityCancellationAfterAmendmentAdjustmentNoteConflictError
    || error instanceof HospitalityCancellationAfterAmendmentAdjustmentNoteWriteConflictError
  ) {
    return hospitalityBookingJson({ error: 'adjustment-note-conflict', message: error.message }, 409);
  }
  if (
    error instanceof HospitalityAdjustmentNoteUnavailableError
    || error instanceof HospitalityCancellationAfterAmendmentAdjustmentNoteUnavailableError
  ) {
    return hospitalityBookingJson({ error: 'adjustment-note-unavailable', message: error.message }, 409);
  }
  if (
    error instanceof HospitalityAdjustmentNotePersistenceError
    || error instanceof HospitalityCancellationAfterAmendmentAdjustmentNotePersistenceError
  ) {
    return hospitalityBookingJson({ error: 'adjustment-note-evidence-invalid', message: 'Stored adjustment-note evidence failed integrity validation.' }, 500);
  }
  return hospitalityBookingApiError(error);
}

export async function POST(request: Request, { params }: { params: Promise<{ 'booking-id': string }> }) {
  const observation = createRequestObservation(request, {
    operation: 'hospitality-cancellation-adjustment-note.issue',
    documentType: 'adjustment-note',
  });
  let organizationId: string | undefined;

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return observation.finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const body = await request.json() as { sourceInvoiceDocumentNumber?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Adjustment-note request must be an object.');
    if (typeof body.sourceInvoiceDocumentNumber !== 'string') {
      throw new TypeError('sourceInvoiceDocumentNumber is required.');
    }

    const issued = await issueHospitalityCancellationAdjustmentNoteForSource({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      sourceInvoiceDocumentNumber: body.sourceInvoiceDocumentNumber,
    });
    return observation.finish(hospitalityBookingJson({
      documentNumber: issued.documentNumber,
      issuedAt: issued.issuedAt,
      currency: issued.currency,
      decreaseTotalMinor: issued.decreaseTotalMinor,
    }), { organizationId });
  } catch (error) {
    return observation.finish(adjustmentNoteError(error), { organizationId });
  }
}
