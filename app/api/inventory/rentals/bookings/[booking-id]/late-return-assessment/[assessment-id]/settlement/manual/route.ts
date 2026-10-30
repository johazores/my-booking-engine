import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  formField,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import {
  recordRentalLateReturnManualOfflinePayment,
  RentalLateReturnSettlementConflictError,
  RentalLateReturnSettlementUnavailableError,
} from '@/server/payments/rental-late-return-settlement-service.ts';

function errorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'payment-permission';
  if (error instanceof RentalLateReturnSettlementConflictError) return 'payment-conflict';
  if (error instanceof RentalLateReturnSettlementUnavailableError) return 'payment-unavailable';
  if (error instanceof Error && /invalid|required|must|cannot|only/i.test(error.message)) return 'payment-validation';
  return 'payment-server';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'assessment-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.late-return.manual.record');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'booking-id': bookingId, 'assessment-id': assessmentId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(redirectToLocalPath(`${path}?error=payment-validation`), 'rejected');
  }

  try {
    await recordRentalLateReturnManualOfflinePayment({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      assessmentId,
      reference: formField(formData, 'reference'),
    });
    return finish(redirectToLocalPath(path));
  } catch (error) {
    const code = errorCode(error);
    return finish(redirectToLocalPath(`${path}?error=${code}`), code === 'payment-server' ? 'failed' : 'rejected');
  }
}
