import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { rentalBookingLockKey } from '../bookings/rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from '../bookings/rental-booking-write-errors.ts';
import { db } from '../database.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  buildRentalSecurityBondForfeitureIdempotencyKey,
  deriveRentalSecurityBondSettlement,
  isValidRentalSecurityBondRetainedForfeiture,
  isValidRentalSecurityBondRetainedLiabilityDisposition,
  isValidRentalSecurityBondLiabilityReturnChronology,
  isValidRentalSecurityBondRetainedTransaction,
  isValidRentalSecurityBondRetainedRequirement,
  type RentalSecurityBondForfeitureEvidence,
  type RentalSecurityBondTransactionEvidence,
} from './rental-security-bond-domain.ts';
import {
  RentalSecurityBondConflictError,
  RentalSecurityBondUnavailableError,
} from './rental-security-bond-service.ts';

function forfeitureLockKey(organizationId: string, scope: string, value: string) {
  return `rental-security-bond-forfeiture:${organizationId}:${scope}:${value}`;
}

async function requireForfeiturePermissions(
  input: Readonly<{ organizationId: string; actorUserId: string }>,
  mode: 'read' | 'manage',
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  const permissions = mode === 'read'
    ? ['booking:read', 'payment:read'] as const
    : ['booking:manage', 'payment:manage'] as const;
  await Promise.all(permissions.map((permission) => requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission,
  })));
}

async function runForfeitureWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') {
        throw new RentalSecurityBondConflictError('Security bond forfeiture could not be serialized after bounded retries.');
      }
      if (disposition === 'CONFLICT') {
        throw new RentalSecurityBondConflictError('Security bond forfeiture no longer satisfies the durable tenant or settlement contract.');
      }
      throw error;
    }
  }
  throw new RentalSecurityBondConflictError('Security bond forfeiture could not be serialized.');
}

async function loadForfeitureContext(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  bookingId: string,
) {
  const bond = await transaction.rentalSecurityBondRequirement.findFirst({
    where: { organizationId, bookingId },
  });
  if (!bond) return Object.freeze({ bond: null, rows: [], collection: null, release: null, forfeiture: null, liability: null, returnEvent: null, hasDamageSettlement: false });

  const [rows, forfeiture, liability] = await Promise.all([
    transaction.rentalSecurityBondTransaction.findMany({
      where: { organizationId, bookingId, bondId: bond.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3,
    }),
    transaction.rentalSecurityBondForfeiture.findFirst({
      where: { organizationId, bookingId, bondId: bond.id },
    }),
    transaction.rentalDamageLiabilityDecision.findFirst({
      where: { organizationId, bookingId, outcome: 'CUSTOMER_LIABLE' },
      select: {
        id: true,
        bookingId: true,
        damageCaseId: true,
        unitId: true,
        currency: true,
        liableAmountMinor: true,
        decidedAt: true,
      },
    }),
  ]);
  const collection = rows.find((row) => row.kind === 'OFFLINE_PAYMENT') ?? null;
  const release = rows.find((row) => row.kind === 'REFUND') ?? null;

  const [returnEvent, damageSettlement] = liability ? await Promise.all([
    transaction.rentalBookingFulfillmentEvent.findFirst({
      where: { organizationId, bookingId, unitId: liability.unitId, kind: 'RETURNED' },
      select: { id: true, occurredAt: true },
    }),
    transaction.rentalDamageSettlementTransaction.findFirst({
      where: { organizationId, liabilityDecisionId: liability.id },
      select: { id: true },
    }),
  ]) : [null, null];

  return Object.freeze({
    bond,
    rows,
    collection,
    release,
    forfeiture,
    liability,
    returnEvent,
    hasDamageSettlement: Boolean(damageSettlement),
  });
}

function reconcileForfeitureContext(context: Awaited<ReturnType<typeof loadForfeitureContext>>) {
  if (!context.bond) return null;
  if (context.rows.length > 2) {
    throw new RentalSecurityBondConflictError('Security bond history exceeds the enabled one-collection/one-release contract.');
  }
  if (!isValidRentalSecurityBondRetainedRequirement({
    bookingId: context.bond.bookingId,
    requirement: context.bond,
    transactions: context.rows,
    forfeiture: context.forfeiture,
  })) {
    throw new RentalSecurityBondConflictError('Security bond requirement identity or chronology is inconsistent with retained evidence.');
  }
  const transactions: RentalSecurityBondTransactionEvidence[] = [];
  for (const row of context.rows) {
    if (
      (row.kind !== 'OFFLINE_PAYMENT' && row.kind !== 'REFUND')
      || !isValidRentalSecurityBondRetainedTransaction({
        organizationId: context.bond.organizationId,
        bookingId: context.bond.bookingId,
        bondId: context.bond.id,
        transaction: row,
      })
    ) throw new RentalSecurityBondConflictError('Security bond history contains invalid retained manual evidence.');
    transactions.push({
      kind: row.kind,
      status: 'SUCCEEDED',
      providerCode: row.providerCode,
      providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference,
      currency: row.currency,
      amountMinor: row.amountMinor,
      createdAt: row.createdAt,
    });
  }
  if (context.forfeiture && !isValidRentalSecurityBondRetainedForfeiture({
    bondId: context.bond.id,
    collectionTransactionId: context.collection?.id ?? null,
    forfeiture: context.forfeiture,
  })) {
    throw new RentalSecurityBondConflictError('Security bond forfeiture source evidence is invalid.');
  }
  if (context.forfeiture && !isValidRentalSecurityBondRetainedLiabilityDisposition({
    forfeiture: context.forfeiture,
    liability: context.liability,
    returnEvent: context.returnEvent,
    hasDamageSettlement: context.hasDamageSettlement,
  })) {
    throw new RentalSecurityBondConflictError('Security bond forfeiture no longer matches retained liability, custody, or exclusive settlement evidence.');
  }
  const forfeiture: RentalSecurityBondForfeitureEvidence | null = context.forfeiture ? {
    liabilityDecisionId: context.forfeiture.liabilityDecisionId,
    currency: context.forfeiture.currency,
    amountMinor: context.forfeiture.amountMinor,
    createdAt: context.forfeiture.createdAt,
  } : null;
  const settlement = deriveRentalSecurityBondSettlement({
    requiredAmountMinor: context.bond.amountMinor,
    currency: context.bond.currency,
    transactions,
    forfeiture,
  });
  if (!settlement.reconciled) throw new RentalSecurityBondConflictError(settlement.reason);
  return settlement;
}

function deriveEligibility(context: Awaited<ReturnType<typeof loadForfeitureContext>>, bookingStatus: string) {
  if (!context.bond) return Object.freeze({ eligible: false as const, reason: 'No retained security bond requirement exists for this booking.', liability: null });
  if (bookingStatus !== 'CONFIRMED') return Object.freeze({ eligible: false as const, reason: 'Only a confirmed rental booking can forfeit a security bond.', liability: context.liability });
  const settlement = reconcileForfeitureContext(context);
  if (settlement?.state === 'FORFEITED') return Object.freeze({ eligible: false as const, reason: 'This security bond has already been forfeited.', liability: context.liability });
  if (settlement?.state !== 'COLLECTED' || !context.collection) return Object.freeze({ eligible: false as const, reason: 'Only an actively collected security bond can be forfeited.', liability: context.liability });
  if (!context.liability || context.liability.liableAmountMinor === null || context.liability.liableAmountMinor <= 0n) {
    return Object.freeze({ eligible: false as const, reason: 'A retained customer-liable damage decision is required before forfeiture.', liability: context.liability });
  }
  if (!context.returnEvent) return Object.freeze({ eligible: false as const, reason: 'Retained return custody evidence is required before forfeiture.', liability: context.liability });
  if (!isValidRentalSecurityBondLiabilityReturnChronology({ liability: context.liability, returnEvent: context.returnEvent })) {
    return Object.freeze({ eligible: false as const, reason: 'Retained damage liability decision must follow valid return custody chronology.', liability: context.liability });
  }
  if (context.hasDamageSettlement) return Object.freeze({ eligible: false as const, reason: 'This damage liability already has separate settlement evidence and cannot also consume the security bond.', liability: context.liability });
  if (context.bond.currency !== context.liability.currency || context.bond.amountMinor !== context.liability.liableAmountMinor) {
    return Object.freeze({ eligible: false as const, reason: 'Bond forfeiture is enabled only when the collected bond exactly matches the retained damage liability amount and currency.', liability: context.liability });
  }
  return Object.freeze({ eligible: true as const, reason: null, liability: context.liability });
}

export async function readRentalSecurityBondForfeiture(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireForfeiturePermissions(input, 'read');
  return db.$transaction(async (transaction) => {
    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId },
      select: { id: true, status: true },
    });
    if (!booking) throw new RentalSecurityBondUnavailableError();
    const context = await loadForfeitureContext(transaction, input.organizationId, booking.id);
    const settlement = reconcileForfeitureContext(context);
    return Object.freeze({
      bookingStatus: booking.status,
      bondId: context.bond?.id ?? null,
      transactionIds: context.rows.map((row) => row.id),
      forfeiture: context.forfeiture,
      settlement,
      eligibility: deriveEligibility(context, booking.status),
    });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function forfeitRentalSecurityBondAgainstDamageLiability(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireForfeiturePermissions(input, 'manage');

  return runForfeitureWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;
    const booking = await transaction.rentalBooking.findFirst({
      where: { id: input.bookingId, organizationId: input.organizationId, status: 'CONFIRMED' },
      select: { id: true, status: true },
    });
    if (!booking) throw new RentalSecurityBondUnavailableError('A confirmed tenant rental booking is required before security bond forfeiture.');

    const located = await loadForfeitureContext(transaction, input.organizationId, booking.id);
    const locatedEligibility = deriveEligibility(located, booking.status);
    if (!located.liability) throw new RentalSecurityBondUnavailableError('A retained customer-liable damage decision is required before security bond forfeiture.');

    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalUnitLockKey(input.organizationId, located.liability.unitId)}, 0))`;
    const context = await loadForfeitureContext(transaction, input.organizationId, booking.id);
    if (!context.bond || !context.collection || !context.liability) throw new RentalSecurityBondUnavailableError('Security bond forfeiture authority is no longer available in this organization.');

    const idempotencyKey = buildRentalSecurityBondForfeitureIdempotencyKey({
      bondId: context.bond.id,
      liabilityDecisionId: context.liability.id,
    });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${forfeitureLockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;

    const existing = await transaction.rentalSecurityBondForfeiture.findFirst({
      where: { organizationId: input.organizationId, bondId: context.bond.id },
    });
    if (existing) {
      if (
        existing.bookingId !== booking.id
        || existing.liabilityDecisionId !== context.liability.id
        || existing.collectionTransactionId !== context.collection.id
        || existing.idempotencyKey !== idempotencyKey
        || existing.currency !== context.bond.currency
        || existing.amountMinor !== context.bond.amountMinor
      ) throw new RentalSecurityBondConflictError('Security bond forfeiture idempotency is bound to different retained evidence.');
      const settlement = reconcileForfeitureContext(context);
      if (!settlement || settlement.state !== 'FORFEITED') throw new RentalSecurityBondConflictError('Security bond forfeiture replay no longer reconciles.');
      return Object.freeze({ forfeiture: existing, settlement, idempotent: true as const });
    }

    const eligibility = deriveEligibility(context, booking.status);
    if (!eligibility.eligible) throw new RentalSecurityBondConflictError(eligibility.reason ?? locatedEligibility.reason ?? 'Security bond forfeiture is not currently allowed.');

    const created = await transaction.rentalSecurityBondForfeiture.create({
      data: {
        organizationId: input.organizationId,
        bookingId: booking.id,
        bondId: context.bond.id,
        liabilityDecisionId: context.liability.id,
        collectionTransactionId: context.collection.id,
        idempotencyKey,
        currency: context.bond.currency,
        amountMinor: context.bond.amountMinor,
        forfeitedByUserId: input.actorUserId,
      },
    });
    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'payment.rental.security-bond-forfeited',
        resourceType: 'rental-security-bond-forfeiture',
        resourceId: created.id,
        afterData: {
          bookingId: booking.id,
          bondId: context.bond.id,
          liabilityDecisionId: context.liability.id,
          collectionTransactionId: context.collection.id,
          currency: created.currency,
          amountMinor: created.amountMinor.toString(),
        },
      },
    });

    const after = await loadForfeitureContext(transaction, input.organizationId, booking.id);
    const settlement = reconcileForfeitureContext(after);
    if (!settlement || settlement.state !== 'FORFEITED') throw new RentalSecurityBondConflictError('Security bond forfeiture did not reconcile after persistence.');
    return Object.freeze({ forfeiture: created, settlement, idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}
