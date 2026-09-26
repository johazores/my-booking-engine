import { hospitalityBookingApiError, hospitalityBookingJson, readHospitalityBookingJsonObject, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation } from '@/server/observability/request-observability.ts';
import {
  HospitalityInvoicePreparationConflictError,
  HospitalityInvoicePreparationPersistenceError,
  HospitalityInvoicePreparationUnavailableError,
  HospitalityInvoicePreparationWriteConflictError,
  prepareHospitalityInvoice,
} from '@/server/payments/hospitality-invoice-preparation-service.ts';
import {
  HospitalityInvoiceIssuanceConflictError,
  HospitalityInvoiceIssuancePersistenceError,
  HospitalityInvoiceIssuanceUnavailableError,
  HospitalityInvoiceIssuanceWriteConflictError,
  issueHospitalityAustralianTaxInvoice,
} from '@/server/payments/hospitality-invoice-issuance-service.ts';
import type { HospitalityInvoiceRecipientInput } from '@/server/payments/hospitality-invoice-recipient-domain.ts';

function invoiceError(error: unknown) {
  if (
    error instanceof HospitalityInvoicePreparationConflictError
    || error instanceof HospitalityInvoicePreparationWriteConflictError
    || error instanceof HospitalityInvoiceIssuanceConflictError
    || error instanceof HospitalityInvoiceIssuanceWriteConflictError
  ) {
    return hospitalityBookingJson({ error: 'invoice-conflict', message: error.message }, 409);
  }
  if (error instanceof HospitalityInvoicePreparationUnavailableError || error instanceof HospitalityInvoiceIssuanceUnavailableError) {
    return hospitalityBookingJson({ error: 'invoice-unavailable', message: error.message }, 409);
  }
  if (error instanceof HospitalityInvoicePreparationPersistenceError || error instanceof HospitalityInvoiceIssuancePersistenceError) {
    return hospitalityBookingJson({ error: 'invoice-evidence-invalid', message: 'Stored invoice evidence failed integrity validation.' }, 500);
  }
  return hospitalityBookingApiError(error);
}

export async function POST(request: Request, { params }: { params: Promise<{ 'booking-id': string }> }) {
  const observation = createRequestObservation(request, {
    operation: 'hospitality-tax-invoice.issue',
    documentType: 'tax-invoice',
  });
  let organizationId: string | undefined;

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return observation.finish(context.response);
    organizationId = context.organizationId;
    const bookingId = (await params)['booking-id'];
    const body = await readHospitalityBookingJsonObject(request);
    const recipient = body.recipient as HospitalityInvoiceRecipientInput | undefined;

    const preparation = await prepareHospitalityInvoice({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      recipient,
    });
    const issued = await issueHospitalityAustralianTaxInvoice({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
      bookingId,
      preparationId: preparation.id,
    });
    return observation.finish(
      hospitalityBookingJson({ documentNumber: issued.documentNumber, issuedAt: issued.issuedAt, currency: issued.currency, totalMinor: issued.totalMinor }),
      { organizationId },
    );
  } catch (error) {
    return observation.finish(invoiceError(error), { organizationId });
  }
}
