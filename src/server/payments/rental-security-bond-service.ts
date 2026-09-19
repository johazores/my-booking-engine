import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { deriveRentalBookingPickupWindow } from '../bookings/rental-booking-pickup-window-domain.ts';
import { rentalBookingLockKey } from '../bookings/rental-booking-reschedule-domain.ts';
import { classifyRentalBookingWriteError } from '../bookings/rental-booking-write-errors.ts';
import { db } from '../database.ts';
import { parseMoneyMajorToMinor, PricingValidationError } from '../pricing/money.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { ManualPaymentProvider, normalizeManualPaymentReference } from './manual-payment-provider.ts';
import { assertPaymentProviderCapability } from './payment-provider.ts';
import {
  buildRentalSecurityBondRequestFingerprint,
  buildRentalSecurityBondRequirementIdempotencyKey,
  buildRentalSecurityBondTransactionIdempotencyKey,
  deriveRentalSecurityBondSettlement,
  type RentalSecurityBondTransactionEvidence,
} from './rental-security-bond-domain.ts';

export class RentalSecurityBondConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'RentalSecurityBondConflictError'; }
}
export class RentalSecurityBondUnavailableError extends Error {
  constructor(message = 'Rental security bond resource is not available in this organization.') { super(message); this.name = 'RentalSecurityBondUnavailableError'; }
}

const manualProvider = new ManualPaymentProvider();
const lockKey = (organizationId: string, scope: string, value: string) => `rental-security-bond:${organizationId}:${scope}:${value}`;
const manualReferenceLockKey = (organizationId: string, reference: string) => `sf:rental-manual-reference:${organizationId}:${reference}`;

async function runBondWrite<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const disposition = classifyRentalBookingWriteError(error, { retryUniqueConflict: true });
      if (disposition === 'RETRYABLE' && attempt < 2) continue;
      if (disposition === 'RETRYABLE') throw new RentalSecurityBondConflictError('Security bond write could not be serialized after bounded retries.');
      if (disposition === 'CONFLICT') throw new RentalSecurityBondConflictError('Security bond write no longer satisfies the durable tenant or settlement contract.');
      throw error;
    }
  }
  throw new RentalSecurityBondConflictError('Security bond write could not be serialized.');
}

async function requireBondPermissions(input: Readonly<{ organizationId: string; actorUserId: string }>, mode: 'read' | 'manage') {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  if (mode === 'read') {
    await Promise.all([
      requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:read' }),
      requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:read' }),
    ]);
    return;
  }
  await Promise.all([
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'booking:manage' }),
    requireOrganizationPermission({ organizationId: input.organizationId, userId: input.actorUserId, permission: 'payment:manage' }),
  ]);
}

async function loadBooking(transaction: Prisma.TransactionClient, organizationId: string, bookingId: string) {
  const booking = await transaction.rentalBooking.findFirst({
    where: { id: bookingId, organizationId },
    select: {
      id: true,
      status: true,
      cancelledAt: true,
      currency: true,
      startsOn: true,
      endsOn: true,
      customerFirstName: true,
      customerLastName: true,
      location: { select: { timeZone: true } },
    },
  });
  if (!booking) throw new RentalSecurityBondUnavailableError();
  return booking;
}

type LoadedRentalSecurityBondBooking = Awaited<ReturnType<typeof loadBooking>>;

async function readFreshSecurityBondAuthority(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  booking: LoadedRentalSecurityBondBooking,
) {
  const [latestReschedule, custody, databaseClock] = await Promise.all([
    transaction.rentalBookingReschedule.findFirst({
      where: { organizationId, bookingId: booking.id },
      orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { targetStartsOn: true, targetEndsOn: true },
    }),
    transaction.rentalBookingFulfillmentEvent.findFirst({
      where: { organizationId, bookingId: booking.id },
      select: { id: true },
    }),
    transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`,
  ]);
  const observedAt = databaseClock[0]?.now;
  if (!observedAt) {
    throw new RentalSecurityBondConflictError('Database clock is unavailable for rental security-bond authority.');
  }

  const pickupWindow = deriveRentalBookingPickupWindow({
    observedAt,
    startsOn: latestReschedule?.targetStartsOn ?? booking.startsOn,
    endsOn: latestReschedule?.targetEndsOn ?? booking.endsOn,
    timeZone: booking.location.timeZone,
  });

  return Object.freeze({
    hasCustodyEvidence: Boolean(custody),
    pickupWindow,
    canEstablishOrCollect: booking.status === 'CONFIRMED'
      && !booking.cancelledAt
      && !custody
      && pickupWindow.state !== 'CLOSED',
  });
}

function fingerprint(input: Readonly<{
  organizationId: string; bookingId: string; bondId: string; idempotencyKey: string;
  kind: 'OFFLINE_PAYMENT' | 'REFUND'; providerReference: string; sourceProviderReference: string | null;
  currency: string; amountMinor: bigint;
}>) {
  return buildRentalSecurityBondRequestFingerprint({ ...input, providerCode: manualProvider.code });
}

async function loadBondState(transaction: Prisma.TransactionClient, organizationId: string, bookingId: string) {
  const bond = await transaction.rentalSecurityBondRequirement.findFirst({ where: { organizationId, bookingId } });
  if (!bond) return null;
  const rows = await transaction.rentalSecurityBondTransaction.findMany({
    where: { organizationId, bookingId, bondId: bond.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 3,
  });
  if (rows.length > 2) throw new RentalSecurityBondConflictError('Security bond history exceeds the enabled one-collection/one-release contract.');
  const evidence: RentalSecurityBondTransactionEvidence[] = rows.map((row) => {
    if ((row.kind !== 'OFFLINE_PAYMENT' && row.kind !== 'REFUND') || row.status !== 'SUCCEEDED' || row.providerCode !== manualProvider.code) {
      throw new RentalSecurityBondConflictError('Security bond history contains unsupported settlement evidence.');
    }
    const expected = fingerprint({ organizationId, bookingId, bondId: bond.id, idempotencyKey: row.idempotencyKey, kind: row.kind, providerReference: row.providerReference, sourceProviderReference: row.sourceProviderReference, currency: row.currency, amountMinor: row.amountMinor });
    if (row.requestFingerprint !== expected) throw new RentalSecurityBondConflictError('Security bond history contains invalid retained request evidence.');
    return { kind: row.kind, status: 'SUCCEEDED', providerCode: row.providerCode, providerReference: row.providerReference, sourceProviderReference: row.sourceProviderReference, currency: row.currency, amountMinor: row.amountMinor, createdAt: row.createdAt };
  });
  const settlement = deriveRentalSecurityBondSettlement({ requiredAmountMinor: bond.amountMinor, currency: bond.currency, transactions: evidence });
  if (!settlement.reconciled) throw new RentalSecurityBondConflictError(settlement.reason);
  return Object.freeze({ bond, rows, settlement });
}

export async function readRentalSecurityBond(input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string }>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireBondPermissions(input, 'read');
  return db.$transaction(async (transaction) => {
    const booking = await loadBooking(transaction, input.organizationId, input.bookingId);
    const [state, preCustodyAuthority] = await Promise.all([
      loadBondState(transaction, input.organizationId, booking.id),
      readFreshSecurityBondAuthority(transaction, input.organizationId, booking),
    ]);
    return Object.freeze({
      booking,
      bond: state?.bond ?? null,
      transactions: state?.rows ?? [],
      settlement: state?.settlement ?? null,
      preCustodyAuthority,
    });
  }, { isolationLevel: 'RepeatableRead' });
}

export async function createRentalSecurityBondRequirement(input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string; amountMajor: string }>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireBondPermissions(input, 'manage');
  return runBondWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;
    const booking = await loadBooking(transaction, input.organizationId, input.bookingId);
    if (booking.status !== 'CONFIRMED' || booking.cancelledAt) throw new RentalSecurityBondConflictError('Security bond can only be required for a confirmed rental booking.');
    const money = parseMoneyMajorToMinor(input.amountMajor, booking.currency);
    if (money.amountMinor <= 0n) throw new PricingValidationError('Security bond amount must be greater than zero.');
    const idempotencyKey = buildRentalSecurityBondRequirementIdempotencyKey({ bookingId: booking.id, currency: money.currency, amountMinor: money.amountMinor });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'requirement', booking.id)}, 0))`;
    const existing = await transaction.rentalSecurityBondRequirement.findFirst({ where: { organizationId: input.organizationId, bookingId: booking.id } });
    if (existing) {
      if (existing.idempotencyKey !== idempotencyKey || existing.currency !== money.currency || existing.amountMinor !== money.amountMinor) throw new RentalSecurityBondConflictError('This booking already has a different immutable security bond requirement.');
      return Object.freeze({ bond: existing, idempotent: true as const });
    }

    const preCustodyAuthority = await readFreshSecurityBondAuthority(transaction, input.organizationId, booking);
    if (preCustodyAuthority.hasCustodyEvidence) {
      throw new RentalSecurityBondConflictError('Security bond requirement must be established before physical custody begins.');
    }
    if (preCustodyAuthority.pickupWindow.state === 'CLOSED') {
      throw new RentalSecurityBondConflictError(
        'Security bond requirement cannot be created after the committed pickup window has closed. Reschedule or cancel the booking instead.',
      );
    }

    const bond = await transaction.rentalSecurityBondRequirement.create({ data: { organizationId: input.organizationId, bookingId: booking.id, idempotencyKey, currency: money.currency, amountMinor: money.amountMinor } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: 'payment.rental.security-bond-required', resourceType: 'rental-security-bond', resourceId: bond.id, afterData: { bookingId: booking.id, currency: bond.currency, amountMinor: bond.amountMinor.toString() } } });
    return Object.freeze({ bond, idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}

async function assertManualReferenceUnused(transaction: Prisma.TransactionClient, organizationId: string, reference: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${manualReferenceLockKey(organizationId, reference)}, 0))`;
  const retainedReference = await transaction.rentalManualProviderReference.findUnique({
    where: {
      organizationId_providerReference: {
        organizationId,
        providerReference: reference,
      },
    },
    select: { sourceLedger: true, sourceId: true },
  });
  if (retainedReference) throw new RentalSecurityBondConflictError('Manual reference has already been retained as rental settlement evidence in this organization.');
}

type ManualBondOperation = 'collection' | 'release';
async function recordManualBondEvidence(input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string; reference: unknown }>, operation: ManualBondOperation) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  const reference = normalizeManualPaymentReference(input.reference);
  await requireBondPermissions(input, 'manage');
  assertPaymentProviderCapability(manualProvider, operation === 'collection' ? 'OFFLINE_RECORDING' : 'OFFLINE_REFUND_RECORDING');

  return runBondWrite(() => db.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rentalBookingLockKey(input.organizationId, input.bookingId)}, 0))`;
    const booking = await loadBooking(transaction, input.organizationId, input.bookingId);
    const state = await loadBondState(transaction, input.organizationId, booking.id);
    if (!state) throw new RentalSecurityBondUnavailableError(`A retained security bond requirement is required before ${operation}.`);
    const kind = operation === 'collection' ? 'OFFLINE_PAYMENT' as const : 'REFUND' as const;
    const idempotencyKey = buildRentalSecurityBondTransactionIdempotencyKey({ kind: operation === 'collection' ? 'manual-collection' : 'manual-release', bondId: state.bond.id, reference });
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(input.organizationId, 'idempotency', idempotencyKey)}, 0))`;
    const source = state.rows.find((row) => row.kind === 'OFFLINE_PAYMENT') ?? null;
    const requestFingerprint = fingerprint({ organizationId: input.organizationId, bookingId: booking.id, bondId: state.bond.id, idempotencyKey, kind, providerReference: reference, sourceProviderReference: operation === 'release' ? source?.providerReference ?? null : null, currency: state.bond.currency, amountMinor: state.bond.amountMinor });
    const existing = await transaction.rentalSecurityBondTransaction.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } } });
    if (existing) {
      if (existing.bondId !== state.bond.id || existing.bookingId !== booking.id || existing.kind !== kind || existing.status !== 'SUCCEEDED' || existing.providerCode !== 'manual' || existing.providerReference !== reference || existing.sourceProviderReference !== (operation === 'release' ? source?.providerReference ?? null : null) || existing.currency !== state.bond.currency || existing.amountMinor !== state.bond.amountMinor || existing.requestFingerprint !== requestFingerprint) throw new RentalSecurityBondConflictError(`Security bond ${operation} idempotency is bound to different retained evidence.`);
      const replay = await loadBondState(transaction, input.organizationId, booking.id);
      if (!replay || (operation === 'collection' ? !['COLLECTED', 'RELEASED'].includes(replay.settlement.state) : replay.settlement.state !== 'RELEASED')) throw new RentalSecurityBondConflictError(`Security bond ${operation} replay no longer reconciles.`);
      return Object.freeze({ transaction: existing, settlement: replay.settlement, idempotent: true as const });
    }

    if (operation === 'collection') {
      if (booking.status !== 'CONFIRMED' || booking.cancelledAt) throw new RentalSecurityBondConflictError('Security bond collection requires a confirmed rental booking.');
      const preCustodyAuthority = await readFreshSecurityBondAuthority(transaction, input.organizationId, booking);
      if (preCustodyAuthority.hasCustodyEvidence) {
        throw new RentalSecurityBondConflictError('Security bond collection must be recorded before physical custody begins.');
      }
      if (preCustodyAuthority.pickupWindow.state === 'CLOSED') {
        throw new RentalSecurityBondConflictError(
          'Security bond collection cannot be recorded after the committed pickup window has closed. Reschedule or cancel the booking instead.',
        );
      }
      if (state.settlement.state !== 'REQUIRED') throw new RentalSecurityBondConflictError('Security bond already has retained collection evidence.');
    } else {
      if (state.settlement.state !== 'COLLECTED' || !source) throw new RentalSecurityBondConflictError('Security bond is not currently collected or has already been released.');
    }

    await assertManualReferenceUnused(transaction, input.organizationId, reference);
    const money = { currency: state.bond.currency, amountMinor: state.bond.amountMinor };
    let providerReference: string;
    let sourceProviderReference: string | null;
    if (operation === 'collection') {
      const result = await manualProvider.recordOfflinePayment({ organizationId: input.organizationId, bookingId: booking.id, idempotencyKey, money, reference });
      if (result.status !== 'PAID' || result.providerCode !== 'manual' || result.providerReference !== reference || result.money.currency !== state.bond.currency || result.money.amountMinor !== state.bond.amountMinor) throw new RentalSecurityBondConflictError('Manual provider result does not match authoritative security bond collection.');
      providerReference = result.providerReference;
      sourceProviderReference = null;
    } else {
      const sourceReference = source?.providerReference;
      if (!sourceReference) throw new RentalSecurityBondConflictError('Security bond release has no retained collection source.');
      const result = await manualProvider.recordOfflineRefund({ organizationId: input.organizationId, bookingId: booking.id, idempotencyKey, money, paymentReference: sourceReference, refundReference: reference });
      if (result.status !== 'REFUNDED' || result.providerCode !== 'manual' || result.providerReference !== sourceReference || result.refundReference !== reference || result.money.currency !== state.bond.currency || result.money.amountMinor !== state.bond.amountMinor) throw new RentalSecurityBondConflictError('Manual provider result does not match authoritative security bond release.');
      providerReference = result.refundReference;
      sourceProviderReference = result.providerReference;
    }

    const created = await transaction.rentalSecurityBondTransaction.create({ data: { organizationId: input.organizationId, bookingId: booking.id, bondId: state.bond.id, idempotencyKey, requestFingerprint, kind, status: 'SUCCEEDED', providerCode: 'manual', providerReference, sourceProviderReference, currency: state.bond.currency, amountMinor: state.bond.amountMinor } });
    await transaction.auditEvent.create({ data: { organizationId: input.organizationId, actorUserId: input.actorUserId, action: `payment.rental.security-bond-${operation === 'collection' ? 'collected' : 'released'}`, resourceType: 'rental-security-bond-transaction', resourceId: created.id, afterData: { bookingId: booking.id, bondId: state.bond.id, currency: created.currency, amountMinor: created.amountMinor.toString(), providerCode: created.providerCode, sourceProviderReference: created.sourceProviderReference } } });
    const finalState = await loadBondState(transaction, input.organizationId, booking.id);
    const expectedState = operation === 'collection' ? 'COLLECTED' : 'RELEASED';
    if (!finalState || finalState.settlement.state !== expectedState) throw new RentalSecurityBondConflictError(`Security bond ${operation} did not reconcile after persistence.`);
    return Object.freeze({ transaction: created, settlement: finalState.settlement, idempotent: false as const });
  }, { isolationLevel: 'Serializable' }));
}

export const recordRentalSecurityBondManualCollection = (input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string; reference: unknown }>) => recordManualBondEvidence(input, 'collection');
export const recordRentalSecurityBondManualRelease = (input: Readonly<{ organizationId: string; actorUserId: string; bookingId: string; reference: unknown }>) => recordManualBondEvidence(input, 'release');
