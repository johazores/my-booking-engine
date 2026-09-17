import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { prepareInventoryMutationRequest } from '@/server/inventory/inventory-http.ts';
import {
  recordRentalDamageManualOfflineRefund,
  RentalDamageSettlementConflictError,
  RentalDamageSettlementUnavailableError,
} from '@/server/payments/rental-damage-settlement-service.ts';

function errorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'payment-permission';
  if (error instanceof RentalDamageSettlementConflictError) return 'payment-conflict';
  if (error instanceof RentalDamageSettlementUnavailableError) return 'payment-unavailable';
  if (error instanceof Error && /invalid|required|must|cannot|only/i.test(error.message)) return 'payment-validation';
  return 'payment-server';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string; 'case-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.damage.refund.record');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'booking-id': bookingId, 'case-id': damageCaseId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;

  try {
    const formData = await request.formData();
    await recordRentalDamageManualOfflineRefund({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      damageCaseId,
      reference: formData.get('reference'),
    });
    return finish(NextResponse.redirect(new URL(path, request.url), 303));
  } catch (error) {
    const code = errorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'payment-server' ? 'failed' : 'rejected');
  }
}
