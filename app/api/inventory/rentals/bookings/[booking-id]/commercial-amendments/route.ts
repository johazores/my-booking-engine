import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  RentalBookingCommercialAmendmentValidationError,
} from '@/server/bookings/rental-booking-commercial-amendment-domain.ts';
import {
  prepareRentalBookingCommercialAmendment,
  RentalBookingCommercialAmendmentConflictError,
  RentalBookingCommercialAmendmentUnavailableError,
} from '@/server/bookings/rental-booking-commercial-amendment-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { RentalInventoryValidationError } from '@/server/inventory/rental-domain.ts';
import {
  formField,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';

function amendmentPrepareErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalBookingCommercialAmendmentUnavailableError) return 'unavailable';
  if (
    error instanceof RentalBookingCommercialAmendmentConflictError
    || error instanceof RentalAvailabilityIntegrityError
  ) return 'conflict';
  if (
    error instanceof RentalBookingCommercialAmendmentValidationError
    || error instanceof RentalInventoryValidationError
  ) return 'validation';
  return 'server';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(
    request,
    'booking.rental.commercial-amendment.prepare',
  );
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const bookingId = params['booking-id'];
  const formData = await readInventoryFormData(request);

  if (!formData) {
    return finish(
      redirectToLocalPath(
          `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/reschedule?error=validation`),
      'rejected',
    );
  }

  const startsOn = formField(formData, 'startsOn');
  const endsOn = formField(formData, 'endsOn');
  const reviewFingerprint = formField(formData, 'reviewFingerprint').trim().toLowerCase();

  try {
    const result = await prepareRentalBookingCommercialAmendment({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      target: { startsOn, endsOn, reviewFingerprint },
    });
    const status = result.idempotent ? 'amendment-existing' : 'amendment-prepared';
    return finish(
      redirectToLocalPath(
          `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/commercial-amendments/${encodeURIComponent(result.amendment.id)}?status=${status}`),
    );
  } catch (error) {
    const code = amendmentPrepareErrorCode(error);
    return finish(
      redirectToLocalPath(
          `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/reschedule?startsOn=${encodeURIComponent(startsOn)}&endsOn=${encodeURIComponent(endsOn)}&error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
