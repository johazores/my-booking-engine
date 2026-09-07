import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import {
  markHospitalitySupplierReservationProviderRequestStarted,
} from './hospitality-supplier-reservation-attempt-recovery-service.ts';
import {
  reviewAndClaimHospitalitySupplierReservationSubmission,
} from './hospitality-supplier-reservation-authority-service.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  settleHospitalitySupplierReservationSubmission,
  type HospitalitySupplierReservationSubmissionOutcome,
} from './hospitality-supplier-reservation-service.ts';
import type { HospitalitySupplierReservationTravelerPayloadInput } from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  createTravelportStaysReservationCreateProviderObservation,
  type TravelportStaysReservationCreateProviderResult,
} from './travelport-stays-reservation-create-observability.ts';
import type { TravelportStaysSensitiveReservationPaymentCard } from './travelport-stays-reservation-create-executor.ts';
import {
  normalizeTravelportStaysReservationExpectation,
} from './travelport-stays-reservation-identity.ts';
import {
  travelportStaysCreateOutcomeToSubmissionOutcome,
} from './travelport-stays-reservation-submission-outcome.ts';

const PRE_PROVIDER_EXECUTION_FAILURE_CODE = 'PRE_PROVIDER_EXECUTION_FAILED';

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
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
      'Supplier integration changed after the create attempt was claimed. Review the supplier offer and terms again.',
    );
  }
}

function preProviderFailureCode(error: unknown) {
  return error instanceof HospitalitySupplierProviderError
    ? error.code
    : PRE_PROVIDER_EXECUTION_FAILURE_CODE;
}

async function settlePreProviderFailure(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  error: unknown;
}>) {
  return settleHospitalitySupplierReservationSubmission({
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

function postProviderUnexpectedOutcome(): HospitalitySupplierReservationSubmissionOutcome {
  return Object.freeze({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
  });
}

function observationResult(status: 'CONFIRMED' | 'AMBIGUOUS' | 'REVIEW_REQUIRED'):
TravelportStaysReservationCreateProviderResult {
  return status;
}

/**
 * Server-only orchestration for the currently implemented single-room Travelport create path.
 *
 * This is deliberately not exposed by a route/action and does not establish a PCI-safe card
 * collection source. Sensitive card material is accepted only as an ephemeral adapter input and
 * is never added to the supplier operation ledger, audits, or structured provider observations.
 */
export async function createTravelportStaysReservationWithSensitivePaymentCard(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  traveler: HospitalitySupplierReservationTravelerPayloadInput;
  paymentCard: TravelportStaysSensitiveReservationPaymentCard;
}>) {
  const reviewed = await reviewAndClaimHospitalitySupplierReservationSubmission({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    traveler: input.traveler,
  });

  const claim = reviewed.claim;
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

  let providerRequestStarted = false;
  const observationState: { current: ReturnType<typeof createTravelportStaysReservationCreateProviderObservation> | null } = { current: null };
  let createOutcome;
  try {
    createOutcome = await execution.reservationCreateExecutor.createReservation({
      requestCorrelationId: claim.attempt.id,
      requestMaterial: reviewed.createRequestMaterial,
      paymentAuthority: reviewed.submissionAuthority.paymentAuthority,
      paymentCard: input.paymentCard,
      expectedReservation,
      beforeProviderRequest: async () => {
        await markHospitalitySupplierReservationProviderRequestStarted({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          reservationId: input.reservationId,
          attemptId: claim.attempt.id,
        });
        providerRequestStarted = true;
        observationState.current = createTravelportStaysReservationCreateProviderObservation({
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

    observationState.current?.finish('AMBIGUOUS');
    return settleHospitalitySupplierReservationSubmission({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId: claim.attempt.id,
      outcome: postProviderUnexpectedOutcome(),
    });
  }

  observationState.current?.finish(observationResult(createOutcome.status));
  const settlement = travelportStaysCreateOutcomeToSubmissionOutcome(createOutcome);
  return settleHospitalitySupplierReservationSubmission({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    attemptId: claim.attempt.id,
    outcome: settlement,
  });
}
