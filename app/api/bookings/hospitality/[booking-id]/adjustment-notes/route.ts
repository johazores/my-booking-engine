import { hospitalityBookingApiError, hospitalityBookingJson, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import {
  HospitalityAdjustmentNoteConflictError,
  HospitalityAdjustmentNotePersistenceError,
  HospitalityAdjustmentNoteUnavailableError,
  HospitalityAdjustmentNoteWriteConflictError,
  issueHospitalityCancellationAdjustmentNote,
} from '@/server/payments/hospitality-adjustment-note-service.ts';

function adjustmentNoteError(error: unknown) {
  if (error instanceof HospitalityAdjustmentNoteConflictError || error instanceof HospitalityAdjustmentNoteWriteConflictError) {
    return hospitalityBookingJson({ error: 'adjustment-note-conflict', message: error.message }, 409);
  }
  if (error instanceof HospitalityAdjustmentNoteUnavailableError) {
    return hospitalityBookingJson({ error: 'adjustment-note-unavailable', message: error.message }, 409);
  }
  if (error instanceof HospitalityAdjustmentNotePersistenceError) {
    return hospitalityBookingJson({ error: 'adjustment-note-evidence-invalid', message: 'Stored adjustment-note evidence failed integrity validation.' }, 500);
  }
  return hospitalityBookingApiError(error);
}

export async function POST(request: Request, { params }: { params: Promise<{ 'booking-id': string }> }) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const bookingId = (await params)['booking-id'];
    const body = await request.json() as { sourceInvoiceDocumentNumber?: unknown; refundTransactionId?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Adjustment-note request must be an object.');
    if (typeof body.sourceInvoiceDocumentNumber !== 'string' || typeof body.refundTransactionId !== 'string') {
      throw new TypeError('sourceInvoiceDocumentNumber and refundTransactionId are required.');
    }

    const issued = await issueHospitalityCancellationAdjustmentNote({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      sourceInvoiceDocumentNumber: body.sourceInvoiceDocumentNumber,
      refundTransactionId: body.refundTransactionId,
    });
    return hospitalityBookingJson({
      documentNumber: issued.documentNumber,
      issuedAt: issued.issuedAt,
      currency: issued.currency,
      decreaseTotalMinor: issued.decreaseTotalMinor,
    });
  } catch (error) {
    return adjustmentNoteError(error);
  }
}
