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
