import { randomUUID } from 'node:crypto';

import { loadTravelportStaysIntegration } from '../integrations/travelport-stays-integration.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import {
  consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest,
} from './hospitality-supplier-reservation-review-consumption-service.ts';
import {
  recordHospitalitySupplierReservationProviderRecoveryEvidence,
} from './hospitality-supplier-reservation-recovery-evidence-service.ts';
import {
  settleHospitalitySupplierReservationReviewRequired,
} from './hospitality-supplier-reservation-review-service.ts';
import {
  settleHospitalitySupplierReservationSubmission,
  type HospitalitySupplierReservationSubmissionOutcome,
} from './hospitality-supplier-reservation-service.ts';
import {
  createTravelportStaysReservationCreateProviderObservation,
  type TravelportStaysReservationCreateProviderResult,
} from './travelport-stays-reservation-create-observability.ts';
import type { TravelportStaysSensitiveReservationPaymentCard } from './travelport-stays-reservation-create-executor.ts';
import { buildTravelportStaysReservationCreateRequestMaterial } from './travelport-stays-reservation-create-request-material.ts';
import {
  normalizeTravelportStaysReservationExpectation,
} from './travelport-stays-reservation-identity.ts';
import {
  reviewTravelportStaysReservationAcceptedCommercialAuthority,
} from './travelport-stays-reservation-review-consumption-authority-service.ts';
import {
  travelportStaysCreateOutcomeToSubmissionOutcome,
} from './travelport-stays-reservation-submission-outcome.ts';
import type { HospitalitySupplierReservationTravelerPayloadInput } from './hospitality-supplier-reservation-traveler-authority.ts';

const REVIEW_FAILURE_CODES = Object.freeze({
  PRICE_CHANGED: 'SUPPLIER_PRICE_CHANGED',
  GUARANTEE_CHANGED: 'SUPPLIER_GUARANTEE_CHANGED',
  PRICE_AND_GUARANTEE_CHANGED: 'SUPPLIER_PRICE_AND_GUARANTEE_CHANGED',
} as const);

function conflict(message: string): never {
  throw new HospitalitySupplierReservationConflictError(message);
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function assertExecutionIntegrationStillMatches(
  integration: Readonly<{
    id: string;
    providerCode: string;
    credentialVersion: number;
    capabilities: readonly string[];
    status?: string;
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
    || (integration.status !== undefined && integration.status !== 'ACTIVE')
    || !integration.capabilities.includes('reservation')
  ) {
    conflict('Supplier integration changed after the accepted commercial review was revalidated.');
  }
}

function postProviderUnexpectedOutcome(): HospitalitySupplierReservationSubmissionOutcome {
  return Object.freeze({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
  });
}

function observationResult(status: 'CONFIRMED' | 'FAILED' | 'AMBIGUOUS' | 'REVIEW_REQUIRED'):
TravelportStaysReservationCreateProviderResult {
  return status;
}

/**
 * Server-only one-time second-sell path after an explicit Travelport commercial-review decision.
 *
 * The accepted decision remains REVIEW_REQUIRED until request composition and OAuth finish. The
 * executor callback then atomically archives the decision, creates the next CREATE attempt, clears
 * the active acceptance fields, and sets providerRequestStartedAt immediately before the POST.
 * Sensitive card material remains ephemeral and is never persisted or audited by this workflow.
 */
export async function createTravelportStaysReservationAfterAcceptedCommercialReviewWithSensitivePaymentCard(
  input: Readonly<{
    organizationId: string;
    actorUserId: string;
    reservationId: string;
    traveler: HospitalitySupplierReservationTravelerPayloadInput;
    paymentCard: TravelportStaysSensitiveReservationPaymentCard;
    expectedAcceptanceFingerprint: unknown;
  }>,
) {
  const reviewed = await reviewTravelportStaysReservationAcceptedCommercialAuthority({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    traveler: input.traveler,
    expectedAcceptanceFingerprint: input.expectedAcceptanceFingerprint,
  });

  let createRequestMaterial;
  try {
    createRequestMaterial = buildTravelportStaysReservationCreateRequestMaterial({
      providerSubmissionReference: reviewed.providerSubmissionReference,
      traveler: reviewed.travelerAuthority,
      paymentAuthority: reviewed.paymentAuthority,
    });
  } catch (error) {
    if (!(error instanceof HospitalitySupplierProviderError)) throw error;
    conflict('Fresh reviewed reservation authority cannot be submitted to Travelport. Review the supplier offer again.');
  }

  const attemptId = randomUUID();
  const execution = await loadTravelportStaysIntegration(input.organizationId);
  assertExecutionIntegrationStillMatches(execution.integration, reviewed.reservation);
  const expectedReservation = normalizeTravelportStaysReservationExpectation({
    supplierPropertyReference: reviewed.reservation.supplierPropertyReference,
    arrivalDateLocal: dateOnly(reviewed.reservation.arrivalDate),
    departureDateLocal: dateOnly(reviewed.reservation.departureDate),
    rooms: reviewed.reservation.rooms,
    adults: reviewed.reservation.adults,
    childAges: reviewed.reservation.childAges,
  });
  const acceptedReview = Object.freeze({
    acceptPriceChange: reviewed.storedAcceptance.acceptance.acceptPriceChange,
    acceptGuaranteeChange: reviewed.storedAcceptance.acceptance.acceptGuaranteeChange,
  });

  let providerRequestStarted = false;
  const observationState: {
    current: ReturnType<typeof createTravelportStaysReservationCreateProviderObservation> | null;
  } = { current: null };
  let createOutcome;
  try {
    createOutcome = await execution.reservationCreateExecutor.createReservationAfterAcceptedReview({
      requestCorrelationId: attemptId,
      requestMaterial: createRequestMaterial,
      paymentAuthority: reviewed.paymentAuthority,
      paymentCard: input.paymentCard,
      expectedReservation,
      acceptedReview,
      beforeProviderRequest: async () => {
        const consumed = await consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          reservationId: input.reservationId,
          attemptId,
          expectedAcceptanceFingerprint: reviewed.storedAcceptance.acceptance.acceptanceFingerprint,
        });
        if (consumed.attempt.id !== attemptId) {
          conflict('Supplier reservation reviewed provider-request attempt identity changed unexpectedly.');
        }
        providerRequestStarted = true;
        observationState.current = createTravelportStaysReservationCreateProviderObservation({
          requestCorrelationId: attemptId,
          organizationId: input.organizationId,
        });
      },
    });
  } catch (error) {
    if (!providerRequestStarted) throw error;
    observationState.current?.finish('AMBIGUOUS');
    return settleHospitalitySupplierReservationSubmission({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId,
      outcome: postProviderUnexpectedOutcome(),
    });
  }

  if (!providerRequestStarted) {
    conflict('Travelport reviewed Create returned without durable reviewed provider-request evidence.');
  }

  if (
    createOutcome.status === 'AMBIGUOUS'
    && createOutcome.providerRecoveryReference
    && createOutcome.supplierConfirmationReference
  ) {
    try {
      await recordHospitalitySupplierReservationProviderRecoveryEvidence({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reservationId: input.reservationId,
        attemptId,
        supplierConfirmationReference: createOutcome.supplierConfirmationReference,
        providerRecoveryReference: createOutcome.providerRecoveryReference,
      });
    } catch {
      observationState.current?.finish('AMBIGUOUS');
      return settleHospitalitySupplierReservationSubmission({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reservationId: input.reservationId,
        attemptId,
        outcome: postProviderUnexpectedOutcome(),
      });
    }
  }

  observationState.current?.finish(observationResult(createOutcome.status));
  if (createOutcome.status === 'REVIEW_REQUIRED') {
    return settleHospitalitySupplierReservationReviewRequired({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reservationId: input.reservationId,
      attemptId,
      failureCode: REVIEW_FAILURE_CODES[createOutcome.reason],
      providerCorrelationId: createOutcome.providerCorrelationId,
    });
  }

  const settlement = travelportStaysCreateOutcomeToSubmissionOutcome(createOutcome);
  // One accepted decision is single-use. Even a definitive provider failure after consumption
  // cannot become normal retry authority because a retry would either omit the reviewed flags or
  // silently reuse commercial consent that was already bound to this exact provider attempt.
  const reviewedSettlement = settlement.status === 'FAILED'
    ? Object.freeze({ ...settlement, retryable: false })
    : settlement;
  return settleHospitalitySupplierReservationSubmission({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    reservationId: input.reservationId,
    attemptId,
    outcome: reviewedSettlement,
  });
}
