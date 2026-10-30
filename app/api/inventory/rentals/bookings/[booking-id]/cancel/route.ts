import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  RentalBookingCancellationValidationError,
} from '@/server/bookings/rental-booking-cancellation-domain.ts';
import {
  cancelRentalBooking,
  RentalBookingCancellationConflictError,
  RentalBookingCancellationUnavailableError,
} from '@/server/bookings/rental-booking-cancellation-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import {
  formField,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';

function rentalBookingCancellationErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalBookingCancellationConflictError || error instanceof RentalAvailabilityIntegrityError) return 'conflict';
  if (error instanceof RentalBookingCancellationUnavailableError) return 'unavailable';
  if (error instanceof RentalBookingCancellationValidationError) return 'validation';
  return 'server';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.cancel');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const bookingId = params['booking-id'];
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(
      redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=validation`),
      'rejected',
    );
  }
  const reason = formField(formData, 'reason');

  try {
    const result = await cancelRentalBooking({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      reason,
    });
    const status = result.idempotent ? 'booking-already-cancelled' : 'booking-cancelled';
    return finish(
      redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(result.booking.id)}?status=${status}`),
    );
  } catch (error) {
    const code = rentalBookingCancellationErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
