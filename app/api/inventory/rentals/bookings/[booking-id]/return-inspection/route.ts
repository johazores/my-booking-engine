import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { recordRentalReturnInspection } from '@/server/bookings/rental-return-inspection-service.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ 'booking-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(
    request,
    'booking.rental.return-inspection',
  );
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const formData = await readInventoryFormData(request);
  const { 'booking-id': bookingId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;

  if (!formData) {
    return finish(
      NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303),
      'rejected',
    );
  }

  try {
    await recordRentalReturnInspection({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      inspection: {
        outcome: formField(formData, 'outcome'),
        notes: formField(formData, 'notes'),
      },
    });
    return finish(
      NextResponse.redirect(new URL(path, request.url), 303),
    );
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
