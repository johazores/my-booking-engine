import { createHash } from 'node:crypto';

import { isCanonicalManualPaymentReference } from './manual-payment-provider.ts';

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
      || !isCanonicalManualPaymentReference(row.providerReference)
      || (row.sourceProviderReference !== null && !isCanonicalManualPaymentReference(row.sourceProviderReference))
      || !(row.createdAt instanceof Date)
      || !Number.isFinite(row.createdAt.getTime())
    ) {
      return { reconciled: false, reason: 'Security bond history does not match the enabled full-value manual/offline contract.' };
    }
  }

  const forfeiture = input.forfeiture ?? null;
  if (forfeiture && (
    !forfeiture.liabilityDecisionId
    || forfeiture.currency !== input.currency
    || forfeiture.amountMinor !== input.requiredAmountMinor
    || !(forfeiture.createdAt instanceof Date)
    || !Number.isFinite(forfeiture.createdAt.getTime())
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

/**
 * Rebuild immutable bond requirement identity and chronology before using
 * retained collection or disposition evidence as operational authority.
 * Database constraints enforce the write shape, but readers must not trust
 * an arbitrary persisted requirement idempotency key.
 */
export function isValidRentalSecurityBondRetainedRequirement(input: Readonly<{
  bookingId: string;
  requirement: Readonly<{
    bookingId: string;
    idempotencyKey: string;
    currency: string;
    amountMinor: bigint;
    createdAt: Date;
  }>;
  transactions: readonly Readonly<{ createdAt: Date }>[];
  forfeiture?: Readonly<{ createdAt: Date }> | null;
}>): boolean {
  const requirement = input.requirement;
  if (
    requirement.bookingId !== input.bookingId
    || !/^[A-Z]{3}$/.test(requirement.currency)
    || typeof requirement.amountMinor !== 'bigint'
    || requirement.amountMinor <= 0n
    || !(requirement.createdAt instanceof Date)
    || !Number.isFinite(requirement.createdAt.getTime())
    || requirement.idempotencyKey !== buildRentalSecurityBondRequirementIdempotencyKey({
      bookingId: input.bookingId,
      currency: requirement.currency,
      amountMinor: requirement.amountMinor,
    })
  ) return false;

  const requiredAt = requirement.createdAt.getTime();
  return input.transactions.every((row) => row.createdAt instanceof Date
    && Number.isFinite(row.createdAt.getTime())
    && row.createdAt.getTime() >= requiredAt)
    && (!input.forfeiture || (input.forfeiture.createdAt instanceof Date
      && Number.isFinite(input.forfeiture.createdAt.getTime())
      && input.forfeiture.createdAt.getTime() >= requiredAt));
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

/**
 * Validate retained security-bond transaction identity independently of the
 * fingerprint stored alongside it. Shared by financial and operational
 * readers so one reader cannot trust evidence another rejects.
 */
export function isValidRentalSecurityBondRetainedTransaction(input: Readonly<{
  organizationId: string;
  bookingId: string;
  bondId: string;
  transaction: Readonly<{
    idempotencyKey: string;
    requestFingerprint: string;
    kind: string;
    status: string;
    providerCode: string;
    providerReference: string;
    sourceProviderReference: string | null;
    currency: string;
    amountMinor: bigint;
    createdAt: Date;
  }>;
}>): boolean {
  const row = input.transaction;
  if (
    (row.kind !== 'OFFLINE_PAYMENT' && row.kind !== 'REFUND')
    || row.status !== 'SUCCEEDED'
    || row.providerCode !== 'manual'
    || !isCanonicalManualPaymentReference(row.providerReference)
    || (row.kind === 'OFFLINE_PAYMENT' && row.sourceProviderReference !== null)
    || (row.kind === 'REFUND' && (
      !isCanonicalManualPaymentReference(row.sourceProviderReference)
      || row.sourceProviderReference === row.providerReference
    ))
    || !(row.createdAt instanceof Date)
    || !Number.isFinite(row.createdAt.getTime())
    || typeof row.amountMinor !== 'bigint'
    || row.amountMinor <= 0n
    || !/^[A-Z]{3}$/.test(row.currency)
    || !/^[a-f0-9]{64}$/.test(row.requestFingerprint)
  ) return false;

  const kind = row.kind === 'OFFLINE_PAYMENT' ? 'manual-collection' : 'manual-release';
  if (row.idempotencyKey !== buildRentalSecurityBondTransactionIdempotencyKey({
    kind,
    bondId: input.bondId,
    reference: row.providerReference,
  })) return false;

  return row.requestFingerprint === buildRentalSecurityBondRequestFingerprint({
    organizationId: input.organizationId,
    bookingId: input.bookingId,
    bondId: input.bondId,
    idempotencyKey: row.idempotencyKey,
    kind: row.kind,
    providerCode: row.providerCode,
    providerReference: row.providerReference,
    sourceProviderReference: row.sourceProviderReference,
    currency: row.currency,
    amountMinor: row.amountMinor,
  });
}

/** Verify that forfeiture consumes the exact retained collection and server-derived identity. */
export function isValidRentalSecurityBondRetainedForfeiture(input: Readonly<{
  bondId: string;
  collectionTransactionId: string | null;
  forfeiture: Readonly<{
    liabilityDecisionId: string;
    collectionTransactionId: string;
    idempotencyKey: string;
  }>;
}>): boolean {
  return input.collectionTransactionId !== null
    && input.forfeiture.collectionTransactionId === input.collectionTransactionId
    && input.forfeiture.idempotencyKey === buildRentalSecurityBondForfeitureIdempotencyKey({
      bondId: input.bondId,
      liabilityDecisionId: input.forfeiture.liabilityDecisionId,
    });
}

/**
 * A customer liability decision is downstream of returned custody. Validate
 * this before enabling new forfeiture and when reading retained forfeiture.
 */
export function isValidRentalSecurityBondLiabilityReturnChronology(input: Readonly<{
  liability: Readonly<{ decidedAt: Date }> | null;
  returnEvent: Readonly<{ occurredAt: Date }> | null;
}>): boolean {
  const { liability, returnEvent } = input;
  if (
    !liability || !returnEvent
    || !(liability.decidedAt instanceof Date)
    || !(returnEvent.occurredAt instanceof Date)
  ) return false;

  const decidedAt = liability.decidedAt.getTime();
  const returnedAt = returnEvent.occurredAt.getTime();
  return Number.isFinite(decidedAt)
    && Number.isFinite(returnedAt)
    && returnedAt <= decidedAt;
}

/** Revalidate immutable forfeiture against customer liability and returned custody. */
export function isValidRentalSecurityBondRetainedLiabilityDisposition(input: Readonly<{
  forfeiture: Readonly<{ liabilityDecisionId: string; currency: string; amountMinor: bigint; createdAt: Date }>;
  liability: Readonly<{ id: string; currency: string; liableAmountMinor: bigint | null; decidedAt: Date }> | null;
  returnEvent: Readonly<{ occurredAt: Date }> | null;
  hasDamageSettlement: boolean;
}>): boolean {
  const { forfeiture, liability, returnEvent } = input;
  if (
    !liability || !returnEvent || input.hasDamageSettlement
    || liability.id !== forfeiture.liabilityDecisionId
    || liability.currency !== forfeiture.currency
    || typeof forfeiture.amountMinor !== 'bigint'
    || forfeiture.amountMinor <= 0n
    || liability.liableAmountMinor !== forfeiture.amountMinor
    || !(forfeiture.createdAt instanceof Date)
    || !isValidRentalSecurityBondLiabilityReturnChronology({ liability, returnEvent })
  ) return false;
  const forfeitedAt = forfeiture.createdAt.getTime();
  const decidedAt = liability.decidedAt.getTime();
  const returnedAt = returnEvent.occurredAt.getTime();
  return Number.isFinite(forfeitedAt)
    && Number.isFinite(decidedAt)
    && Number.isFinite(returnedAt)
    && returnedAt <= decidedAt
    && decidedAt <= forfeitedAt
    && returnedAt <= forfeitedAt;
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
