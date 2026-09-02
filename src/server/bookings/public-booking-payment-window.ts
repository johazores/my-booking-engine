const PUBLIC_BOOKING_PAYMENT_START_WINDOW_MINUTES = 15;
const PUBLIC_BOOKING_PAYMENT_START_WINDOW_MS = PUBLIC_BOOKING_PAYMENT_START_WINDOW_MINUTES * 60_000;

export type PublicBookingPaymentProtectionEvidence = Readonly<{
  ownershipCreatedAt: Date;
  openCheckoutExpiresAt?: Date | null;
  unresolvedPaymentCreatedAt?: Date | null;
  hasSuccessfulPayment?: boolean;
}>;

export function publicBookingPaymentStartDeadline(ownershipCreatedAt: Date) {
  return new Date(ownershipCreatedAt.getTime() + PUBLIC_BOOKING_PAYMENT_START_WINDOW_MS);
}

export function publicBookingPaymentStartWindowIsOpen(input: {
  ownershipCreatedAt: Date;
  now: Date;
}) {
  return publicBookingPaymentStartDeadline(input.ownershipCreatedAt) > input.now;
}

export function shouldProtectPendingPublicBookingAllocation(input: PublicBookingPaymentProtectionEvidence & { now: Date }) {
  if (input.hasSuccessfulPayment) return true;
  if (input.openCheckoutExpiresAt && input.openCheckoutExpiresAt > input.now) return true;
  if (publicBookingPaymentStartWindowIsOpen({ ownershipCreatedAt: input.ownershipCreatedAt, now: input.now })) return true;
  if (input.unresolvedPaymentCreatedAt) {
    return publicBookingPaymentStartDeadline(input.unresolvedPaymentCreatedAt) > input.now;
  }
  return false;
}

export { PUBLIC_BOOKING_PAYMENT_START_WINDOW_MINUTES };
