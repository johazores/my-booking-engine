import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationRecoveryProvider } from './hospitality-supplier-reservation-recovery-provider.ts';
import {
  claimHospitalitySupplierReservationReconciliation,
  settleHospitalitySupplierReservationReconciliation,
} from './hospitality-supplier-reservation-service.ts';

export async function reconcileHospitalitySupplierReservationWithProvider(input: {
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  provider: HospitalitySupplierReservationRecoveryProvider;
}) {
  const claim = await claimHospitalitySupplierReservationReconciliation({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
  });

  const providerReservationReference = claim.reservation.providerReservationReference;
  if (!providerReservationReference || input.provider.code !== claim.reservation.providerCode) {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: { status: 'UNKNOWN', failureCode: 'INVALID_REQUEST' },
    });
  }

  try {
    const result = await input.provider.retrieveReservation(providerReservationReference);
    if (result.providerReservationReference !== providerReservationReference) {
      return settleHospitalitySupplierReservationReconciliation({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reservationId: input.reservationId,
        attemptId: claim.attempt.id,
        outcome: { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' },
      });
    }

    if (result.status === 'FOUND') {
      return settleHospitalitySupplierReservationReconciliation({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reservationId: input.reservationId,
        attemptId: claim.attempt.id,
        outcome: {
          status: 'FOUND',
          providerReservationReference: result.providerReservationReference,
          supplierConfirmationReference: result.supplierConfirmationReference,
          providerCorrelationId: result.providerCorrelationId,
        },
      });
    }

    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'NOT_FOUND',
        providerCorrelationId: result.providerCorrelationId,
      },
    });
  } catch (error) {
    return settleHospitalitySupplierReservationReconciliation({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'UNKNOWN',
        failureCode: error instanceof HospitalitySupplierProviderError ? error.code : 'PROVIDER_UNAVAILABLE',
      },
    });
  }
}
