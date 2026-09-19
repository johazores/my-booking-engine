import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import {
  buildRentalSecurityBondRequestFingerprint,
  deriveRentalSecurityBondSettlement,
  type RentalSecurityBondTransactionEvidence,
} from '../payments/rental-security-bond-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';

export class RentalBookingSecurityBondGuardConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalBookingSecurityBondGuardConflictError';
  }
}

export class RentalBookingSecurityBondGuardUnavailableError extends Error {
  constructor() {
    super('Rental booking security-bond guard is not available in this organization.');
    this.name = 'RentalBookingSecurityBondGuardUnavailableError';
  }
}

export type RentalBookingSecurityBondGuard = Readonly<{
  required: boolean;
  state: 'NOT_REQUIRED' | 'REQUIRED' | 'COLLECTED' | 'RELEASED' | 'FORFEITED';
  blocksPickup: boolean;
  blocksCancellation: boolean;
}>;

const NOT_REQUIRED_GUARD: RentalBookingSecurityBondGuard = Object.freeze({
  required: false,
  state: 'NOT_REQUIRED',
  blocksPickup: false,
  blocksCancellation: false,
});

export async function readRentalBookingSecurityBondGuardInTransaction(input: Readonly<{
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
}>): Promise<RentalBookingSecurityBondGuard> {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  const bond = await input.transaction.rentalSecurityBondRequirement.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    },
    select: {
      id: true,
      currency: true,
      amountMinor: true,
    },
  });
  if (!bond) return NOT_REQUIRED_GUARD;

  const [rows, forfeiture] = await Promise.all([
    input.transaction.rentalSecurityBondTransaction.findMany({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        bondId: bond.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        idempotencyKey: true,
        requestFingerprint: true,
        kind: true,
        status: true,
        providerCode: true,
        providerReference: true,
        sourceProviderReference: true,
        currency: true,
        amountMinor: true,
        createdAt: true,
      },
      take: 3,
    }),
    input.transaction.rentalSecurityBondForfeiture.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        bondId: bond.id,
      },
      select: {
        liabilityDecisionId: true,
        currency: true,
        amountMinor: true,
        createdAt: true,
      },
    }),
  ]);

  if (rows.length > 2) {
    throw new RentalBookingSecurityBondGuardConflictError(
      'Security bond history exceeds the enabled one-collection/one-release contract.',
    );
  }

  const transactions: RentalSecurityBondTransactionEvidence[] = rows.map((row) => {
    if (
      (row.kind !== 'OFFLINE_PAYMENT' && row.kind !== 'REFUND')
      || row.status !== 'SUCCEEDED'
      || row.providerCode !== 'manual'
    ) {
      throw new RentalBookingSecurityBondGuardConflictError(
        'Security bond history contains unsupported settlement evidence.',
      );
    }

    const expectedFingerprint = buildRentalSecurityBondRequestFingerprint({
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      bondId: bond.id,
      idempotencyKey: row.idempotencyKey,
      kind: row.kind,
      providerCode: row.providerCode,
      providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference,
      currency: row.currency,
      amountMinor: row.amountMinor,
    });
    if (row.requestFingerprint !== expectedFingerprint) {
      throw new RentalBookingSecurityBondGuardConflictError(
        'Security bond history contains invalid retained request evidence.',
      );
    }

    return {
      kind: row.kind,
      status: 'SUCCEEDED',
      providerCode: row.providerCode,
      providerReference: row.providerReference,
      sourceProviderReference: row.sourceProviderReference,
      currency: row.currency,
      amountMinor: row.amountMinor,
      createdAt: row.createdAt,
    };
  });

  const settlement = deriveRentalSecurityBondSettlement({
    requiredAmountMinor: bond.amountMinor,
    currency: bond.currency,
    transactions,
    forfeiture,
  });
  if (!settlement.reconciled) {
    throw new RentalBookingSecurityBondGuardConflictError(settlement.reason);
  }

  return Object.freeze({
    required: true,
    state: settlement.state,
    blocksPickup: settlement.state !== 'COLLECTED',
    blocksCancellation: settlement.state === 'COLLECTED',
  });
}

export async function readRentalBookingSecurityBondGuard(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:read',
  });

  return db.$transaction(async (transaction) => {
    const booking = await transaction.rentalBooking.findFirst({
      where: {
        id: input.bookingId,
        organizationId: input.organizationId,
      },
      select: { id: true },
    });
    if (!booking) throw new RentalBookingSecurityBondGuardUnavailableError();

    return readRentalBookingSecurityBondGuardInTransaction({
      transaction,
      organizationId: input.organizationId,
      bookingId: booking.id,
    });
  }, { isolationLevel: 'RepeatableRead' });
}
