const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

export class RentalBookingValidationError extends Error {}

export type RentalBookingConfirmationInput = Readonly<{
  holdId: string;
  customerId: string;
  idempotencyKey: string;
  authorityFingerprint: string;
}>;

export function normalizeRentalBookingConfirmationInput(input: RentalBookingConfirmationInput) {
  const holdId = input.holdId.trim();
  const customerId = input.customerId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const authorityFingerprint = input.authorityFingerprint.trim().toLowerCase();

  if (!holdId) throw new RentalBookingValidationError('Rental hold is required.');
  if (!customerId) throw new RentalBookingValidationError('Rental customer is required.');
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new RentalBookingValidationError(
      'Idempotency key must be 8-120 letters, numbers, dots, underscores, colons, or hyphens.',
    );
  }
  if (!FINGERPRINT_PATTERN.test(authorityFingerprint)) {
    throw new RentalBookingValidationError('Rental booking authority fingerprint is invalid.');
  }

  return Object.freeze({ holdId, customerId, idempotencyKey, authorityFingerprint });
}

export function rentalBookingConfirmationPayloadMatches(input: Readonly<{
  booking: {
    holdId: string;
    customerId: string;
    authorityFingerprint: string;
  };
  requested: {
    holdId: string;
    customerId: string;
    authorityFingerprint: string;
  };
}>) {
  return input.booking.holdId === input.requested.holdId
    && input.booking.customerId === input.requested.customerId
    && input.booking.authorityFingerprint === input.requested.authorityFingerprint;
}
