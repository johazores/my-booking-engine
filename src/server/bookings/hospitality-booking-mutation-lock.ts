export function hospitalityBookingMutationLockKey(input: {
  organizationId: string;
  bookingId: string;
}) {
  // Keep this namespace aligned with the established payment booking lock so
  // lifecycle, commercial, and payment-state writes cannot race each other.
  return `payment:${input.organizationId}:booking:${input.bookingId}`;
}
