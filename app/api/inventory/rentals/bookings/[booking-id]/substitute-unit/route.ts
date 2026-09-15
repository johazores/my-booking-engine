import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import {
  buildRentalBookingUnitSubstitutionIdempotencyKey,
  RentalBookingUnitSubstitutionValidationError,
} from '@/server/bookings/rental-booking-unit-substitution-domain.ts';
import {
  applyRentalBookingUnitSubstitution,
  RentalBookingUnitSubstitutionConflictError,
  RentalBookingUnitSubstitutionUnavailableError,
} from '@/server/bookings/rental-booking-unit-substitution-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import { prepareInventoryMutationRequest } from '@/server/inventory/inventory-http.ts';

function formField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function unitSubstitutionErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalBookingUnitSubstitutionUnavailableError) return 'unavailable';
  if (
    error instanceof RentalBookingUnitSubstitutionConflictError
    || error instanceof RentalAvailabilityIntegrityError
  ) return 'conflict';
  if (error instanceof RentalBookingUnitSubstitutionValidationError) return 'validation';
  return 'server';
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.unit-substitute');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const bookingId = params['booking-id'];
  const formData = await request.formData();
  const targetUnitId = formField(formData, 'targetUnitId');
  const authorityFingerprint = formField(formData, 'authorityFingerprint').trim().toLowerCase();
  const idempotencyKey = buildRentalBookingUnitSubstitutionIdempotencyKey(
    bookingId,
    authorityFingerprint,
  );

  try {
    const result = await applyRentalBookingUnitSubstitution({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      substitution: { targetUnitId, authorityFingerprint, idempotencyKey },
    });
    const status = result.idempotent
      ? 'booking-unit-substitution-existing'
      : 'booking-unit-substituted';
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
    const code = unitSubstitutionErrorCode(error);
    return finish(
      NextResponse.redirect(
        new URL(
          `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/substitute-unit?targetUnitId=${encodeURIComponent(targetUnitId)}&error=${code}`,
          request.url,
        ),
        303,
      ),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
