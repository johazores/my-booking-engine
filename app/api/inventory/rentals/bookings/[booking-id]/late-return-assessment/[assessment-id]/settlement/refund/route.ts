import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  formField,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import {
  recordRentalLateReturnManualOfflineRefund,
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
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.late-return.refund.record');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'booking-id': bookingId, 'assessment-id': assessmentId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL(`${path}?error=payment-validation`, request.url), 303), 'rejected');
  }

  try {
    await recordRentalLateReturnManualOfflineRefund({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      assessmentId,
      reference: formField(formData, 'reference'),
    });
    return finish(NextResponse.redirect(new URL(path, request.url), 303));
  } catch (error) {
    const code = errorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'payment-server' ? 'failed' : 'rejected');
  }
}
