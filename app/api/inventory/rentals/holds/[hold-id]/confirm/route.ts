import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import {
  formField,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { RentalInventoryUnavailableError } from '@/server/inventory/rental-service.ts';
import { RentalBookingValidationError } from '@/server/bookings/rental-booking-domain.ts';
import {
  confirmRentalBookingFromHold,
  RentalBookingConflictError,
} from '@/server/bookings/rental-booking-service.ts';

function rentalBookingErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalBookingValidationError) return 'validation';
  if (error instanceof RentalBookingConflictError || error instanceof RentalAvailabilityIntegrityError) return 'conflict';
  if (error instanceof RentalInventoryUnavailableError) return 'unavailable';
  if (error instanceof Error && /invalid|required|must|cannot/i.test(error.message)) return 'validation';
  return 'server';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'hold-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.confirm');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(
      NextResponse.redirect(new URL(`/inventory/rentals/holds/${encodeURIComponent(params['hold-id'])}?error=validation`, request.url), 303),
      'rejected',
    );
  }

  const customerId = formField(formData, 'customerId');
  const authorityFingerprint = formField(formData, 'authorityFingerprint');
  const idempotencyKey = `rental:${params['hold-id']}:${customerId}`;

  try {
    const result = await confirmRentalBookingFromHold({
      organizationId: organization.id,
      actorUserId: session.user.id,
      confirmation: {
        holdId: params['hold-id'],
        customerId,
        idempotencyKey,
        authorityFingerprint,
      },
    });
    const status = result.idempotent ? 'booking-existing' : 'booking-confirmed';
    return finish(
      NextResponse.redirect(new URL(`/inventory/rentals/bookings/${result.booking.id}?status=${status}`, request.url), 303),
    );
  } catch (error) {
    const code = rentalBookingErrorCode(error);
    const query = new URLSearchParams({ error: code });
    if (customerId) query.set('customerId', customerId);
    return finish(
      NextResponse.redirect(new URL(`/inventory/rentals/holds/${encodeURIComponent(params['hold-id'])}?${query.toString()}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
