import { NextResponse } from 'next/server';

import { assessRentalLateReturn } from '@/server/bookings/rental-late-return-service.ts';
import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'booking-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'booking.rental.late-return.assess');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'booking-id': bookingId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData || formField(formData, 'confirmation') !== 'ACKNOWLEDGED') {
    return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  }

  try {
    await assessRentalLateReturn({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
      assessment: {
        outcome: formField(formData, 'outcome'),
        graceDays: formField(formData, 'graceDays'),
        feeAmountMajor: formField(formData, 'feeAmountMajor'),
        reason: formField(formData, 'reason'),
      },
    });
    return finish(NextResponse.redirect(new URL(path, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
