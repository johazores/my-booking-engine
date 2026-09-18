import { NextResponse } from 'next/server';

import {
  formField,
  inventoryErrorCode,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { reviseRentalLateReturnPolicy } from '@/server/pricing/rental-late-return-policy-service.ts';

export async function POST(request: Request, { params }: { params: Promise<{ 'unit-type-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'pricing.rental.late-return-policy.revise');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'unit-type-id': unitTypeId } = await params;
  const path = `/inventory/rentals/types/${encodeURIComponent(unitTypeId)}`;
  const formData = await readInventoryFormData(request);
  if (!formData) {
    return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  }

  try {
    await reviseRentalLateReturnPolicy({
      organizationId: organization.id,
      actorUserId: session.user.id,
      unitTypeId,
      policy: {
        mode: formField(formData, 'mode'),
        graceDays: formField(formData, 'graceDays'),
        dailyFeeAmountMajor: formField(formData, 'dailyFeeAmountMajor'),
        reason: formField(formData, 'reason'),
        expectedVersion: formField(formData, 'expectedVersion'),
      },
    });
    return finish(NextResponse.redirect(new URL(`${path}?status=late-return-policy-updated`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
