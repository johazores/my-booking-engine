import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import { hospitalitySupplierReservationReviewAcceptanceRequirements } from './hospitality-supplier-reservation-review-acceptance.ts';

export type HospitalitySupplierReservationReviewAttemptAuthorityInput = Readonly<{
  reservation: Readonly<{
    status: string;
    attemptCount: number;
    lastFailureCode: string | null;
  }>;
  attempt: Readonly<{
    sequence: number;
    kind: string;
    status: string;
    normalizedFailureCode: string | null;
    providerRequestStartedAt: Date | null;
    completedAt: Date | null;
  }> | null;
}>;

function conflict(message: string): never {
  throw new HospitalitySupplierReservationConflictError(message);
}

function validDate(value: Date | null) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function assertHospitalitySupplierReservationReviewAttemptAuthority(
  input: HospitalitySupplierReservationReviewAttemptAuthorityInput,
) {
  if (input.reservation.status !== 'REVIEW_REQUIRED') {
    conflict('Supplier reservation is not waiting for a durable commercial review attempt.');
  }
  if (!Number.isSafeInteger(input.reservation.attemptCount) || input.reservation.attemptCount < 1) {
    conflict('Supplier reservation review attempt sequence is invalid.');
  }

  const requirements = hospitalitySupplierReservationReviewAcceptanceRequirements(input.reservation.lastFailureCode);
  const attempt = input.attempt;
  if (
    !attempt
    || attempt.sequence !== input.reservation.attemptCount
    || attempt.kind !== 'CREATE'
    || attempt.status !== 'REVIEW_REQUIRED'
    || attempt.normalizedFailureCode !== requirements.reason
    || !validDate(attempt.providerRequestStartedAt)
    || !validDate(attempt.completedAt)
  ) {
    conflict('Supplier reservation review is missing matching durable provider-write evidence.');
  }
  return requirements;
}
