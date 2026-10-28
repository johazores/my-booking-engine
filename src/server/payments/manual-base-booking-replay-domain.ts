export type ManualBaseBookingReplayEvidence = Readonly<{
  bookingId: string;
  commercialAmendmentId: string | null;
  kind: string;
  status: string;
  providerCode: string;
  providerReference: string;
  amountMinor: bigint;
}>;

export function matchesManualBaseBookingReplay(input: Readonly<{
  existing: ManualBaseBookingReplayEvidence;
  bookingId: string;
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  providerCode: string;
  reference: string;
  requestedAmountMinor?: bigint | null;
}>): boolean {
  const { existing } = input;
  return existing.bookingId === input.bookingId
    && existing.commercialAmendmentId === null
    && existing.kind === input.kind
    && existing.status === 'SUCCEEDED'
    && existing.providerCode === input.providerCode
    && existing.providerReference === input.reference
    && (input.requestedAmountMinor == null || existing.amountMinor === input.requestedAmountMinor);
}
