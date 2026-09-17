import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { prepareInventoryMutationRequest } from '@/server/inventory/inventory-http.ts';
import {
  recordRentalSecurityBondManualRelease,
  RentalSecurityBondConflictError,
  RentalSecurityBondUnavailableError,
} from '@/server/payments/rental-security-bond-service.ts';

function errorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalSecurityBondConflictError) return 'conflict';
  if (error instanceof RentalSecurityBondUnavailableError) return 'unavailable';
  if (error instanceof Error && /invalid|required|must|reference/i.test(error.message)) return 'validation';
  return 'server';
}

export async function POST(request: Request, { params }: { params: Promise<{ 'booking-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.security-bond.release');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'booking-id': bookingId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/security-bond`;
  try {
    const formData = await request.formData();
    const result = await recordRentalSecurityBondManualRelease({ organizationId: organization.id, actorUserId: session.user.id, bookingId, reference: formData.get('reference') });
    return finish(NextResponse.redirect(new URL(`${path}?status=${result.idempotent ? 'bond-release-existing' : 'bond-released'}`, request.url), 303));
  } catch (error) {
    const code = errorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
