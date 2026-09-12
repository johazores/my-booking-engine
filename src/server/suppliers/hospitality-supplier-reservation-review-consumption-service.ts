import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import { materializeHospitalitySupplierReservationReviewConsumptionInput } from './hospitality-supplier-reservation-input-authority.ts';
import { assertHospitalitySupplierReservationStoredReviewAcceptance } from './hospitality-supplier-reservation-review-acceptance.ts';
import { assertHospitalitySupplierReservationReviewAttemptAuthority } from './hospitality-supplier-reservation-review-attempt-authority.ts';
import { HospitalitySupplierReservationUnavailableError } from './hospitality-supplier-reservation-service.ts';

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function conflict(message: string): never {
  throw new HospitalitySupplierReservationConflictError(message);
}

async function requireReviewConsumptionAuthority(input: Readonly<{
  organizationId: string;
  actorUserId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'availability:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'pricing:read',
  });
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:manage',
  });
}

function assertIntegrationMatches(
  integration: Readonly<{
    providerCode: string;
    credentialVersion: number;
    capabilities: readonly string[];
    status: string;
  }> | null,
  reservation: Readonly<{
    providerCode: string;
    integrationCredentialVersion: number;
  }>,
) {
  if (
    !integration
    || integration.status !== 'ACTIVE'
    || integration.providerCode !== reservation.providerCode
    || integration.credentialVersion !== reservation.integrationCredentialVersion
    || !integration.capabilities.includes('reservation')
  ) {
    conflict('Supplier integration changed before the accepted commercial review could be consumed.');
  }
}

/**
 * Atomically consume one durable accepted review into exactly one marked CREATE attempt.
 *
 * This function must be called only from the provider executor callback that runs after request
 * composition and OAuth and immediately before the external Create POST. It never accepts card
 * data, provider payloads, or transient submission identifiers.
 */
export async function consumeHospitalitySupplierReservationReviewAcceptanceForProviderRequest(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  reservationId: string;
  attemptId: string;
  expectedAcceptanceFingerprint: unknown;
}>) {
  input = materializeHospitalitySupplierReservationReviewConsumptionInput(input) as typeof input;
  await requireReviewConsumptionAuthority(input);
  assertUuidIdentifier(input.reservationId, 'reservationId');
  assertUuidIdentifier(input.attemptId, 'attemptId');
  if (
    typeof input.expectedAcceptanceFingerprint !== 'string'
    || !FINGERPRINT_PATTERN.test(input.expectedAcceptanceFingerprint)
  ) {
    conflict('Supplier reservation acceptance fingerprint is invalid.');
  }

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supplier-reservation:${input.organizationId}:operation:${input.reservationId}`}, 0))`;

    const reservation = await transaction.hospitalitySupplierReservationOperation.findFirst({
      where: { id: input.reservationId, organizationId: input.organizationId },
    });
    if (!reservation) {
      throw new HospitalitySupplierReservationUnavailableError(
        'Supplier reservation operation is not available in this organization.',
      );
    }

    const stored = assertHospitalitySupplierReservationStoredReviewAcceptance(reservation);
    if (stored.acceptance.acceptanceFingerprint !== input.expectedAcceptanceFingerprint) {
      conflict('Supplier reservation acceptance changed before the reviewed provider request was claimed.');
    }

    const reviewAttempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: {
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence: stored.reviewAttemptSequence,
      },
    });
    const requirements = assertHospitalitySupplierReservationReviewAttemptAuthority({
      reservation,
      attempt: reviewAttempt,
    });
    if (
      requirements.acceptPriceChange !== stored.acceptance.acceptPriceChange
      || requirements.acceptGuaranteeChange !== stored.acceptance.acceptGuaranteeChange
    ) {
      conflict('Supplier reservation review attempt no longer matches its accepted commercial decision.');
    }

    const integration = await transaction.integration.findFirst({
      where: { id: reservation.integrationId, organizationId: input.organizationId },
      select: {
        providerCode: true,
        credentialVersion: true,
        capabilities: true,
        status: true,
      },
    });
    assertIntegrationMatches(integration, reservation);

    const existingAttempt = await transaction.hospitalitySupplierReservationAttempt.findFirst({
      where: { id: input.attemptId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (existingAttempt) {
      conflict('Supplier reservation reviewed provider-request attempt already exists.');
    }

    const [databaseClock] = await transaction.$queryRaw<Array<{ currentTime: Date }>>`SELECT clock_timestamp() AS "currentTime"`;
    if (!databaseClock) conflict('Supplier reservation reviewed provider-request time is unavailable.');
    const providerRequestStartedAt = databaseClock.currentTime;
    const sequence = reservation.attemptCount + 1;

    const attempt = await transaction.hospitalitySupplierReservationAttempt.create({
      data: {
        id: input.attemptId,
        organizationId: input.organizationId,
        reservationId: reservation.id,
        sequence,
        kind: 'CREATE',
        status: 'STARTED',
        startedAt: providerRequestStartedAt,
        leaseStartedAt: providerRequestStartedAt,
        providerRequestStartedAt,
      },
    });

    const acceptanceHistory = await transaction.hospitalitySupplierReservationReviewAcceptanceHistory.create({
      data: {
        organizationId: input.organizationId,
        reservationId: reservation.id,
        reviewAttemptSequence: stored.reviewAttemptSequence,
        acceptedAt: stored.acceptedAt,
        acceptedByUserId: stored.acceptedByUserId,
        reason: stored.acceptance.reason,
        acceptPriceChange: stored.acceptance.acceptPriceChange,
        acceptGuaranteeChange: stored.acceptance.acceptGuaranteeChange,
        currency: stored.acceptance.currency,
        acceptedTotalMinor: stored.acceptance.acceptedTotalMinor,
        acceptedOfferFingerprint: stored.acceptance.acceptedOfferFingerprint,
        acceptedTermsFingerprint: stored.acceptance.acceptedTermsFingerprint,
        acceptedAuthorityFingerprint: stored.acceptance.acceptedAuthorityFingerprint,
        acceptanceFingerprint: stored.acceptance.acceptanceFingerprint,
        consumedAt: providerRequestStartedAt,
        consumedAttemptSequence: sequence,
      },
    });

    const updated = await transaction.hospitalitySupplierReservationOperation.update({
      where: { id: reservation.id, organizationId: input.organizationId },
      data: {
        status: 'SUBMITTING',
        attemptCount: sequence,
        lastAttemptAt: providerRequestStartedAt,
        lastFailureCode: null,
        lastFailureRetryable: null,
        reviewAcceptedAt: null,
        reviewAcceptedByUserId: null,
        reviewAcceptedAttemptSequence: null,
        reviewAcceptedPriceChange: null,
        reviewAcceptedGuaranteeChange: null,
        reviewAcceptedCurrency: null,
        reviewAcceptedTotalMinor: null,
        reviewAcceptedOfferFingerprint: null,
        reviewAcceptedTermsFingerprint: null,
        reviewAcceptedAuthorityFingerprint: null,
        reviewAcceptanceFingerprint: null,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'supplier.reservation-reviewed-provider-request-started',
        resourceType: 'supplier-reservation-operation',
        resourceId: reservation.id,
        afterData: {
          providerCode: reservation.providerCode,
          status: updated.status,
          reviewReason: stored.acceptance.reason,
          acceptedPriceChange: stored.acceptance.acceptPriceChange,
          acceptedGuaranteeChange: stored.acceptance.acceptGuaranteeChange,
          reviewAttemptSequence: stored.reviewAttemptSequence,
          providerAttemptSequence: sequence,
          acceptanceFingerprint: stored.acceptance.acceptanceFingerprint,
        },
      },
    });

    return Object.freeze({
      reservation: updated,
      attempt,
      acceptanceHistory,
    });
  }, { isolationLevel: 'Serializable' });
}
