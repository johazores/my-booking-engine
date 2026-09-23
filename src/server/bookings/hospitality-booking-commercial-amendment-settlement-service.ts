import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { readHospitalityPaymentSettlementHistory } from '../payments/hospitality-payment-history.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { HospitalityBookingConflictError, HospitalityBookingUnavailableError } from './hospitality-booking-service.ts';

export async function getHospitalityBookingCommercialAmendmentSettlementState(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  amendmentId: string;
  now?: Date;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.amendmentId, 'amendmentId');

  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'payment:manage',
    }),
  ]);

  const now = input.now ?? new Date();
  return db.$transaction(async (transaction) => {
    const amendment = await transaction.hospitalityBookingCommercialAmendment.findFirst({
      where: {
        id: input.amendmentId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
      select: {
        id: true,
        status: true,
        direction: true,
        paymentProviderCode: true,
        currency: true,
        beforeTotalMinor: true,
        afterTotalMinor: true,
        deltaMinor: true,
        expiresAt: true,
      },
    });
    if (!amendment) throw new HospitalityBookingUnavailableError();

    const paymentHistory = await readHospitalityPaymentSettlementHistory({
      transaction,
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    });
    if (!paymentHistory.complete) {
      throw new HospitalityBookingConflictError(paymentHistory.reason);
    }

    const settlement = deriveHospitalityCommercialAmendmentSettlementState({
      amendmentId: amendment.id,
      direction: amendment.direction,
      paymentProviderCode: amendment.paymentProviderCode,
      currency: amendment.currency,
      beforeTotalMinor: amendment.beforeTotalMinor,
      afterTotalMinor: amendment.afterTotalMinor,
      deltaMinor: amendment.deltaMinor,
      transactions: paymentHistory.transactions,
    });
    const expired = amendment.status === 'PREPARED' && amendment.expiresAt.getTime() <= now.getTime();
    const actionable = amendment.status === 'PREPARED' && !expired;

    return {
      amendmentId: amendment.id,
      amendmentStatus: amendment.status,
      expiresAt: amendment.expiresAt,
      expired,
      actionable,
      canApply: actionable && settlement.readyToApply,
      settlement,
    };
  }, { isolationLevel: 'Serializable' });
}
