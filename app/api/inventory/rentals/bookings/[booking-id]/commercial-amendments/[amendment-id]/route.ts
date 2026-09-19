import { NextResponse } from 'next/server';

import { OrganizationPermissionDeniedError } from '@/server/authorization/authorization-service.ts';
import { applyRentalBookingCommercialAmendment } from '@/server/bookings/rental-booking-commercial-amendment-apply-service.ts';
import {
  recordRentalBookingCommercialAmendmentManualCompensation,
  recordRentalBookingCommercialAmendmentManualSettlement,
} from '@/server/bookings/rental-booking-commercial-amendment-settlement-service.ts';
import {
  cancelRentalBookingCommercialAmendment,
  RentalBookingCommercialAmendmentConflictError,
  RentalBookingCommercialAmendmentUnavailableError,
} from '@/server/bookings/rental-booking-commercial-amendment-service.ts';
import {
  RentalBookingEffectiveRefundConflictError,
  recordRentalBookingPostApplyManualRefund,
} from '@/server/bookings/rental-booking-effective-refund-service.ts';
import {
  readRentalBookingEffectiveSettlement,
  RentalBookingEffectiveSettlementUnavailableError,
} from '@/server/bookings/rental-booking-effective-settlement-service.ts';
import { RentalAvailabilityIntegrityError } from '@/server/inventory/rental-availability-domain.ts';
import {
  formField,
  prepareInventoryMutationRequest,
  readInventoryFormData,
} from '@/server/inventory/inventory-http.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from '@/server/pricing/money.ts';

class RentalCommercialAmendmentActionValidationError extends Error {}

function actionErrorCode(error: unknown) {
  if (error instanceof OrganizationPermissionDeniedError) return 'permission';
  if (
    error instanceof RentalBookingCommercialAmendmentUnavailableError
    || error instanceof RentalBookingEffectiveSettlementUnavailableError
  ) return 'unavailable';
  if (
    error instanceof RentalBookingCommercialAmendmentConflictError
    || error instanceof RentalBookingEffectiveRefundConflictError
    || error instanceof RentalAvailabilityIntegrityError
  ) return 'conflict';
  if (
    error instanceof RentalCommercialAmendmentActionValidationError
    || error instanceof PricingValidationError
  ) return 'validation';
  return 'server';
}

function detailUrl(bookingId: string, amendmentId: string, query: string) {
  return `/inventory/rentals/bookings/${encodeURIComponent(bookingId)}/commercial-amendments/${encodeURIComponent(amendmentId)}?${query}`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ 'booking-id': string; 'amendment-id': string }> },
) {
  const mutation = await prepareInventoryMutationRequest(
    request,
    'booking.rental.commercial-amendment.manage',
  );
  if (!mutation.ok) return mutation.response;
  const { finish, organization, session } = mutation;
  const params = await context.params;
  const bookingId = params['booking-id'];
  const amendmentId = params['amendment-id'];
  const formData = await readInventoryFormData(request);

  if (!formData) {
    return finish(
      NextResponse.redirect(
        new URL(detailUrl(bookingId, amendmentId, 'error=validation'), request.url),
        303,
      ),
      'rejected',
    );
  }

  const operation = formField(formData, 'operation').trim().toLowerCase();

  try {
    if (operation === 'settle') {
      const result = await recordRentalBookingCommercialAmendmentManualSettlement({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        amendmentId,
        reference: formField(formData, 'reference'),
      });
      const status = result.idempotent ? 'settlement-existing' : 'settlement-recorded';
      return finish(
        NextResponse.redirect(
          new URL(detailUrl(bookingId, amendmentId, `status=${status}`), request.url),
          303,
        ),
      );
    }

    if (operation === 'compensate') {
      const result = await recordRentalBookingCommercialAmendmentManualCompensation({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        amendmentId,
        reference: formField(formData, 'reference'),
      });
      const status = result.idempotent ? 'compensation-existing' : 'compensation-recorded';
      return finish(
        NextResponse.redirect(
          new URL(detailUrl(bookingId, amendmentId, `status=${status}`), request.url),
          303,
        ),
      );
    }

    if (operation === 'apply') {
      if (formField(formData, 'confirmation').trim().toUpperCase() !== 'APPLY') {
        throw new RentalCommercialAmendmentActionValidationError(
          'Type APPLY to confirm the commercial date change.',
        );
      }
      const result = await applyRentalBookingCommercialAmendment({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        amendmentId,
      });
      const status = result.idempotent ? 'apply-existing' : 'amendment-applied';
      return finish(
        NextResponse.redirect(
          new URL(detailUrl(bookingId, amendmentId, `status=${status}`), request.url),
          303,
        ),
      );
    }

    if (operation === 'close') {
      const result = await cancelRentalBookingCommercialAmendment({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        amendmentId,
      });
      const status = result.amendment.status === 'EXPIRED'
        ? 'amendment-expired'
        : result.idempotent
          ? 'close-existing'
          : 'amendment-closed';
      return finish(
        NextResponse.redirect(
          new URL(detailUrl(bookingId, amendmentId, `status=${status}`), request.url),
          303,
        ),
      );
    }

    if (operation === 'refund') {
      const effective = await readRentalBookingEffectiveSettlement({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
      });
      if (
        !effective.appliedAmendment
        || effective.appliedAmendment.id !== amendmentId
        || !effective.settlement.reconciled
      ) {
        throw new RentalBookingEffectiveRefundConflictError(
          'Post-apply refund authority does not match this commercial amendment.',
        );
      }
      const amountMinor = parseMoneyMajorToMinor(
        formField(formData, 'amount'),
        effective.settlement.currency,
      );
      const result = await recordRentalBookingPostApplyManualRefund({
        organizationId: organization.id,
        actorUserId: session.user.id,
        bookingId,
        reference: formField(formData, 'reference'),
        amountMinor,
      });
      const status = result.idempotent ? 'refund-existing' : 'refund-recorded';
      return finish(
        NextResponse.redirect(
          new URL(detailUrl(bookingId, amendmentId, `status=${status}`), request.url),
          303,
        ),
      );
    }

    throw new RentalCommercialAmendmentActionValidationError(
      'Rental commercial amendment operation is invalid.',
    );
  } catch (error) {
    const code = actionErrorCode(error);
    return finish(
      NextResponse.redirect(
        new URL(detailUrl(bookingId, amendmentId, `error=${code}`), request.url),
        303,
      ),
      code === 'server' ? 'failed' : 'rejected',
    );
  }
}
