import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { isRentalFinancialInputValidationError } from '@/server/payments/rental-financial-input-validation.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { formField, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import {
  recordRentalManualOfflineRefund,
  RentalPaymentConflictError,
  RentalPaymentUnavailableError,
} from '@/server/payments/rental-payment-service.ts';

function rentalRefundErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'payment-permission';
  if (error instanceof RentalPaymentConflictError) return 'payment-conflict';
  if (error instanceof RentalPaymentUnavailableError) return 'payment-unavailable';
  if (isRentalFinancialInputValidationError(error)) return 'payment-validation';
  return 'payment-server';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.manual-refund.record');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const bookingId = params['booking-id'];
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(
      redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=payment-validation`),
      'rejected',
    );
  }

  const amount = formField(formData, 'amount');
  if (!amount.trim()) {
    return finish(
      redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=payment-validation`),
      'rejected',
    );
  }

  try {
    const result = await recordRentalManualOfflineRefund({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      reference: formField(formData, 'reference'),
      amount,
    });
    const status = result.idempotent ? 'rental-refund-existing' : 'rental-refund-recorded';
    return finish(redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?status=${status}`));
  } catch (error) {
    const code = rentalRefundErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=${code}`),
      code === 'payment-server' ? 'failed' : 'rejected',
    );
  }
}
