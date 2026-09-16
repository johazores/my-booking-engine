import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { RentalBookingEarlyReturnReleaseIntegrityError } from '@/server/bookings/rental-booking-early-return-release-domain.ts';
import {
  releaseRentalBookingInventoryAfterEarlyReturn,
  RentalBookingEarlyReturnReleaseConflictError,
  RentalBookingEarlyReturnReleaseUnavailableError,
} from '@/server/bookings/rental-booking-early-return-release-service.ts';
import { RentalBookingFulfillmentIntegrityError } from '@/server/bookings/rental-booking-fulfillment-domain.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { prepareInventoryMutationRequest } from '@/server/inventory/inventory-http.ts';

function releaseErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (
    error instanceof RentalBookingEarlyReturnReleaseConflictError
    || error instanceof RentalBookingEarlyReturnReleaseIntegrityError
    || error instanceof RentalBookingFulfillmentIntegrityError
    || error instanceof RentalAvailabilityIntegrityError
  ) return 'conflict';
  if (error instanceof RentalBookingEarlyReturnReleaseUnavailableError) return 'unavailable';
  if (error instanceof Error && /invalid|required|must|cannot/i.test(error.message)) return 'validation';
  return 'server';
}

export async function POST(request: Request, context: { params: Promise<{ 'booking-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.inventory-release');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const bookingId = (await context.params)['booking-id'];

  try {
    const result = await releaseRentalBookingInventoryAfterEarlyReturn({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
    });
    const status = result.idempotent
      ? 'rental-inventory-release-existing'
      : 'rental-inventory-released';
    return finish(NextResponse.redirect(
      new URL(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?status=${status}`, request.url),
      303,
    ));
  } catch (error) {
    const code = releaseErrorCode(error);
    return finish(
      NextResponse.redirect(
        new URL(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=${code}`, request.url),
        303,
      ),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
