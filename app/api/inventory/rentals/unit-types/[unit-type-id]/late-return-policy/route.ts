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
    return finish(NextResponse.redirect(new URL(`${path}?error=late-return-policy-validation`, request.url), 303), 'rejected');
  }

  try {
    const result = await reviseRentalLateReturnPolicy({
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
    const status = result.idempotent ? 'late-return-policy-current' : 'late-return-policy-updated';
    return finish(NextResponse.redirect(new URL(`${path}?status=${status}`, request.url), 303));
  } catch (error) {
    const code = inventoryErrorCode(error);
    const pageCode = code === 'server' ? 'server' : `late-return-policy-${code}`;
    return finish(
      NextResponse.redirect(new URL(`${path}?error=${pageCode}`, request.url), 303),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
