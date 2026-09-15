import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  buildRentalBookingRescheduleIdempotencyKey,
  RentalBookingRescheduleValidationError,
} from '@/server/bookings/rental-booking-reschedule-domain.ts';
import {
  applyRentalBookingReschedule,
  RentalBookingRescheduleConflictError,
  RentalBookingRescheduleUnavailableError,
} from '@/server/bookings/rental-booking-reschedule-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { RentalInventoryValidationError } from '@/server/inventory/rental-domain.ts';
import { prepareInventoryMutationRequest } from '@/server/inventory/inventory-http.ts';

function formField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function rentalBookingRescheduleErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalBookingRescheduleUnavailableError) return 'unavailable';
  if (
    error instanceof RentalBookingRescheduleConflictError
    || error instanceof RentalAvailabilityIntegrityError
  ) return 'conflict';
  if (
    error instanceof RentalBookingRescheduleValidationError
    || error instanceof RentalInventoryValidationError
  ) return 'validation';
  return 'server';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.reschedule');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const bookingId = params['booking-id'];
  const formData = await request.formData();
  const authorityFingerprint = formField(formData, 'authorityFingerprint').trim().toLowerCase();
  const startsOn = formField(formData, 'startsOn');
  const endsOn = formField(formData, 'endsOn');
  const idempotencyKey = buildRentalBookingRescheduleIdempotencyKey(
    bookingId,
    authorityFingerprint,
  );

  try {
    const result = await applyRentalBookingReschedule({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      reschedule: {
        startsOn,
        endsOn,
        authorityFingerprint,
        idempotencyKey,
      },
    });
    const status = result.idempotent ? 'booking-reschedule-existing' : 'booking-rescheduled';
    return finish(
      NextResponse.redirect(
        new URL(
          `/inventory/rentals/bookings/${encodeURIComponent(result.booking.id)}?status=${status}`,
          request.url,
        ),
        303,
      ),
    );
  } catch (error) {
    const code = rentalBookingRescheduleErrorCode(error);
    return finish(
      NextResponse.redirect(
        new URL(
          `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/reschedule?startsOn=${encodeURIComponent(startsOn)}&endsOn=${encodeURIComponent(endsOn)}&error=${code}`,
          request.url,
        ),
        303,
      ),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
