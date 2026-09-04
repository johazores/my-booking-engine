import {
  hospitalityBookingApiError,
  hospitalityBookingJson,
  requireHospitalityBookingApiContext,
} from '@/server/bookings/hospitality-booking-http.ts';
import {
  issueHospitalityNextCommercialAmendmentAdjustmentNote,
} from '@/server/payments/hospitality-commercial-amendment-adjustment-product-service.ts';
import {
  HospitalityCommercialAmendmentAdjustmentNoteConflictError,
  HospitalityCommercialAmendmentAdjustmentNotePersistenceError,
  HospitalityCommercialAmendmentAdjustmentNoteUnavailableError,
  HospitalityCommercialAmendmentAdjustmentNoteWriteConflictError,
} from '@/server/payments/hospitality-commercial-amendment-adjustment-note-service.ts';

function adjustmentNoteError(error: unknown) {
  if (
    error instanceof HospitalityCommercialAmendmentAdjustmentNoteConflictError
    || error instanceof HospitalityCommercialAmendmentAdjustmentNoteWriteConflictError
  ) {
    return hospitalityBookingJson({ error: 'adjustment-note-conflict', message: error.message }, 409);
  }
  if (error instanceof HospitalityCommercialAmendmentAdjustmentNoteUnavailableError) {
    return hospitalityBookingJson({ error: 'adjustment-note-unavailable', message: error.message }, 409);
  }
  if (error instanceof HospitalityCommercialAmendmentAdjustmentNotePersistenceError) {
    return hospitalityBookingJson({
      error: 'adjustment-note-evidence-invalid',
      message: 'Stored commercial-amendment adjustment evidence failed integrity validation.',
    }, 500);
  }
  return hospitalityBookingApiError(error);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'amendment-id': string }> },
) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return context.response;
    const routeParams = await params;
    const body = await request.json() as { sourceInvoiceDocumentNumber?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new TypeError('Commercial-amendment adjustment-note request must be an object.');
    }
    if (typeof body.sourceInvoiceDocumentNumber !== 'string') {
      throw new TypeError('sourceInvoiceDocumentNumber is required.');
    }

    const issued = await issueHospitalityNextCommercialAmendmentAdjustmentNote({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId: routeParams['booking-id'],
      commercialAmendmentId: routeParams['amendment-id'],
      sourceInvoiceDocumentNumber: body.sourceInvoiceDocumentNumber,
    });
    return hospitalityBookingJson({
      documentNumber: issued.documentNumber,
      issuedAt: issued.issuedAt,
      currency: issued.currency,
      adjustmentType: issued.adjustmentType,
      decreaseTotalMinor: issued.decreaseTotalMinor,
      increaseTotalMinor: issued.increaseTotalMinor,
      sourceAdjustmentOrdinal: issued.sourceAdjustmentOrdinal,
    });
  } catch (error) {
    return adjustmentNoteError(error);
  }
}
