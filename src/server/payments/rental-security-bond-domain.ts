import { createHash } from 'node:crypto';

export type RentalSecurityBondState = 'REQUIRED' | 'COLLECTED' | 'RELEASED' | 'FORFEITED';

export type RentalSecurityBondTransactionEvidence = Readonly<{
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  status: 'SUCCEEDED';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

export type RentalSecurityBondForfeitureEvidence = Readonly<{
  liabilityDecisionId: string;
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
}>;

export type RentalSecurityBondSettlement = Readonly<
  | {
    reconciled: true;
    state: RentalSecurityBondState;
    collectedMinor: bigint;
    releasedMinor: bigint;
    forfeitedMinor: bigint;
    netHeldMinor: bigint;
    sourceProviderReference: string | null;
  }
  | { reconciled: false; reason: string }
>;

export function deriveRentalSecurityBondSettlement(input: Readonly<{
  requiredAmountMinor: bigint;
  currency: string;
  transactions: readonly RentalSecurityBondTransactionEvidence[];
  forfeiture?: RentalSecurityBondForfeitureEvidence | null;
}>): RentalSecurityBondSettlement {
  if (input.requiredAmountMinor <= 0n) {
    return { reconciled: false, reason: 'Rental security bond requirement must be positive before settlement can be reconciled.' };
  }

  const collections = input.transactions.filter((row) => row.kind === 'OFFLINE_PAYMENT');
  const releases = input.transactions.filter((row) => row.kind === 'REFUND');
  if (collections.length > 1 || releases.length > 1 || input.transactions.length !== collections.length + releases.length) {
    return { reconciled: false, reason: 'Security bond history exceeds the enabled one-collection/one-release contract.' };
  }

  for (const row of input.transactions) {
    if (
      row.status !== 'SUCCEEDED'
      || row.providerCode !== 'manual'
      || row.currency !== input.currency
      || row.amountMinor !== input.requiredAmountMinor
    ) {
      return { reconciled: false, reason: 'Security bond history does not match the enabled full-value manual/offline contract.' };
    }
  }

  const forfeiture = input.forfeiture ?? null;
  if (forfeiture && (
    !forfeiture.liabilityDecisionId
    || forfeiture.currency !== input.currency
    || forfeiture.amountMinor !== input.requiredAmountMinor
  )) {
    return { reconciled: false, reason: 'Security bond forfeiture does not match the retained full-value bond authority.' };
  }

  const collection = collections[0] ?? null;
  const release = releases[0] ?? null;
  if (!collection) {
    if (release || forfeiture) return { reconciled: false, reason: 'Security bond disposition has no retained collection source.' };
    return Object.freeze({
      reconciled: true as const,
      state: 'REQUIRED' as const,
      collectedMinor: 0n,
      releasedMinor: 0n,
      forfeitedMinor: 0n,
      netHeldMinor: 0n,
      sourceProviderReference: null,
    });
  }
  if (collection.sourceProviderReference !== null) {
    return { reconciled: false, reason: 'Security bond collection cannot point at a release source.' };
  }
  if (release && forfeiture) {
    return { reconciled: false, reason: 'Security bond cannot be both released and forfeited.' };
  }
  if (forfeiture) {
    if (forfeiture.createdAt.getTime() < collection.createdAt.getTime()) {
      return { reconciled: false, reason: 'Security bond forfeiture cannot predate retained collection evidence.' };
    }
    return Object.freeze({
      reconciled: true as const,
      state: 'FORFEITED' as const,
      collectedMinor: input.requiredAmountMinor,
      releasedMinor: 0n,
      forfeitedMinor: input.requiredAmountMinor,
      netHeldMinor: 0n,
      sourceProviderReference: collection.providerReference,
    });
  }
  if (!release) {
    return Object.freeze({
      reconciled: true as const,
      state: 'COLLECTED' as const,
      collectedMinor: input.requiredAmountMinor,
      releasedMinor: 0n,
      forfeitedMinor: 0n,
      netHeldMinor: input.requiredAmountMinor,
      sourceProviderReference: collection.providerReference,
    });
  }
  if (
    release.sourceProviderReference !== collection.providerReference
    || release.providerReference === collection.providerReference
    || release.createdAt.getTime() < collection.createdAt.getTime()
  ) {
    return { reconciled: false, reason: 'Security bond release does not reconcile to the retained collection source and chronology.' };
  }
  return Object.freeze({
    reconciled: true as const,
    state: 'RELEASED' as const,
    collectedMinor: input.requiredAmountMinor,
    releasedMinor: input.requiredAmountMinor,
    forfeitedMinor: 0n,
    netHeldMinor: 0n,
    sourceProviderReference: collection.providerReference,
  });
}

export function buildRentalSecurityBondRequirementIdempotencyKey(input: Readonly<{
  bookingId: string;
  currency: string;
  amountMinor: bigint;
}>) {
  const digest = createHash('sha256')
    .update(`${input.bookingId}\u0000${input.currency}\u0000${input.amountMinor.toString()}`, 'utf8')
    .digest('hex');
  return `rental-bond:requirement:${digest.slice(0, 48)}`;
}

export function buildRentalSecurityBondTransactionIdempotencyKey(input: Readonly<{
  kind: 'manual-collection' | 'manual-release';
  bondId: string;
  reference: string;
}>) {
  const digest = createHash('sha256')
    .update(`${input.kind}\u0000${input.bondId}\u0000${input.reference}`, 'utf8')
    .digest('hex');
  return `rental-bond:${input.kind}:${digest.slice(0, 48)}`;
}

export function buildRentalSecurityBondForfeitureIdempotencyKey(input: Readonly<{
  bondId: string;
  liabilityDecisionId: string;
}>) {
  const digest = createHash('sha256')
    .update(`${input.bondId}\u0000${input.liabilityDecisionId}`, 'utf8')
    .digest('hex');
  return `rental-bond:forfeiture:${digest.slice(0, 48)}`;
}

export function buildRentalSecurityBondRequestFingerprint(input: Readonly<{
  organizationId: string;
  bookingId: string;
  bondId: string;
  idempotencyKey: string;
  kind: 'OFFLINE_PAYMENT' | 'REFUND';
  providerCode: string;
  providerReference: string;
  sourceProviderReference: string | null;
  currency: string;
  amountMinor: bigint;
}>) {
  return createHash('sha256')
    .update([
      'rental-security-bond-request-v1',
      input.organizationId,
      input.bookingId,
      input.bondId,
      input.idempotencyKey,
      input.kind,
      input.providerCode,
      input.providerReference,
      input.sourceProviderReference ?? '',
      input.currency,
      input.amountMinor.toString(),
    ].join('\u001f'), 'utf8')
    .digest('hex');
}
