import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { BookingApiRequestError, requireHospitalityBookingApiContext } from '@/server/bookings/hospitality-booking-http.ts';
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

export async function POST(request: Request) {
  try {
    const context = await requireHospitalityBookingApiContext(request, { write: true });
    if (context.response) return redirectResponse(request, '/invoices/reconciliation');

    const report = await reconcileHospitalityAustralianTaxDocuments({
      organizationId: context.organizationId,
      actorUserId: context.actorUserId,
    });
    return redirectResponse(request, `/invoices/reconciliation?status=${report.status.toLowerCase()}`);
  } catch (error) {
    if (error instanceof OrganizationPermissionDeniedError) return redirectResponse(request, '/dashboard?error=permission');
    if (error instanceof HospitalityTaxDocumentReconciliationLimitError) return redirectResponse(request, '/invoices/reconciliation?error=limit');
    if (error instanceof BookingApiRequestError) return redirectResponse(request, '/invoices/reconciliation?error=request');
    throw error;
  }
}
