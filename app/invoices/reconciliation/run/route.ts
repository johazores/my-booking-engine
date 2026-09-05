import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { BookingApiRequestError, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
import { createRequestObservation, type RequestLogFailureOutcome } from '@/server/observability/request-observability.ts';
import {
  HospitalityTaxDocumentReconciliationLimitError,
  reconcileHospitalityAustralianTaxDocuments,
} from '@/server/payments/hospitality-tax-document-reconciliation-service.ts';

function redirectResponse(request: Request, path: string) {
  return new Response(null, {
    status: 303,
    headers: {
      location: new URL(path, request.url).toString(),
      'cache-control': 'no-store',
    },
  });
}

function responseFailureOutcome(response: Response): RequestLogFailureOutcome {
  return response.status >= 500 ? 'failed' : 'rejected';
}

export async function POST(request: Request) {
  const observation = createRequestObservation(request, { operation: 'hospitality-tax-document.reconciliation.run' });
  let organizationId: string | undefined;
  const finish = (response: Response, failureOutcome?: RequestLogFailureOutcome) => observation.finish(
    response,
    { organizationId },
    failureOutcome ? { failureOutcome } : undefined,
  );

  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) {
      return finish(redirectResponse(request, '/invoices/reconciliation'), responseFailureOutcome(context.response));
    }
    organizationId = context.organizationId;

    const report = await reconcileHospitalityAustralianTaxDocuments({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
    return finish(redirectResponse(request, `/invoices/reconciliation?status=${report.status.toLowerCase()}`));
  } catch (error) {
    if (error instanceof OrganizationPermissionDeniedError) {
      return finish(redirectResponse(request, '/dashboard?error=permission'), 'rejected');
    }
    if (error instanceof HospitalityTaxDocumentReconciliationLimitError) {
      return finish(redirectResponse(request, '/invoices/reconciliation?error=limit'), 'rejected');
    }
    if (error instanceof BookingApiRequestError) {
      return finish(redirectResponse(request, '/invoices/reconciliation?error=request'), 'rejected');
    }
    return finish(redirectResponse(request, '/invoices/reconciliation?error=internal'), 'failed');
  }
}
