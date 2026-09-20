import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { normalizeRentalUnitOperationalStatusInput } from '../inventory/rental-unit-operational-domain.ts';
import { setLockedRentalUnitOperationalStatusInTransaction } from '../inventory/rental-unit-operational-service.ts';
import { rentalUnitLockKey } from '../inventory/rental-lock-domain.ts';
import {
  RentalInventoryConflictError,
  RentalInventoryUnavailableError,
} from '../inventory/rental-service.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import { classifyRentalDamageAssessmentReplay } from './rental-damage-assessment-replay.ts';
import {
  assertRentalDamageCaseTransition,
  normalizeRentalDamageCaseAssessmentInput,
  normalizeRentalDamageCaseClosureInput,
  normalizeRentalDamageCaseCreateInput,
  normalizeRentalDamageCaseWaiverInput,
  rentalDamageCaseOperationalReason,
  type RentalDamageCaseAssessmentInput,
  type RentalDamageCaseClosureInput,
  type RentalDamageCaseCreateInput,
  type RentalDamageCaseWaiverInput,
} from './rental-damage-case-domain.ts';

function damageCaseIdempotencyLockKey(organizationId: string, idempotencyKey: string) {
  return `rental-damage-case:idempotency:${organizationId}:${idempotencyKey}`;
}

async function requireRentalDamageCaseReadPermission(
  input: Readonly<{ organizationId: string; actorUserId: string }>,
) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'booking:read',
  });
}

async function requireRentalDamageCaseWritePermissions(
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
      permission: 'inventory:manage',
    }),
  ]);
}

export async function readRentalDamageCase(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireRentalDamageCaseReadPermission(input);

  return db.rentalDamageCase.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
    },
  });
}

export async function openRentalDamageCase(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCase: RentalDamageCaseCreateInput;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  await requireRentalDamageCaseWritePermissions(input);
  const damageCase = normalizeRentalDamageCaseCreateInput(input.damageCase);
  const idempotencyKey = `rental-damage-case:${input.bookingId}`;

  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${damageCaseIdempotencyLockKey(input.organizationId, idempotencyKey)}, 0)
      )
    `;

    const idempotent = await transaction.rentalDamageCase.findFirst({
      where: {
        organizationId: input.organizationId,
        idempotencyKey,
      },
    });
    if (idempotent) {
      if (idempotent.bookingId !== input.bookingId || idempotent.summary !== damageCase.summary) {
        throw new RentalInventoryConflictError(
          'Rental damage case idempotency is already bound to different evidence.',
        );
      }
      return Object.freeze({ damageCase: idempotent, idempotent: true as const });
    }

    const inspection = await transaction.rentalReturnInspection.findFirst({
      where: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        outcome: { in: ['DAMAGE_REPORTED', 'UNSAFE'] },
      },
      select: { id: true, unitId: true, outcome: true },
    });
    if (!inspection) {
      throw new RentalInventoryUnavailableError(
        'A rental damage case requires retained non-clear return inspection evidence.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, inspection.unitId)}, 0)
      )
    `;

    const [booking, currentInspection, unit, existingForBooking] = await Promise.all([
      transaction.rentalBooking.findFirst({
        where: {
          id: input.bookingId,
          organizationId: input.organizationId,
          status: 'CONFIRMED',
        },
        select: { id: true, currency: true },
      }),
      transaction.rentalReturnInspection.findFirst({
        where: {
          id: inspection.id,
          organizationId: input.organizationId,
          bookingId: input.bookingId,
          unitId: inspection.unitId,
          outcome: { in: ['DAMAGE_REPORTED', 'UNSAFE'] },
        },
        select: { id: true, unitId: true, outcome: true },
      }),
      transaction.rentalUnit.findFirst({
        where: {
          id: inspection.unitId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
        },
        select: { id: true, code: true },
      }),
      transaction.rentalDamageCase.findFirst({
        where: {
          organizationId: input.organizationId,
          bookingId: input.bookingId,
        },
      }),
    ]);

    if (!booking || !currentInspection || !unit) {
      throw new RentalInventoryUnavailableError(
        'Rental damage case authority changed before the case could be opened.',
      );
    }
    if (existingForBooking) {
      throw new RentalInventoryConflictError(
        'This rental booking already has a retained damage case.',
      );
    }

    const operationalState = await transaction.rentalUnitOperationalState.findFirst({
      where: {
        organizationId: input.organizationId,
        unitId: unit.id,
      },
      select: { status: true },
    });
    if (operationalState?.status !== 'OUT_OF_SERVICE') {
      await setLockedRentalUnitOperationalStatusInTransaction({
        transaction,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        unit,
        operational: normalizeRentalUnitOperationalStatusInput({
          status: 'OUT_OF_SERVICE',
          reason: rentalDamageCaseOperationalReason(),
        }),
      });
    }

    const created = await transaction.rentalDamageCase.create({
      data: {
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        inspectionId: currentInspection.id,
        unitId: currentInspection.unitId,
        idempotencyKey,
        summary: damageCase.summary,
        currency: booking.currency,
        openedByUserId: input.actorUserId,
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.damage-case-opened',
        resourceType: 'rental-damage-case',
        resourceId: created.id,
        afterData: {
          bookingId: input.bookingId,
          inspectionId: currentInspection.id,
          inspectionOutcome: currentInspection.outcome,
          unitId: unit.id,
          unitCode: unit.code,
          status: created.status,
          currency: created.currency,
          openedAt: created.openedAt.toISOString(),
        },
      },
    });

    return Object.freeze({ damageCase: created, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}

export async function assessRentalDamageCase(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
  assessment: RentalDamageCaseAssessmentInput;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  await requireRentalDamageCaseWritePermissions(input);

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
        'Rental damage case is not available in this organization.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, located.unitId)}, 0)
      )
    `;

    const current = await transaction.rentalDamageCase.findFirst({
      where: {
        id: located.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
      },
    });
    if (!current) {
      throw new RentalInventoryConflictError(
        'Rental damage case changed before it could be assessed.',
      );
    }

    const assessment = normalizeRentalDamageCaseAssessmentInput(input.assessment, current.currency);
    const replayDisposition = classifyRentalDamageAssessmentReplay(current, assessment);
    if (replayDisposition === 'REPLAY') {
      return Object.freeze({ damageCase: current, idempotent: true as const });
    }
    if (replayDisposition === 'CONFLICT') {
      throw new RentalInventoryConflictError(
        'Rental damage case already retains different assessment evidence.',
      );
    }
    assertRentalDamageCaseTransition(current.status, 'ASSESSED');

    const updated = await transaction.rentalDamageCase.updateMany({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
        status: current.status,
      },
      data: {
        status: 'ASSESSED',
        estimatedRepairCostMinor: assessment.estimatedRepairCostMinor,
        assessmentNotes: assessment.notes,
        assessedByUserId: input.actorUserId,
      },
    });
    if (updated.count !== 1) {
      throw new RentalInventoryConflictError(
        'Rental damage case changed before it could be assessed.',
      );
    }

    const damageCase = await transaction.rentalDamageCase.findFirst({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
      },
    });
    if (!damageCase) {
      throw new RentalInventoryConflictError(
        'Rental damage case could not be reloaded after assessment.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.damage-case-assessed',
        resourceType: 'rental-damage-case',
        resourceId: damageCase.id,
        beforeData: { status: current.status },
        afterData: {
          status: damageCase.status,
          currency: damageCase.currency,
          estimatedRepairCostMinor: damageCase.estimatedRepairCostMinor?.toString() ?? null,
          assessedAt: damageCase.assessedAt?.toISOString() ?? null,
        },
      },
    });

    return Object.freeze({ damageCase, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}

export async function waiveRentalDamageCase(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
  waiver: RentalDamageCaseWaiverInput;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  await requireRentalDamageCaseWritePermissions(input);
  const waiver = normalizeRentalDamageCaseWaiverInput(input.waiver);

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
        'Rental damage case is not available in this organization.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, located.unitId)}, 0)
      )
    `;

    const current = await transaction.rentalDamageCase.findFirst({
      where: {
        id: located.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
      },
    });
    if (!current) {
      throw new RentalInventoryConflictError(
        'Rental damage case changed before it could be waived.',
      );
    }
    if (current.status === 'WAIVED') {
      if (current.waiverReason !== waiver.reason) {
        throw new RentalInventoryConflictError(
          'Rental damage case is already waived with a different retained reason.',
        );
      }
      return Object.freeze({ damageCase: current, idempotent: true as const });
    }
    assertRentalDamageCaseTransition(current.status, 'WAIVED');

    const updated = await transaction.rentalDamageCase.updateMany({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
        status: current.status,
      },
      data: {
        status: 'WAIVED',
        waiverReason: waiver.reason,
        waivedByUserId: input.actorUserId,
      },
    });
    if (updated.count !== 1) {
      throw new RentalInventoryConflictError(
        'Rental damage case changed before it could be waived.',
      );
    }

    const damageCase = await transaction.rentalDamageCase.findFirst({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
      },
    });
    if (!damageCase) {
      throw new RentalInventoryConflictError(
        'Rental damage case could not be reloaded after waiver.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.damage-case-waived',
        resourceType: 'rental-damage-case',
        resourceId: damageCase.id,
        beforeData: { status: current.status },
        afterData: {
          status: damageCase.status,
          waivedAt: damageCase.waivedAt?.toISOString() ?? null,
        },
      },
    });

    return Object.freeze({ damageCase, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}

export async function closeRentalDamageCase(input: Readonly<{
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  damageCaseId: string;
  closure: RentalDamageCaseClosureInput;
}>) {
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.damageCaseId, 'damageCaseId');
  await requireRentalDamageCaseWritePermissions(input);
  const closure = normalizeRentalDamageCaseClosureInput(input.closure);

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
        'Rental damage case is not available in this organization.',
      );
    }

    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${rentalUnitLockKey(input.organizationId, located.unitId)}, 0)
      )
    `;

    const current = await transaction.rentalDamageCase.findFirst({
      where: {
        id: located.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
      },
    });
    if (!current) {
      throw new RentalInventoryConflictError(
        'Rental damage case changed before it could be closed.',
      );
    }
    if (current.status === 'CLOSED') {
      if (current.resolutionNotes !== closure.notes) {
        throw new RentalInventoryConflictError(
          'Rental damage case is already closed with different retained resolution evidence.',
        );
      }
      return Object.freeze({ damageCase: current, idempotent: true as const });
    }
    assertRentalDamageCaseTransition(current.status, 'CLOSED');

    const updated = await transaction.rentalDamageCase.updateMany({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
        status: current.status,
      },
      data: {
        status: 'CLOSED',
        resolutionNotes: closure.notes,
        closedByUserId: input.actorUserId,
      },
    });
    if (updated.count !== 1) {
      throw new RentalInventoryConflictError(
        'Rental damage case changed before it could be closed.',
      );
    }

    const damageCase = await transaction.rentalDamageCase.findFirst({
      where: {
        id: current.id,
        organizationId: input.organizationId,
        bookingId: input.bookingId,
        unitId: located.unitId,
      },
    });
    if (!damageCase) {
      throw new RentalInventoryConflictError(
        'Rental damage case could not be reloaded after closure.',
      );
    }

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: 'booking.rental.damage-case-closed',
        resourceType: 'rental-damage-case',
        resourceId: damageCase.id,
        beforeData: { status: current.status },
        afterData: {
          status: damageCase.status,
          closedAt: damageCase.closedAt?.toISOString() ?? null,
        },
      },
    });

    return Object.freeze({ damageCase, idempotent: false as const });
  }, { isolationLevel: 'Serializable' });
}
