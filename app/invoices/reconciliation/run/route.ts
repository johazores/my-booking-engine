import { applyAuthResponseNoStore, redirectToLocalPath } from '@/server/auth/auth-http.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { BookingApiRequestError, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import {
  HospitalityTaxDocumentReconciliationLimitError,
  reconcileHospitalityAustralianTaxDocuments,
} from '@/server/payments/hospitality-tax-document-reconciliation-service.ts';

function responseFailureOutcome(response: Response): RequestLogFailureOutcome {
  return response.status >= 500 ? 'failed' : 'rejected';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'hospitality-tax-document.reconciliation.run' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    applyAuthResponseNoStore(response),
    { organizationId },
    failureOutcome ? { failureOutcome } : undefined,
  );

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) {
      return finish(redirectToLocalPath('/invoices/reconciliation'), responseFailureOutcome(context.response));
    }
    organizationId = context.organizationId;

    const report = await reconcileHospitalityAustralianTaxDocuments({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
    return finish(redirectToLocalPath(`/invoices/reconciliation?status=${report.status.toLowerCase()}`));
  } catch (error) {
    if (error instanceof OrganizationPermissionDeniedError) {
      return finish(redirectToLocalPath('/dashboard?error=permission'), 'rejected');
    }
    if (error instanceof HospitalityTaxDocumentReconciliationLimitError) {
      return finish(redirectToLocalPath('/invoices/reconciliation?error=limit'), 'rejected');
    }
    if (error instanceof BookingApiRequestError) {
      return finish(redirectToLocalPath('/invoices/reconciliation?error=request'), 'rejected');
    }
    return finish(redirectToLocalPath('/invoices/reconciliation?error=internal'), 'failed');
  }
}
