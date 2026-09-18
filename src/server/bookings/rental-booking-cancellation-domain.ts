export const RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH = 1000;

export class RentalBookingCancellationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingCancellationValidationError';
  }
}

export function normalizeRentalBookingCancellationReason(value: unknown) {
  if (typeof value !== 'string') {
    throw new RentalBookingCancellationValidationError('Rental booking cancellation reason is required.');
  }
  const reason = value.trim().replace(/\s+/g, ' ');
  if (!reason) {
    throw new RentalBookingCancellationValidationError('Rental booking cancellation reason is required.');
  }
  if (reason.length > RENTAL_BOOKING_CANCELLATION_REASON_MAX_LENGTH) {
    throw new RentalBookingCancellationValidationError('Rental booking cancellation reason is too long.');
  }
  return reason;
}

export type RentalBookingCancellationReplayEvidence = Readonly<{
  status: 'CANCELLED';
  cancelledAt: string;
  cancellationReason: string;
  allocationId: string;
  inventoryProtectionReleased: true;
}>;

export type RentalBookingCancellationReplayDisposition =
  | 'MATCH'
  | 'REASON_MISMATCH'
  | 'EVIDENCE_MISMATCH';

function readRentalBookingCancellationReplayEvidence(value: unknown): RentalBookingCancellationReplayEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.status !== 'CANCELLED'
    || typeof candidate.cancelledAt !== 'string'
    || typeof candidate.cancellationReason !== 'string'
    || typeof candidate.allocationId !== 'string'
    || candidate.inventoryProtectionReleased !== true
  ) return null;

  try {
    if (normalizeRentalBookingCancellationReason(candidate.cancellationReason) !== candidate.cancellationReason) {
      return null;
    }
  } catch {
    return null;
  }

  return Object.freeze({
    status: 'CANCELLED',
    cancelledAt: candidate.cancelledAt,
    cancellationReason: candidate.cancellationReason,
    allocationId: candidate.allocationId,
    inventoryProtectionReleased: true,
  });
}

export function classifyRentalBookingCancellationReplayEvidence(input: Readonly<{
  afterData: unknown;
  cancellationReason: string;
  cancelledAt: string;
  allocationId: string;
}>): RentalBookingCancellationReplayDisposition {
  const evidence = readRentalBookingCancellationReplayEvidence(input.afterData);
  if (
    !evidence
    || evidence.cancelledAt !== input.cancelledAt
    || evidence.allocationId !== input.allocationId
  ) return 'EVIDENCE_MISMATCH';
  if (evidence.cancellationReason !== input.cancellationReason) return 'REASON_MISMATCH';
  return 'MATCH';
}
