import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

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
    return finish(redirectToLocalPath(`${path}?error=late-return-policy-validation`), 'rejected');
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
    return finish(redirectToLocalPath(`${path}?status=${status}`));
  } catch (error) {
    const code = inventoryErrorCode(error);
    const pageCode = code === 'server' ? 'server' : `late-return-policy-${code}`;
    return finish(
      redirectToLocalPath(`${path}?error=${pageCode}`),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
