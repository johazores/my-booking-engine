import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { TenantIdentifierValidationError } from '@/server/tenancy/tenant-scope.ts';
import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { RentalBookingFulfillmentIntegrityError } from '@/server/bookings/rental-booking-fulfillment-domain.ts';
import {
  recordRentalBookingReturn,
  RentalBookingFulfillmentConflictError,
  RentalBookingFulfillmentUnavailableError,
} from '@/server/bookings/rental-booking-fulfillment-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { prepareInventoryMutationRequest } from '@/server/inventory/inventory-http.ts';

function fulfillmentErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalBookingFulfillmentConflictError || error instanceof RentalBookingFulfillmentIntegrityError || error instanceof RentalAvailabilityIntegrityError) return 'conflict';
  if (error instanceof RentalBookingFulfillmentUnavailableError) return 'unavailable';
  if (error instanceof TenantIdentifierValidationError) return 'validation';
  return 'server';
}

export async function POST(request: Request, context: { params: Promise<{ 'booking-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.return');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const bookingId = (await context.params)['booking-id'];
  try {
    const result = await recordRentalBookingReturn({ organizationId: organization.id, actorUserId: session.user.id, bookingId });
    const status = result.idempotent ? 'rental-return-existing' : 'rental-returned';
    return finish(redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?status=${status}`));
  } catch (error) {
    const code = fulfillmentErrorCode(error);
    return finish(
      redirectToLocalPath(`/inventory/rentals/bookings/${encodeURIComponent(bookingId)}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
