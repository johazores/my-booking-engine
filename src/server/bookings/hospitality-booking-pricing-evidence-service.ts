import type { Prisma } from '../../generated/prisma/client.ts';
import type { HospitalityAddonSelectionInput } from '../pricing/hospitality-addon-domain.ts';
import type { quoteHospitalityPriceFromReader } from '../pricing/hospitality-transactional-pricing.ts';
import {
  HospitalityBookingPricingEvidenceValidationError,
  assertHospitalityBookingPricingEvidenceMatchesCommercialState,
  assertHospitalityBookingPricingQuoteMatchesCommercialState,
  parseHospitalityBookingPricingEvidenceBreakdown,
  type HospitalityBookingPricingEvidenceCommercialState,
} from './booking-pricing-evidence-domain.ts';
import type { HospitalityPricingBreakdownSnapshot } from './booking-domain.ts';

export type HospitalityBookingPricingEvidenceSource =
  | 'BOOKING_CONFIRMATION'
  | 'BOOKING_RESCHEDULE'
  | 'BOOKING_COMMERCIAL_MODIFICATION'
  | 'COMMERCIAL_AMENDMENT_TARGET'
  | 'COMMERCIAL_AMENDMENT_APPLY';

type PricingQuote = Awaited<ReturnType<typeof quoteHospitalityPriceFromReader>>;

export class HospitalityBookingPricingEvidencePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HospitalityBookingPricingEvidencePersistenceError';
  }
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sameDate(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function assertEvidenceRowMatchesExpected(input: {
  evidence: {
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
  state: HospitalityBookingPricingEvidenceCommercialState;
  expectedPrice: {
    currency: string;
    accommodationSubtotalMinor: bigint;
    taxTotalMinor: bigint;
    feeTotalMinor: bigint;
    addonTotalMinor: bigint;
    totalMinor: bigint;
    pricingFingerprint: string;
  };
}) {
  const { evidence, state, expectedPrice } = input;
  if (
    evidence.propertyId !== state.propertyId
    || evidence.roomTypeId !== state.roomTypeId
    || evidence.ratePlanId !== state.ratePlanId
    || !sameDate(evidence.arrivalDate, state.arrivalDate)
    || !sameDate(evidence.departureDate, state.departureDate)
    || evidence.quantity !== state.quantity
    || evidence.currency !== expectedPrice.currency
    || evidence.accommodationSubtotalMinor !== expectedPrice.accommodationSubtotalMinor
    || evidence.taxTotalMinor !== expectedPrice.taxTotalMinor
    || evidence.feeTotalMinor !== expectedPrice.feeTotalMinor
    || evidence.addonTotalMinor !== expectedPrice.addonTotalMinor
    || evidence.totalMinor !== expectedPrice.totalMinor
    || evidence.pricingFingerprint !== expectedPrice.pricingFingerprint
  ) {
    throw new HospitalityBookingPricingEvidencePersistenceError(
      'Persisted commercial-amendment pricing evidence does not match the authoritative target state.',
    );
  }

  try {
    const breakdown = parseHospitalityBookingPricingEvidenceBreakdown(evidence.pricingBreakdown);
    assertHospitalityBookingPricingEvidenceMatchesCommercialState({ breakdown, state });
    if (
      breakdown.currency !== expectedPrice.currency
      || BigInt(breakdown.accommodationSubtotalMinor) !== expectedPrice.accommodationSubtotalMinor
      || BigInt(breakdown.taxTotalMinor) !== expectedPrice.taxTotalMinor
      || BigInt(breakdown.feeTotalMinor) !== expectedPrice.feeTotalMinor
      || BigInt(breakdown.addonTotalMinor) !== expectedPrice.addonTotalMinor
      || BigInt(breakdown.totalMinor) !== expectedPrice.totalMinor
      || breakdown.pricingFingerprint !== expectedPrice.pricingFingerprint
    ) {
      throw new HospitalityBookingPricingEvidencePersistenceError(
        'Persisted commercial-amendment pricing breakdown does not reconcile to the authoritative target price.',
      );
    }
    return breakdown;
  } catch (error) {
    if (error instanceof HospitalityBookingPricingEvidencePersistenceError) throw error;
    if (error instanceof HospitalityBookingPricingEvidenceValidationError) {
      throw new HospitalityBookingPricingEvidencePersistenceError(error.message);
    }
    throw error;
  }
}

export async function persistHospitalityBookingPricingEvidence(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId?: string | null;
  evidenceKey: string;
  source: HospitalityBookingPricingEvidenceSource;
  bookingVersion: Date;
  state: HospitalityBookingPricingEvidenceCommercialState;
  quote: PricingQuote;
}) {
  let breakdown: HospitalityPricingBreakdownSnapshot;
  try {
    breakdown = assertHospitalityBookingPricingQuoteMatchesCommercialState({
      quote: input.quote,
      state: input.state,
    });
  } catch (error) {
    if (error instanceof HospitalityBookingPricingEvidenceValidationError) {
      throw new HospitalityBookingPricingEvidencePersistenceError(error.message);
    }
    throw error;
  }
  return persistHospitalityBookingPricingEvidenceSnapshot({ ...input, breakdown });
}

export async function persistHospitalityBookingPricingEvidenceSnapshot(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  commercialAmendmentId?: string | null;
  evidenceKey: string;
  source: HospitalityBookingPricingEvidenceSource;
  bookingVersion: Date;
  state: HospitalityBookingPricingEvidenceCommercialState;
  breakdown: HospitalityPricingBreakdownSnapshot;
}) {
  try {
    assertHospitalityBookingPricingEvidenceMatchesCommercialState({
      breakdown: input.breakdown,
      state: input.state,
    });
  } catch (error) {
    if (error instanceof HospitalityBookingPricingEvidenceValidationError) {
      throw new HospitalityBookingPricingEvidencePersistenceError(error.message);
    }
    throw error;
  }

  return input.transaction.hospitalityBookingPricingEvidence.create({
    data: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.commercialAmendmentId ?? null,
      evidenceKey: input.evidenceKey,
      source: input.source,
      bookingVersion: input.bookingVersion,
      propertyId: input.state.propertyId,
      roomTypeId: input.state.roomTypeId,
      ratePlanId: input.state.ratePlanId,
      arrivalDate: input.state.arrivalDate,
      departureDate: input.state.departureDate,
      quantity: input.state.quantity,
      addonSelections: toJsonInput(input.state.addonSelections),
      currency: input.breakdown.currency,
      accommodationSubtotalMinor: BigInt(input.breakdown.accommodationSubtotalMinor),
      taxTotalMinor: BigInt(input.breakdown.taxTotalMinor),
      feeTotalMinor: BigInt(input.breakdown.feeTotalMinor),
      addonTotalMinor: BigInt(input.breakdown.addonTotalMinor),
      totalMinor: BigInt(input.breakdown.totalMinor),
      pricingFingerprint: input.breakdown.pricingFingerprint,
      pricingBreakdown: toJsonInput(input.breakdown),
    },
  });
}

export async function readHospitalityCommercialAmendmentTargetPricingEvidence(input: {
  transaction: Prisma.TransactionClient;
  organizationId: string;
  bookingId: string;
  amendmentId: string;
  state: HospitalityBookingPricingEvidenceCommercialState;
  expectedPrice: {
    currency: string;
    accommodationSubtotalMinor: bigint;
    taxTotalMinor: bigint;
    feeTotalMinor: bigint;
    addonTotalMinor: bigint;
    totalMinor: bigint;
    pricingFingerprint: string;
  };
}) {
  const evidence = await input.transaction.hospitalityBookingPricingEvidence.findFirst({
    where: {
      organizationId: input.organizationId,
      bookingId: input.bookingId,
      commercialAmendmentId: input.amendmentId,
      source: 'COMMERCIAL_AMENDMENT_TARGET',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (!evidence) return null;

  const breakdown = assertEvidenceRowMatchesExpected({
    evidence,
    state: input.state,
    expectedPrice: input.expectedPrice,
  });
  return { evidence, breakdown };
}
