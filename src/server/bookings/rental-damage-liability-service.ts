import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from '../inventory/rental-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  normalizeRentalDamageLiabilityDecisionInput,
  type RentalDamageLiabilityDecisionInput,
} from './rental-damage-liability-domain.ts';

function liabilityIdempotencyKey(damageCaseId: string) {
  return `rental-damage-liability:${damageCaseId}`;
}

function liabilityIdempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `rental-damage-liability:idempotency:${organizationId}:${idempotencyKey}`;
}

async function requireRentalDamageLiabilityReadPermissions(
  input: Readonly<{ organizationId: string; actorUserId: string }>,
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:read',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'payment:read',
    }),
  ]);
}

async function requireRentalDamageLiabilityWritePermissions(
  input: Readonly<{ organizationId: string; actorUserId: string }>,
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await Promise.all([
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'booking:manage',
    }),
    requireOrganizationPermission({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      permission: 'payment:manage',
    }),
  ]);
}

export async function readRentalDamageLiabilityDecision(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  await requireRentalDamageLiabilityReadPermissions(input);

  return db.rentalDamageLiabilityDecision.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      damageCaseId: input.damageCaseId,
    },
  });
}

export async function decideRentalDamageLiability(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
  decision: RentalDamageLiabilityDecisionInput;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  await requireRentalDamageLiabilityWritePermissions(input);

  return db.$transaction(async (transaction) => {
    const located = await transaction.rentalDamageCase.findFirst({
      where: {
        id: input.damageCaseId,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
      },
      select: { id: true, unitId: true },
    });
    if (!located) {
      throw new RentalInventoryUnavailableError(
        'Rental damage case is not available for a liability decision in this organization.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, located.unitId)}, 0)
      )
    `;

    const idempotencyKey = liabilityIdempotencyKey(input.damageCaseId);
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${liabilityIdempotencyLockKey(input.organizationId, idempotencyKey)}, 0)
      )
    `;

    const [damageCase, booking] = await Promise.all([
      transaction.rentalDamageCase.findFirst({
        where: {
          id: input.damageCaseId,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          unitId: located.unitId,
        },
        select: {
          id: true,
          bookingId: true,
          unitId: true,
          status: true,
          currency: true,
          estimatedRepairCostMinor: true,
        },
      }),
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
        },
        select: { id: true, currency: true },
      }),
    ]);

    if (
      !damageCase
      || !booking
      || damageCase.currency !== booking.currency
      || damageCase.estimatedRepairCostMinor === null
      || damageCase.status !== 'CLOSED'
    ) {
      throw new RentalInventoryConflictError(
        'Rental damage liability requires a closed assessed damage case with retained repair-cost authority.',
      );
    }

    const decision = normalizeRentalDamageLiabilityDecisionInput(
      input.decision,
      damageCase.currency,
      damageCase.estimatedRepairCostMinor,
    );

    const existing = await transaction.rentalDamageLiabilityDecision.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.bookingId !== input.bookingId
        || existing.damageCaseId !== input.damageCaseId
        || existing.unitId !== damageCase.unitId
        || existing.outcome !== decision.outcome
        || existing.currency !== decision.currency
        || existing.liableAmountMinor !== decision.liableAmountMinor
        || existing.reason !== decision.reason
      ) {
        throw new RentalInventoryConflictError(
          'Rental damage liability idempotency is already bound to different retained evidence.',
        );
      }
      return Object.freeze({ decision: existing, idempotent: true as const });
    }

    const existingForCase = await transaction.rentalDamageLiabilityDecision.findFirst({
      where: {
        organizationId: input.organizationId,
        damageCaseId: input.damageCaseId,
      },
      select: { id: true },
    });
    if (existingForCase) {
      throw new RentalInventoryConflictError(
        'This rental damage case already has a retained customer liability decision.',
      );
    }

    const created = await transaction.rentalDamageLiabilityDecision.create({
      data: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        damageCaseId: damageCase.id,
        unitId: damageCase.unitId,
        idempotencyKey,
        outcome: decision.outcome,
        currency: decision.currency,
        liableAmountMinor: decision.liableAmountMinor,
        reason: decision.reason,
        decidedByUserId: input.actorUserId,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.damage-liability-decided',
        resourceType: 'rental-damage-liability-decision',
        resourceId: created.id,
        afterData: {
          bookingId: input.bookingId,
          damageCaseId: damageCase.id,
          unitId: damageCase.unitId,
          outcome: created.outcome,
          currency: created.currency,
          liableAmountMinor: created.liableAmountMinor?.toString() ?? null,
          decidedAt: created.decidedAt.toISOString(),
        },
      },
    });

    return Object.freeze({ decision: created, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}
