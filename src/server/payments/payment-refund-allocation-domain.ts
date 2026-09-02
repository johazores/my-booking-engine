import type { BookingSettlementSource } from './payment-settlement-domain.ts';

export type BookingRefundSourceAllocation = Readonly<
  | {
    allocated: true;
    providerCode: string;
    providerReference: string;
    sourceKind: BookingSettlementSource['kind'];
    currency: string;
    sourceRefundableMinor: bigint;
    bookingRefundableMinor: bigint;
    refundableSourceCount: number;
  }
  | {
    allocated: false;
    reason: string;
  }
>;

type BookingRefundSourceAllocationInput = Readonly<{
  sources: readonly BookingSettlementSource[];
}>;

function sourceKey(source: BookingSettlementSource) {
  return `${source.providerCode}\u001f${source.providerReference}`;
}

export function deriveNextBookingRefundSource(
  input: BookingRefundSourceAllocationInput,
): BookingRefundSourceAllocation {
  const seenSources = new Set<string>();
  for (const source of input.sources) {
    if (
      !source.providerCode.trim()
      || !source.providerReference.trim()
      || !source.currency.trim()
      || source.amountMinor <= 0n
      || source.refundedMinor < 0n
      || source.remainingMinor < 0n
      || source.refundedMinor + source.remainingMinor !== source.amountMinor
    ) {
      return {
        allocated: false,
        reason: 'Settlement source balances are inconsistent. Reconcile payment history before refunding.',
      };
    }
    const key = sourceKey(source);
    if (seenSources.has(key)) {
      return {
        allocated: false,
        reason: 'Settlement sources contain duplicate provider references. Reconcile payment history before refunding.',
      };
    }
    seenSources.add(key);
  }

  const refundableSources = input.sources.filter((source) => source.remainingMinor > 0n);
  if (refundableSources.length === 0) {
    return { allocated: false, reason: 'This booking payment has no remaining refundable balance.' };
  }

  const providers = new Set(refundableSources.map((source) => source.providerCode));
  if (providers.size !== 1) {
    return {
      allocated: false,
      reason: 'Refundable money spans multiple payment providers. Reconcile payment history before refunding.',
    };
  }

  const currencies = new Set(refundableSources.map((source) => source.currency));
  if (currencies.size !== 1) {
    return {
      allocated: false,
      reason: 'Refundable money spans multiple currencies. Reconcile payment history before refunding.',
    };
  }

  const ordered = [...refundableSources].sort((left, right) => {
    if (left.remainingMinor !== right.remainingMinor) {
      return left.remainingMinor > right.remainingMinor ? -1 : 1;
    }
    const providerOrder = left.providerCode.localeCompare(right.providerCode);
    if (providerOrder !== 0) return providerOrder;
    return left.providerReference.localeCompare(right.providerReference);
  });
  const source = ordered[0]!;

  return {
    allocated: true,
    providerCode: source.providerCode,
    providerReference: source.providerReference,
    sourceKind: source.kind,
    currency: source.currency,
    sourceRefundableMinor: source.remainingMinor,
    bookingRefundableMinor: refundableSources.reduce((total, item) => total + item.remainingMinor, 0n),
    refundableSourceCount: refundableSources.length,
  };
}
