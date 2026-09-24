const INTERNAL_CLAIM_REFERENCE = /^sf_claim_[0-9a-f]{64}$/;

export type HospitalityFrozenCancellationRefundAuthority = Readonly<{
  refundTransactionId: string;
  refundOrdinal: string;
  amountMinor: string;
  createdAt: string;
}>;

export type HospitalityFrozenCancellationRefundTransaction = Readonly<{
  id: string;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId: string | null;
  kind: string;
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

export class HospitalityFrozenCancellationRefundAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityFrozenCancellationRefundAuthorityError';
  }
}

function fail(message: string): never {
  throw new HospitalityFrozenCancellationRefundAuthorityError(message);
}

function validTime(value: Date | string, label: string) {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(time)) fail(`${label} is invalid.`);
  return time;
}

function positiveAmount(value: string, label: string) {
  if (!/^[1-9]\d*$/.test(value)) fail(`${label} is invalid.`);
  return BigInt(value);
}

export function validateHospitalityFrozenCancellationRefundAuthorities(input: Readonly<{
  organizationId: string;
  bookingId: string;
  predecessorIssuedAt: Date | string;
  issuedAt: Date | string;
  expectedTotalMinor: bigint;
  frozen: readonly HospitalityFrozenCancellationRefundAuthority[];
  current: readonly HospitalityFrozenCancellationRefundTransaction[];
}>) {
  const predecessorIssuedAt = validTime(input.predecessorIssuedAt, 'predecessorIssuedAt');
  const issuedAt = validTime(input.issuedAt, 'issuedAt');
  if (issuedAt < predecessorIssuedAt) {
    fail('Cancellation refund authority issue chronology is invalid.');
  }
  if (input.expectedTotalMinor <= 0n) {
    fail('Cancellation refund authority expected total must be positive.');
  }
  if (input.frozen.length === 0 || input.current.length !== input.frozen.length) {
    fail('Cancellation refund authority count no longer matches immutable issue-time evidence.');
  }

  const currentById = new Map<string, HospitalityFrozenCancellationRefundTransaction>();
  for (const row of input.current) {
    if (currentById.has(row.id)) {
      fail('Cancellation refund authority contains duplicate current transaction identity.');
    }
    currentById.set(row.id, row);
  }

  const frozenIds = new Set<string>();
  let totalMinor = 0n;
  for (let index = 0; index < input.frozen.length; index += 1) {
    const frozen = input.frozen[index]!;
    if (frozenIds.has(frozen.refundTransactionId)) {
      fail('Cancellation refund authority contains duplicate immutable transaction identity.');
    }
    frozenIds.add(frozen.refundTransactionId);
    if (frozen.refundOrdinal !== String(index + 1)) {
      fail('Cancellation refund authority ordinals are not contiguous and ordered.');
    }

    const amountMinor = positiveAmount(frozen.amountMinor, 'Cancellation refund authority amount');
    const createdAt = validTime(frozen.createdAt, 'Cancellation refund authority createdAt');
    if (createdAt <= predecessorIssuedAt || createdAt > issuedAt) {
      fail('Cancellation refund authority chronology no longer matches immutable issue-time evidence.');
    }

    const row = currentById.get(frozen.refundTransactionId);
    if (
      !row
      || row.organizationId !== input.organizationId
      || row.bookingId !== input.bookingId
      || row.commercialAmendmentId !== null
      || row.kind !== 'REFUND'
      || row.currency !== 'AUD'
      || row.amountMinor !== amountMinor
      || row.createdAt.getTime() !== createdAt
      || !row.providerCode.trim()
      || !row.providerReference.trim()
      || INTERNAL_CLAIM_REFERENCE.test(row.providerReference)
      || !row.sourceProviderReference?.trim()
      || INTERNAL_CLAIM_REFERENCE.test(row.sourceProviderReference)
    ) {
      fail('Cancellation refund authority no longer matches its immutable transaction identity and money evidence.');
    }

    // Provider lifecycle status is deliberately not historical legal authority here.
    // Current status drift is reported by tax-document reconciliation.
    totalMinor += amountMinor;
  }

  if (totalMinor !== input.expectedTotalMinor) {
    fail('Cancellation refund authority total no longer matches immutable issue-time evidence.');
  }

  return Object.freeze({
    refundCount: input.frozen.length,
    refundTotalMinor: totalMinor,
  });
}
