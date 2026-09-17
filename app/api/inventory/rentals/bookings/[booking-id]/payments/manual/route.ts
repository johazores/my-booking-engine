import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { formField, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import {
  recordRentalManualOfflinePayment,
  RentalPaymentConflictError,
  RentalPaymentUnavailableError,
} from '@/server/payments/rental-payment-service.ts';

function rentalPaymentErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'payment-permission';
  if (error instanceof RentalPaymentConflictError) return 'payment-conflict';
  if (error instanceof RentalPaymentUnavailableError) return 'payment-unavailable';
  if (error instanceof Error && /invalid|required|must|cannot|only|zero-value|amount|balance/i.test(error.message)) return 'payment-validation';
  return 'payment-server';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.manual.record');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const bookingId = params['booking-id'];
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(
      NextResponse.redirect(new URL(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=payment-validation`, request.url), 303),
      'rejected',
    );
  }

  const amount = formField(formData, 'amount');
  if (!amount.trim()) {
    return finish(
      NextResponse.redirect(new URL(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=payment-validation`, request.url), 303),
      'rejected',
    );
  }

  try {
    const result = await recordRentalManualOfflinePayment({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      reference: formField(formData, 'reference'),
      amount,
    });
    const status = result.idempotent ? 'rental-payment-existing' : 'rental-payment-recorded';
    return finish(NextResponse.redirect(new URL(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?status=${status}`, request.url), 303));
  } catch (error) {
    const code = rentalPaymentErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=${code}`, request.url), 303),
      code === 'payment-server' ? 'failed' : 'rejected',
    );
  }
}
