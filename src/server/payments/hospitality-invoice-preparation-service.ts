import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import {
  HospitalityBookingPricingEvidenceValidationError,
  assertHospitalityBookingPricingEvidenceMatchesCommercialState,
  parseHospitalityBookingPricingEvidenceBreakdown,
  type HospitalityBookingPricingEvidenceCommercialState,
} from '../bookings/booking-pricing-evidence-domain.ts';
import { db } from '../database.ts';
import type { HospitalityAddonSelectionInput } from '../pricing/hospitality-addon-domain.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  InvoiceIssuerProfilePersistenceError,
  readCurrentInvoiceIssuerProfileForPreparation,
} from './invoice-issuer-service.ts';
import {
  HospitalityInvoicePreparationValidationError,
  createHospitalityInvoicePreparationSnapshot,
  hospitalityInvoicePreparationFingerprint,
  hospitalityInvoicePreparationKey,
  parseHospitalityInvoicePreparationSnapshot,
  type HospitalityInvoicePreparationSnapshot,
} from './hospitality-invoice-preparation-domain.ts';

export class HospitalityInvoicePreparationUnavailableError extends Error {
  constructor(message = 'Invoice preparation is not available for this booking.') {
    super(message);
    this.name = 'HospitalityInvoicePreparationUnavailableError';
  }
}

export class HospitalityInvoicePreparationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInvoicePreparationConflictError';
  }
}

export class HospitalityInvoicePreparationPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInvoicePreparationPersistenceError';
  }
}

export class HospitalityInvoicePreparationWriteConflictError extends Error {
  constructor() {
    super('Invoice preparation changed concurrently. Retry the operation.');
    this.name = 'HospitalityInvoicePreparationWriteConflictError';
  }
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return null;
  return error.code;
}

function isRetryablePreparationWrite(error: unknown) {
  const code = prismaErrorCode(error);
  return code === 'P2002' || code === 'P2034';
}

function sameDate(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function parseAddonSelections(value: Prisma.JsonValue): HospitalityAddonSelectionInput[] {
  if (!Array.isArray(value)) {
    throw new HospitalityInvoicePreparationPersistenceError('Persisted booking add-on selections are not an array.');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HospitalityInvoicePreparationPersistenceError(`Persisted booking add-on selection ${index + 1} is invalid.`);
    }
    const record = entry as Record<string, Prisma.JsonValue>;
    if (typeof record.addonId !== 'string' || typeof record.quantity !== 'number') {
      throw new HospitalityInvoicePreparationPersistenceError(`Persisted booking add-on selection ${index + 1} is invalid.`);
    }
    return { addonId: record.addonId, quantity: record.quantity };
  });
}

function assertPricingEvidenceMatchesBooking(input: {
  evidence: {
    id: string;
    propertyId: string;
    roomTypeId: string;
    ratePlanId: string;
    arrivalDate: Date;
    departureDate: Date;
    quantity: number;
    currency: string;
    accommodationSubtotalMinor: bigint;
    taxTotalMinor: bigint;
    feeTotalMinor: bigint;
    addonTotalMinor: bigint;
    totalMinor: bigint;
    pricingFingerprint: string;
    pricingBreakdown: Prisma.JsonValue;
  };
  booking: {
    propertyId: string;
    roomTypeId: string;
    ratePlanId: string;
    arrivalDate: Date;
    departureDate: Date;
    quantity: number;
    addonSelections: Prisma.JsonValue;
    currency: string;
    accommodationSubtotalMinor: bigint;
    taxTotalMinor: bigint;
    feeTotalMinor: bigint;
    addonTotalMinor: bigint;
    totalMinor: bigint;
    pricingFingerprint: string;
  };
}) {
  const { evidence, booking } = input;
  if (
    evidence.propertyId !== booking.propertyId
    || evidence.roomTypeId !== booking.roomTypeId
    || evidence.ratePlanId !== booking.ratePlanId
    || !sameDate(evidence.arrivalDate, booking.arrivalDate)
    || !sameDate(evidence.departureDate, booking.departureDate)
    || evidence.quantity !== booking.quantity
    || evidence.currency !== booking.currency
    || evidence.accommodationSubtotalMinor !== booking.accommodationSubtotalMinor
    || evidence.taxTotalMinor !== booking.taxTotalMinor
    || evidence.feeTotalMinor !== booking.feeTotalMinor
    || evidence.addonTotalMinor !== booking.addonTotalMinor
    || evidence.totalMinor !== booking.totalMinor
    || evidence.pricingFingerprint !== booking.pricingFingerprint
  ) {
    throw new HospitalityInvoicePreparationConflictError(
      'Immutable pricing evidence does not match the booking commercial state.',
    );
  }

  const state: HospitalityBookingPricingEvidenceCommercialState = {
    propertyId: booking.propertyId,
    roomTypeId: booking.roomTypeId,
    ratePlanId: booking.ratePlanId,
    arrivalDate: booking.arrivalDate,
    departureDate: booking.departureDate,
    quantity: booking.quantity,
    addonSelections: parseAddonSelections(booking.addonSelections),
  };

  try {
    const breakdown = parseHospitalityBookingPricingEvidenceBreakdown(evidence.pricingBreakdown);
    assertHospitalityBookingPricingEvidenceMatchesCommercialState({ breakdown, state });
    if (
      breakdown.currency !== booking.currency
      || BigInt(breakdown.accommodationSubtotalMinor) !== booking.accommodationSubtotalMinor
      || BigInt(breakdown.taxTotalMinor) !== booking.taxTotalMinor
      || BigInt(breakdown.feeTotalMinor) !== booking.feeTotalMinor
      || BigInt(breakdown.addonTotalMinor) !== booking.addonTotalMinor
      || BigInt(breakdown.totalMinor) !== booking.totalMinor
      || breakdown.pricingFingerprint !== booking.pricingFingerprint
    ) {
      throw new HospitalityInvoicePreparationConflictError(
        'Immutable pricing breakdown does not reconcile to the booking commercial state.',
      );
    }
    return breakdown;
  } catch (error) {
    if (error instanceof HospitalityInvoicePreparationConflictError) throw error;
    if (error instanceof HospitalityBookingPricingEvidenceValidationError) {
      throw new HospitalityInvoicePreparationConflictError(error.message);
    }
    throw error;
  }
}

function assertPersistedPreparation(input: {
  row: {
    pricingEvidenceId: string;
    issuerProfileId: string;
    currency: string;
    accommodationSubtotalMinor: bigint;
    taxTotalMinor: bigint;
    feeTotalMinor: bigint;
    addonTotalMinor: bigint;
    totalMinor: bigint;
    pricingFingerprint: string;
    issuerFingerprint: string;
    documentFingerprint: string;
    preparationSnapshot: Prisma.JsonValue;
  };
  expected: HospitalityInvoicePreparationSnapshot;
}) {
  let snapshot: HospitalityInvoicePreparationSnapshot;
  try {
    snapshot = parseHospitalityInvoicePreparationSnapshot(input.row.preparationSnapshot);
  } catch (error) {
    if (error instanceof HospitalityInvoicePreparationValidationError) {
      throw new HospitalityInvoicePreparationPersistenceError(error.message);
    }
    throw error;
  }

  const expectedFingerprint = hospitalityInvoicePreparationFingerprint(snapshot);
  if (
    snapshot.pricingEvidenceId !== input.expected.pricingEvidenceId
    || snapshot.issuerProfileId !== input.expected.issuerProfileId
    || snapshot.currency !== input.expected.currency
    || snapshot.accommodationSubtotalMinor !== input.expected.accommodationSubtotalMinor
    || snapshot.taxTotalMinor !== input.expected.taxTotalMinor
    || snapshot.feeTotalMinor !== input.expected.feeTotalMinor
    || snapshot.addonTotalMinor !== input.expected.addonTotalMinor
    || snapshot.totalMinor !== input.expected.totalMinor
    || snapshot.pricingFingerprint !== input.expected.pricingFingerprint
    || snapshot.issuerFingerprint !== input.expected.issuerFingerprint
    || input.row.pricingEvidenceId !== snapshot.pricingEvidenceId
    || input.row.issuerProfileId !== snapshot.issuerProfileId
    || input.row.currency !== snapshot.currency
    || input.row.accommodationSubtotalMinor !== BigInt(snapshot.accommodationSubtotalMinor)
    || input.row.taxTotalMinor !== BigInt(snapshot.taxTotalMinor)
    || input.row.feeTotalMinor !== BigInt(snapshot.feeTotalMinor)
    || input.row.addonTotalMinor !== BigInt(snapshot.addonTotalMinor)
    || input.row.totalMinor !== BigInt(snapshot.totalMinor)
    || input.row.pricingFingerprint !== snapshot.pricingFingerprint
    || input.row.issuerFingerprint !== snapshot.issuerFingerprint
    || input.row.documentFingerprint !== expectedFingerprint
  ) {
    throw new HospitalityInvoicePreparationPersistenceError('Persisted invoice preparation failed integrity validation.');
  }
  return snapshot;
}

export async function prepareHospitalityInvoice(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (transaction) => {
        const booking = await transaction.hospitalityBooking.findFirst({
          where: { id: input.bookingId, organizationId: input.organizationId },
          select: {
            id: true,
            status: true,
            propertyId: true,
            roomTypeId: true,
            ratePlanId: true,
            arrivalDate: true,
            departureDate: true,
            quantity: true,
            addonSelections: true,
            currency: true,
            accommodationSubtotalMinor: true,
            taxTotalMinor: true,
            feeTotalMinor: true,
            addonTotalMinor: true,
            totalMinor: true,
            pricingFingerprint: true,
          },
        });
        if (!booking) throw new HospitalityInvoicePreparationUnavailableError();
        if (!['CONFIRMED', 'CANCELLED'].includes(booking.status)) {
          throw new HospitalityInvoicePreparationConflictError(
            'Invoice preparation requires an accepted confirmed booking commercial state.',
          );
        }

        const issuer = await readCurrentInvoiceIssuerProfileForPreparation({
          transaction,
          organizationId: input.organizationId,
        });

        const evidence = await transaction.hospitalityBookingPricingEvidence.findFirst({
          where: {
            organizationId: input.organizationId,
            bookingId: booking.id,
            propertyId: booking.propertyId,
            roomTypeId: booking.roomTypeId,
            ratePlanId: booking.ratePlanId,
            arrivalDate: booking.arrivalDate,
            departureDate: booking.departureDate,
            quantity: booking.quantity,
            currency: booking.currency,
            accommodationSubtotalMinor: booking.accommodationSubtotalMinor,
            taxTotalMinor: booking.taxTotalMinor,
            feeTotalMinor: booking.feeTotalMinor,
            addonTotalMinor: booking.addonTotalMinor,
            totalMinor: booking.totalMinor,
            pricingFingerprint: booking.pricingFingerprint,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (!evidence) {
          throw new HospitalityInvoicePreparationConflictError(
            'Immutable pricing evidence is unavailable for this accepted booking state. Historical legal pricing data is never reconstructed from current mutable pricing rules.',
          );
        }
        assertPricingEvidenceMatchesBooking({ evidence, booking });

        const snapshot = createHospitalityInvoicePreparationSnapshot({
          pricingEvidenceId: evidence.id,
          issuerProfileId: issuer.id,
          currency: booking.currency,
          accommodationSubtotalMinor: booking.accommodationSubtotalMinor,
          taxTotalMinor: booking.taxTotalMinor,
          feeTotalMinor: booking.feeTotalMinor,
          addonTotalMinor: booking.addonTotalMinor,
          totalMinor: booking.totalMinor,
          pricingFingerprint: booking.pricingFingerprint,
          issuerFingerprint: issuer.fingerprint,
        });
        const documentFingerprint = hospitalityInvoicePreparationFingerprint(snapshot);
        const preparationKey = hospitalityInvoicePreparationKey({
          organizationId: input.organizationId,
          bookingId: booking.id,
          snapshot,
        });

        const existing = await transaction.hospitalityInvoicePreparation.findFirst({
          where: { organizationId: input.organizationId, preparationKey },
        });
        if (existing) {
          assertPersistedPreparation({ row: existing, expected: snapshot });
          return existing;
        }

        const created = await transaction.hospitalityInvoicePreparation.create({
          data: {
            organizationId: input.organizationId,
            bookingId: booking.id,
            pricingEvidenceId: evidence.id,
            issuerProfileId: issuer.id,
            preparationKey,
            currency: snapshot.currency,
            accommodationSubtotalMinor: BigInt(snapshot.accommodationSubtotalMinor),
            taxTotalMinor: BigInt(snapshot.taxTotalMinor),
            feeTotalMinor: BigInt(snapshot.feeTotalMinor),
            addonTotalMinor: BigInt(snapshot.addonTotalMinor),
            totalMinor: BigInt(snapshot.totalMinor),
            pricingFingerprint: snapshot.pricingFingerprint,
            issuerFingerprint: snapshot.issuerFingerprint,
            documentFingerprint,
            preparationSnapshot: toJsonInput(snapshot),
            createdByUserId: input.actorUserId,
          },
        });

        await transaction.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: 'payment.invoice-preparation.created',
            resourceType: 'hospitality-invoice-preparation',
            resourceId: created.id,
            afterData: {
              bookingId: booking.id,
              pricingEvidenceId: evidence.id,
              issuerProfileId: issuer.id,
              currency: snapshot.currency,
              totalMinor: snapshot.totalMinor,
              pricingFingerprint: snapshot.pricingFingerprint,
              issuerFingerprint: snapshot.issuerFingerprint,
              documentFingerprint,
            },
          },
        });

        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (
        error instanceof HospitalityInvoicePreparationUnavailableError
        || error instanceof HospitalityInvoicePreparationConflictError
        || error instanceof HospitalityInvoicePreparationPersistenceError
        || error instanceof InvoiceIssuerProfilePersistenceError
      ) {
        throw error;
      }
      if (!isRetryablePreparationWrite(error)) throw error;
      if (attempt === 2) throw new HospitalityInvoicePreparationWriteConflictError();
    }
  }
  throw new HospitalityInvoicePreparationWriteConflictError();
}
