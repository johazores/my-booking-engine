import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { deriveHospitalityCommercialAmendmentSettlementState } from './booking-commercial-amendment-settlement-domain.ts';
import { HospitalityBookingUnavailableError } from './hospitality-booking-service.ts';

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

    const transactions = await transaction.paymentTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
      select: {
        commercialAmendmentId: true,
        kind: true,
        status: true,
        providerCode: true,
        providerReference: true,
        sourceProviderReference: true,
        currency: true,
        amountMinor: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const settlement = deriveHospitalityCommercialAmendmentSettlementState({
      amendmentId: amendment.id,
      direction: amendment.direction,
      paymentProviderCode: amendment.paymentProviderCode,
      currency: amendment.currency,
      beforeTotalMinor: amendment.beforeTotalMinor,
      afterTotalMinor: amendment.afterTotalMinor,
      deltaMinor: amendment.deltaMinor,
      transactions,
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
