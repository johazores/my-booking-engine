import type { Prisma } from '../../generated/prisma/client.ts';
import { requireOrganizationPermission } from '../authorization/authorization-service.ts';
import { db } from '../database.ts';
import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  AustralianTaxInvoiceReadinessPersistenceError,
  AustralianTaxInvoiceReadinessUnavailableError,
  verifyHospitalityAustralianTaxInvoicePreparation,
} from './australian-tax-invoice-readiness-service.ts';
import {
  HospitalityIssuedInvoiceValidationError,
  canonicalHospitalityIssuedInvoiceJson,
  createHospitalityIssuedTaxInvoiceSnapshot,
  formatAustralianTaxInvoiceDocumentNumber,
  hospitalityIssuedInvoiceFingerprint,
  parseHospitalityIssuedTaxInvoiceSnapshot,
} from './hospitality-issued-invoice-domain.ts';

export class HospitalityInvoiceIssuanceUnavailableError extends Error {
  constructor(message = 'Tax invoice issuance is not available for this booking preparation.') {
    super(message);
    this.name = 'HospitalityInvoiceIssuanceUnavailableError';
  }
}

export class HospitalityInvoiceIssuanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInvoiceIssuanceConflictError';
  }
}

export class HospitalityInvoiceIssuancePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityInvoiceIssuancePersistenceError';
  }
}

export class HospitalityInvoiceIssuanceWriteConflictError extends Error {
  constructor() {
    super('Tax invoice issuance changed concurrently. Retry the operation.');
    this.name = 'HospitalityInvoiceIssuanceWriteConflictError';
  }
}

function prismaErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return null;
  return error.code;
}

function isRetryableInvoiceWrite(error: unknown) {
  const code = prismaErrorCode(error);
  return code === 'P2002' || code === 'P2034';
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalHospitalityIssuedInvoiceJson(value)) as Prisma.InputJsonValue;
}

function assertPersistedIssuedInvoice(row: {
  organizationId: string;
  bookingId: string;
  preparationId: string;
  pricingEvidenceId: string;
  issuerProfileId: string;
  jurisdictionCode: string;
  documentType: string;
  documentNumber: string;
  sequenceValue: bigint;
  issuedAt: Date;
  currency: string;
  accommodationSubtotalMinor: bigint;
  taxTotalMinor: bigint;
  feeTotalMinor: bigint;
  addonTotalMinor: bigint;
  totalMinor: bigint;
  preparationFingerprint: string;
  pricingFingerprint: string;
  issuerFingerprint: string;
  recipientFingerprint: string;
  documentFingerprint: string;
  documentSnapshot: Prisma.JsonValue;
}) {
  let snapshot;
  try {
    snapshot = parseHospitalityIssuedTaxInvoiceSnapshot(row.documentSnapshot);
  } catch (error) {
    if (error instanceof HospitalityIssuedInvoiceValidationError) {
      throw new HospitalityInvoiceIssuancePersistenceError(error.message);
    }
    throw error;
  }
  if (
    row.jurisdictionCode !== 'AU'
    || row.documentType !== 'TAX_INVOICE'
    || snapshot.organizationId !== row.organizationId
    || snapshot.bookingId !== row.bookingId
    || snapshot.preparationId !== row.preparationId
    || snapshot.pricingEvidenceId !== row.pricingEvidenceId
    || snapshot.issuerProfileId !== row.issuerProfileId
    || snapshot.documentNumber !== row.documentNumber
    || BigInt(snapshot.sequenceValue) !== row.sequenceValue
    || new Date(snapshot.issuedAt).getTime() !== row.issuedAt.getTime()
    || snapshot.currency !== row.currency
    || BigInt(snapshot.accommodationSubtotalMinor) !== row.accommodationSubtotalMinor
    || BigInt(snapshot.taxTotalMinor) !== row.taxTotalMinor
    || BigInt(snapshot.feeTotalMinor) !== row.feeTotalMinor
    || BigInt(snapshot.addonTotalMinor) !== row.addonTotalMinor
    || BigInt(snapshot.totalMinor) !== row.totalMinor
    || snapshot.preparationFingerprint !== row.preparationFingerprint
    || snapshot.pricingFingerprint !== row.pricingFingerprint
    || snapshot.issuerFingerprint !== row.issuerFingerprint
    || snapshot.recipientFingerprint !== row.recipientFingerprint
    || hospitalityIssuedInvoiceFingerprint(snapshot) !== row.documentFingerprint
  ) {
    throw new HospitalityInvoiceIssuancePersistenceError('Persisted issued tax invoice failed integrity validation.');
  }
  return snapshot;
}

export async function issueHospitalityAustralianTaxInvoice(input: {
  organizationId: string;
  actorUserId: string;
  bookingId: string;
  preparationId: string;
}) {
  assertUuidIdentifier(input.organizationId, 'organizationId');
  assertUuidIdentifier(input.actorUserId, 'actorUserId');
  assertUuidIdentifier(input.bookingId, 'bookingId');
  assertUuidIdentifier(input.preparationId, 'preparationId');

  await requireOrganizationPermission({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    permission: 'payment:manage',
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.$transaction(async (transaction) => {
        const existing = await transaction.hospitalityIssuedInvoice.findFirst({
          where: {
            organizationId: input.organizationId,
            preparationId: input.preparationId,
          },
        });
        if (existing) {
          if (existing.bookingId !== input.bookingId) throw new HospitalityInvoiceIssuanceUnavailableError();
          assertPersistedIssuedInvoice(existing);
          return existing;
        }

        let verified;
        try {
          verified = await verifyHospitalityAustralianTaxInvoicePreparation({
            transaction,
            organizationId: input.organizationId,
            preparationId: input.preparationId,
          });
        } catch (error) {
          if (error instanceof AustralianTaxInvoiceReadinessUnavailableError) {
            throw new HospitalityInvoiceIssuanceUnavailableError();
          }
          if (error instanceof AustralianTaxInvoiceReadinessPersistenceError) {
            throw new HospitalityInvoiceIssuancePersistenceError(error.message);
          }
          throw error;
        }
        const { preparation, preparationSnapshot, booking, issuerSnapshot, pricingBreakdown, assessment } = verified;
        if (booking.id !== input.bookingId) throw new HospitalityInvoiceIssuanceUnavailableError();
        if (!assessment.contentReady || !assessment.supplierAbn) {
          const requirementCodes = assessment.requirements.map((entry) => entry.code).join(', ');
          throw new HospitalityInvoiceIssuanceConflictError(
            requirementCodes
              ? `Australian tax-invoice content is not ready: ${requirementCodes}.`
              : 'Australian tax-invoice content is not ready.',
          );
        }

        const sequence = await transaction.hospitalityInvoiceNumberSequence.upsert({
          where: {
            organizationId_jurisdictionCode_documentType: {
              organizationId: input.organizationId,
              jurisdictionCode: 'AU',
              documentType: 'TAX_INVOICE',
            },
          },
          create: {
            organizationId: input.organizationId,
            jurisdictionCode: 'AU',
            documentType: 'TAX_INVOICE',
            nextValue: 2n,
          },
          update: { nextValue: { increment: 1n } },
          select: { nextValue: true },
        });
        const sequenceValue = sequence.nextValue - 1n;
        const documentNumber = formatAustralianTaxInvoiceDocumentNumber(sequenceValue);
        const issuedAt = new Date();
        const snapshot = createHospitalityIssuedTaxInvoiceSnapshot({
          organizationId: input.organizationId,
          bookingId: booking.id,
          preparationId: preparation.id,
          pricingEvidenceId: preparation.pricingEvidenceId,
          issuerProfileId: preparation.issuerProfileId,
          documentNumber,
          sequenceValue,
          issuedAt,
          currency: preparation.currency,
          accommodationSubtotalMinor: preparation.accommodationSubtotalMinor,
          taxTotalMinor: preparation.taxTotalMinor,
          feeTotalMinor: preparation.feeTotalMinor,
          addonTotalMinor: preparation.addonTotalMinor,
          totalMinor: preparation.totalMinor,
          preparationFingerprint: preparation.documentFingerprint,
          pricingFingerprint: preparation.pricingFingerprint,
          issuerFingerprint: preparation.issuerFingerprint,
          recipientFingerprint: preparationSnapshot.recipientFingerprint,
          issuer: issuerSnapshot,
          recipient: preparationSnapshot.recipient,
          pricing: pricingBreakdown,
          supplierAbn: assessment.supplierAbn,
          buyerIdentityRequired: assessment.buyerIdentityRequired,
          buyerIdentity: assessment.buyerIdentity,
          buyerAbn: assessment.buyerAbn,
        });
        const documentFingerprint = hospitalityIssuedInvoiceFingerprint(snapshot);

        const created = await transaction.hospitalityIssuedInvoice.create({
          data: {
            organizationId: input.organizationId,
            bookingId: booking.id,
            preparationId: preparation.id,
            pricingEvidenceId: preparation.pricingEvidenceId,
            issuerProfileId: preparation.issuerProfileId,
            jurisdictionCode: 'AU',
            documentType: 'TAX_INVOICE',
            documentNumber,
            sequenceValue,
            issuedByUserId: input.actorUserId,
            issuedAt,
            currency: preparation.currency,
            accommodationSubtotalMinor: preparation.accommodationSubtotalMinor,
            taxTotalMinor: preparation.taxTotalMinor,
            feeTotalMinor: preparation.feeTotalMinor,
            addonTotalMinor: preparation.addonTotalMinor,
            totalMinor: preparation.totalMinor,
            preparationFingerprint: preparation.documentFingerprint,
            pricingFingerprint: preparation.pricingFingerprint,
            issuerFingerprint: preparation.issuerFingerprint,
            recipientFingerprint: preparationSnapshot.recipientFingerprint,
            documentFingerprint,
            documentSnapshot: toJsonInput(snapshot),
          },
        });
        assertPersistedIssuedInvoice(created);

        await transaction.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: 'payment.tax-invoice.issued',
            resourceType: 'hospitality-issued-invoice',
            resourceId: created.id,
            afterData: {
              bookingId: booking.id,
              preparationId: preparation.id,
              jurisdictionCode: 'AU',
              documentType: 'TAX_INVOICE',
              documentNumber,
              sequenceValue: sequenceValue.toString(),
              currency: preparation.currency,
              totalMinor: preparation.totalMinor.toString(),
              preparationFingerprint: preparation.documentFingerprint,
              documentFingerprint,
            },
          },
        });

        return created;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (
        error instanceof HospitalityInvoiceIssuanceUnavailableError
        || error instanceof HospitalityInvoiceIssuanceConflictError
        || error instanceof HospitalityInvoiceIssuancePersistenceError
      ) {
        throw error;
      }
      if (!isRetryableInvoiceWrite(error)) throw error;
      if (attempt === 2) throw new HospitalityInvoiceIssuanceWriteConflictError();
    }
  }

  throw new HospitalityInvoiceIssuanceWriteConflictError();
}
