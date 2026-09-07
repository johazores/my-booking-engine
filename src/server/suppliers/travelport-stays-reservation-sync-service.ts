import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import {
  markHospitalitySupplierReservationProviderRequestStarted,
} from './hospitality-supplier-reservation-attempt-recovery-service.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  claimHospitalitySupplierReservationRecoveryWrite,
  settleHospitalitySupplierReservationRecoveryWrite,
} from './hospitality-supplier-reservation-recovery-write-service.ts';
import type { HospitalitySupplierReservationTravelerPayloadInput } from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  hospitalitySupplierReservationTravelerPayloadFingerprint,
  normalizeHospitalitySupplierReservationTravelerPayload,
} from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  normalizeTravelportStaysReservationExpectation,
} from './travelport-stays-reservation-identity.ts';
import {
  createTravelportStaysReservationSyncProviderObservation,
} from './travelport-stays-reservation-sync-observability.ts';

const PRE_PROVIDER_EXECUTION_FAILURE_CODE = 'PRE_PROVIDER_EXECUTION_FAILED';

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function preProviderFailureCode(error: unknown) {
  return error instanceof HospitalitySupplierProviderError
    ? error.code
    : PRE_PROVIDER_EXECUTION_FAILURE_CODE;
}

function assertExecutionIntegrationStillMatches(
  integration: Readonly<{
    id: string;
    providerCode: string;
    credentialVersion: number;
    capabilities: readonly string[];
  }>,
  reservation: Readonly<{
    integrationId: string;
    providerCode: string;
    integrationCredentialVersion: number;
  }>,
) {
  if (
    integration.id !== reservation.integrationId
    || integration.providerCode !== reservation.providerCode
    || integration.credentialVersion !== reservation.integrationCredentialVersion
    || !integration.capabilities.includes('reservation')
  ) {
    throw new HospitalitySupplierReservationConflictError(
      'Supplier integration changed after recovery was claimed. Review the supplier reservation before recovery.',
    );
  }
}

async function settlePreProviderFailure(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  error: unknown;
}>) {
  return settleHospitalitySupplierReservationRecoveryWrite({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    attemptId: input.attemptId,
    outcome: {
      status: 'FAILED',
      failureCode: preProviderFailureCode(input.error),
      retryable: true,
    },
  });
}

/**
 * Server-only Travelport Booking.com Sync orchestration.
 *
 * This remains intentionally unexposed. It requires the crash-safe recovery evidence from the
 * original create response, rebinds the traveler fingerprint, and treats Sync as its own external
 * write with a durable provider-request marker. No card/payment material is accepted here.
 */
export async function syncTravelportStaysBookingDotComReservation(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
}>) {
  const traveler = normalizeHospitalitySupplierReservationTravelerPayload(input.traveler);
  const reservationPayloadFingerprint = hospitalitySupplierReservationTravelerPayloadFingerprint(traveler);

  const claim = await claimHospitalitySupplierReservationRecoveryWrite({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    reservationPayloadFingerprint,
  });

  if (claim.reservation.providerCode !== 'travelport-stays') {
    await settlePreProviderFailure({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      error: new HospitalitySupplierProviderError(
        'INVALID_REQUEST',
        'Supplier recovery write is not a Travelport Stays reservation.',
      ),
    });
    throw new HospitalitySupplierReservationConflictError(
      'Supplier reservation recovery authority does not belong to Travelport Stays.',
    );
  }

  let execution: Awaited<ReturnType<typeof loadTravelportStaysIntegration>>;
  let expectedReservation;
  try {
    execution = await loadTravelportStaysIntegration(input.organizationId);
    assertExecutionIntegrationStillMatches(execution.integration, claim.reservation);
    expectedReservation = normalizeTravelportStaysReservationExpectation({
      supplierPropertyReference: claim.reservation.supplierPropertyReference,
      arrivalDateLocal: dateOnly(claim.reservation.arrivalDate),
      departureDateLocal: dateOnly(claim.reservation.departureDate),
      rooms: claim.reservation.rooms,
      adults: claim.reservation.adults,
      childAges: claim.reservation.childAges,
    });
  } catch (error) {
    await settlePreProviderFailure({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      error,
    });
    throw error;
  }

  const supplierConfirmationReference = claim.reservation.supplierConfirmationReference;
  const providerRecoveryReference = claim.reservation.providerRecoveryReference;
  if (!supplierConfirmationReference || !providerRecoveryReference) {
    await settlePreProviderFailure({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      error: new HospitalitySupplierProviderError(
        'INVALID_REQUEST',
        'Travelport Sync recovery evidence is incomplete.',
      ),
    });
    throw new HospitalitySupplierReservationConflictError(
      'Travelport Sync recovery evidence is incomplete.',
    );
  }

  let providerRequestStarted = false;
  let observation: ReturnType<typeof createTravelportStaysReservationSyncProviderObservation> | null = null;
  let outcome;
  try {
    outcome = await execution.reservationSyncExecutor.syncReservation({
      requestCorrelationId: claim.attempt.id,
      providerRecoveryReference,
      supplierConfirmationReference,
      traveler,
      expectedReservation,
      beforeProviderRequest: async () => {
        await markHospitalitySupplierReservationProviderRequestStarted({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          reservationId: input.reservationId,
          attemptId: claim.attempt.id,
        });
        providerRequestStarted = true;
        observation = createTravelportStaysReservationSyncProviderObservation({
          requestCorrelationId: claim.attempt.id,
          organizationId: input.organizationId,
        });
      },
    });
  } catch (error) {
    if (!providerRequestStarted) {
      await settlePreProviderFailure({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reservationId: input.reservationId,
        attemptId: claim.attempt.id,
        error,
      });
      throw error;
    }

    observation?.finish('AMBIGUOUS');
    return settleHospitalitySupplierReservationRecoveryWrite({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'INVALID_RESPONSE',
      },
    });
  }

  if (!providerRequestStarted) {
    await markHospitalitySupplierReservationProviderRequestStarted({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
    });
    observation = createTravelportStaysReservationSyncProviderObservation({
      requestCorrelationId: claim.attempt.id,
      organizationId: input.organizationId,
    });
    observation.finish('AMBIGUOUS');
    return settleHospitalitySupplierReservationRecoveryWrite({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: {
        status: 'AMBIGUOUS',
        failureCode: 'INVALID_RESPONSE',
      },
    });
  }

  observation?.finish(outcome.status);
  if (outcome.status === 'CONFIRMED') {
    return settleHospitalitySupplierReservationRecoveryWrite({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome,
    });
  }
  return settleHospitalitySupplierReservationRecoveryWrite({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    attemptId: claim.attempt.id,
    outcome: {
      status: 'AMBIGUOUS',
      failureCode: outcome.failureCode,
      providerCorrelationId: outcome.providerCorrelationId,
    },
  });
}
