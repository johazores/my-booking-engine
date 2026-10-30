import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

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
    return finish(redirectToLocalPath(`${path}?error=validation`), 'rejected');
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
    return finish(redirectToLocalPath(path));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      redirectToLocalPath(`${path}?error=${code}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
