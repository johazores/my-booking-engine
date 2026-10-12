/**
 * Reconcile retained post-apply refund source order independently of final
 * balances. The history cursor is ordered by UUID, not transaction time.
 */
export type EffectiveRefundOrderEvidence = Readonly<{
  sourceLedger: 'BOOKING_PRICE' | 'COMMERCIAL_AMENDMENT';
  amountMinor: bigint;
  createdAt: Date;
}>;

export function validateRentalEffectiveRefundSourceOrder(input: Readonly<{
  direction: 'ADDITIONAL_CHARGE' | 'REFUND';
  deltaMinor: bigint;
  rows: readonly EffectiveRefundOrderEvidence[];
}>): string | null {
  if ((input.direction !== 'ADDITIONAL_CHARGE' && input.direction !== 'REFUND')
    || typeof input.deltaMinor !== 'bigint' || input.deltaMinor <= 0n
    || !Array.isArray(input.rows)) {
    return 'Post-apply rental refund ordering has invalid amendment authority.';
  }
  for (const row of input.rows) {
    if (!row || typeof row !== 'object'
      || (row.sourceLedger !== 'BOOKING_PRICE' && row.sourceLedger !== 'COMMERCIAL_AMENDMENT')
      || typeof row.amountMinor !== 'bigint' || row.amountMinor <= 0n
      || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) {
      return 'Post-apply rental refund ordering has malformed retained evidence.';
    }
  }
  if (input.direction === 'REFUND') {
    return input.rows.some((row) => row.sourceLedger === 'COMMERCIAL_AMENDMENT')
      ? 'Post-apply decrease amendment cannot retain amendment-charge refund evidence.'
      : null;
  }

  const chronological = [...input.rows].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime());
  let amendmentChargeRefundedMinor = 0n;
  for (let index = 0; index < chronological.length;) {
    const timestamp = chronological[index].createdAt.getTime();
    let hasBookingPriceRefund = false;
    // Prisma Date values have millisecond precision. Treat same-millisecond
    // refunds as a group; the PostgreSQL insert trigger guards actual write order.
    while (index < chronological.length && chronological[index].createdAt.getTime() === timestamp) {
      const row = chronological[index];
      if (row.sourceLedger === 'COMMERCIAL_AMENDMENT') {
        amendmentChargeRefundedMinor += row.amountMinor;
      } else {
        hasBookingPriceRefund = true;
      }
      index += 1;
    }
    if (amendmentChargeRefundedMinor > input.deltaMinor) {
      return 'Post-apply amendment-charge refunds exceed the retained adjustment.';
    }
    if (hasBookingPriceRefund && amendmentChargeRefundedMinor !== input.deltaMinor) {
      return 'Post-apply booking-price refunds predate full refund of the amendment charge.';
    }
  }
  return null;
}
