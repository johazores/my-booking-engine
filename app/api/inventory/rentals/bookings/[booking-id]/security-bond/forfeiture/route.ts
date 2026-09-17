import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { formField, prepareInventoryMutationRequest, readInventoryFormData } from '@/server/inventory/inventory-http.ts';
import {
  forfeitRentalSecurityBondAgainstDamageLiability,
} from '@/server/payments/rental-security-bond-forfeiture-service.ts';
import {
  RentalSecurityBondConflictError,
  RentalSecurityBondUnavailableError,
} from '@/server/payments/rental-security-bond-service.ts';

function errorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (error instanceof RentalSecurityBondConflictError) return 'conflict';
  if (error instanceof RentalSecurityBondUnavailableError) return 'unavailable';
  if (error instanceof Error && /invalid|required|must|confirmation/i.test(error.message)) return 'validation';
  return 'server';
}

export async function POST(request: Request, { params }: { params: Promise<{ 'booking-id': string }> }) {
  const mutation = await prepareInventoryMutationRequest(request, 'payment.rental.security-bond.forfeit');
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const { 'booking-id': bookingId } = await params;
  const path = `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/security-bond`;
  const formData = await readInventoryFormData(request);
  if (!formData || formField(formData, 'confirmation').trim().toUpperCase() !== 'FORFEIT') {
    return finish(NextResponse.redirect(new URL(`${path}?error=validation`, request.url), 303), 'rejected');
  }
  try {
    const result = await forfeitRentalSecurityBondAgainstDamageLiability({
      organizationId: organization.id,
      actorUserId: session.user.id,
      bookingId,
    });
    return finish(NextResponse.redirect(new URL(`${path}?status=${result.idempotent ? 'bond-forfeiture-existing' : 'bond-forfeited'}`, request.url), 303));
  } catch (error) {
    const code = errorCode(error);
    return finish(NextResponse.redirect(new URL(`${path}?error=${code}`, request.url), 303), code === 'server' ? 'failed' : 'rejected');
  }
}
