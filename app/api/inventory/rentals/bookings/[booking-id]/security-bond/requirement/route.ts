import { redirectToLocalPath } from '@/server/auth/auth-http.ts';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { formField, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import { PricingValidationError } from '@/server/pricing/money.ts';
import {
  createRentalSecurityBondRequirement,
  RentalSecurityBondConflictError,
  RentalSecurityBondUnavailableError,
} from '@/server/payments/rental-security-bond-service.ts';

function errorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalSecurityBondConflictError) return 'conflict';
  if (error instanceof RentalSecurityBondUnavailableError) return 'unavailable';
  if (error instanceof PricingValidationError) return 'validation';
  return 'server';
}

export async function POST(request: Request, { params }: { params: Promise<{ 'booking-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.security-bond.require');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'booking-id': bookingId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/security-bond`;
  const formData = await readInventoryFormData(request);
  if (!formData) return finish(redirectToLocalPath(`${path}?error=validation`), 'rejected');
  try {
    const result = await createRentalSecurityBondRequirement({ organizationId: organization.id, actorUserId: session.user.id, bookingId, amountMajor: formField(formData, 'amountMajor') });
    return finish(redirectToLocalPath(`${path}?status=${result.idempotent ? 'bond-requirement-existing' : 'bond-required'}`));
  } catch (error) {
    const code = errorCode(error);
    return finish(redirectToLocalPath(`${path}?error=${code}`), code === 'server' ? 'failed' : 'rejected');
  }
}
