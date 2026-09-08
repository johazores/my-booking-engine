import type { NormalizedHospitalitySupplierReservationTravelerPayload } from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  classifyTravelportStaysReservationCreateOutcome,
  type TravelportStaysCreateExpectedReservation,
} from './travelport-stays-reservation-create-outcome.ts';
import {
  buildTravelportStaysReservationTravelerRequest,
  type TravelportStaysReservationTravelerRequest,
} from './travelport-stays-reservation-traveler-request.ts';
import {
  parseTravelportStaysSyncRecoveryReference,
} from './travelport-stays-sync-recovery-reference.ts';

const MAX_CONFIRMATION_LENGTH = 512;

type RecordValue = Record<string, unknown>;

export type TravelportStaysReservationSyncRequest = Readonly<{
  ReservationDetail: Readonly<{
    Offer: readonly [Readonly<{
      Identifier: Readonly<{ authority: string }>;
      passiveOfferInd: true;
    }>];
    Receipt: readonly [Readonly<{
      '@type': 'ReceiptConfirmation';
      Confirmation: Readonly<{
        '@type': 'ConfirmationHold';
        Locator: Readonly<{
          locatorType: 'Confirmation Number';
          source: 'BO';
          sourceContext: 'Supplier';
          value: string;
        }>;
      }>;
    }>];
    Traveler: readonly [TravelportStaysReservationTravelerRequest];
  }>;
}>;

export type TravelportStaysReservationSyncOutcome =
  | Readonly<{
      status: 'CONFIRMED';
      providerReservationReference: string;
      supplierConfirmationReference: string;
      providerCorrelationId: string | null;
    }>
  | Readonly<{
      status: 'AMBIGUOUS';
      failureCode: 'INVALID_RESPONSE';
      providerCorrelationId: string | null;
    }>;

function optionalRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function confirmationReference(value: unknown) {
  if (typeof value !== 'string') throw new Error('Travelport Sync supplier confirmation is required.');
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > MAX_CONFIRMATION_LENGTH
    || /[\r\n]/.test(normalized)
  ) {
    throw new Error('Travelport Sync supplier confirmation is invalid.');
  }
  return normalized;
}

/**
 * Travelport's current Sync Reservation example omits locatorType on the confirmed
 * Travelport receipt even though Create responses normally identify that locator as
 * "PNR Locator". Canonicalize only that documented Sync-only omission so the shared
 * strict Create classifier can continue owning all other reservation/receipt checks.
 * Explicit locator types are never rewritten and the provider payload is not mutated.
 */
function normalizeDocumentedTravelportSyncProviderLocator(value: unknown): unknown {
  const root = optionalRecord(value);
  const response = optionalRecord(root?.ReservationResponse);
  const reservation = optionalRecord(response?.Reservation);
  const receipts = reservation?.Receipt;
  if (!root || !response || !reservation || !Array.isArray(receipts)) return value;

  let changed = false;
  const normalizedReceipts = receipts.map((receiptValue) => {
    const receipt = optionalRecord(receiptValue);
    const confirmation = optionalRecord(receipt?.Confirmation);
    const locator = optionalRecord(confirmation?.Locator);
    if (!receipt || !confirmation || !locator) return receiptValue;
    if (locator.sourceContext !== 'Travelport' || locator.locatorType !== undefined) return receiptValue;

    changed = true;
    return {
      ...receipt,
      Confirmation: {
        ...confirmation,
        Locator: {
          ...locator,
          locatorType: 'PNR Locator',
        },
      },
    };
  });

  if (!changed) return value;
  return {
    ...root,
    ReservationResponse: {
      ...response,
      Reservation: {
        ...reservation,
        Receipt: normalizedReceipts,
      },
    },
  };
}

export function buildTravelportStaysReservationSyncRequest(input: Readonly<{
  providerRecoveryReference: unknown;
  supplierConfirmationReference: unknown;
  traveler: NormalizedHospitalitySupplierReservationTravelerPayload;
}>): TravelportStaysReservationSyncRequest {
  const recovery = parseTravelportStaysSyncRecoveryReference(input.providerRecoveryReference);
  const supplierConfirmationReference = confirmationReference(input.supplierConfirmationReference);
  const traveler = buildTravelportStaysReservationTravelerRequest(input.traveler);

  return Object.freeze({
    ReservationDetail: Object.freeze({
      Offer: Object.freeze([
        Object.freeze({
          Identifier: Object.freeze({ authority: recovery.offerAuthority }),
          passiveOfferInd: true as const,
        }),
      ]) as TravelportStaysReservationSyncRequest['ReservationDetail']['Offer'],
      Receipt: Object.freeze([
        Object.freeze({
          '@type': 'ReceiptConfirmation' as const,
          Confirmation: Object.freeze({
            '@type': 'ConfirmationHold' as const,
            Locator: Object.freeze({
              locatorType: 'Confirmation Number' as const,
              source: recovery.supplierSource,
              sourceContext: 'Supplier' as const,
              value: supplierConfirmationReference,
            }),
          }),
        }),
      ]) as TravelportStaysReservationSyncRequest['ReservationDetail']['Receipt'],
      Traveler: Object.freeze([traveler]) as TravelportStaysReservationSyncRequest['ReservationDetail']['Traveler'],
    }),
  });
}

export function classifyTravelportStaysReservationSyncOutcome(input: Readonly<{
  httpStatus: number;
  body: unknown;
  expectedReservation: TravelportStaysCreateExpectedReservation;
  supplierConfirmationReference: string;
}>): TravelportStaysReservationSyncOutcome {
  const expectedSupplierConfirmation = confirmationReference(input.supplierConfirmationReference);
  const createShape = classifyTravelportStaysReservationCreateOutcome({
    httpStatus: input.httpStatus,
    body: normalizeDocumentedTravelportSyncProviderLocator(input.body),
    expectedReservation: input.expectedReservation,
  });

  if (
    createShape.status === 'CONFIRMED'
    && createShape.supplierConfirmationReference === expectedSupplierConfirmation
  ) {
    return Object.freeze({
      status: 'CONFIRMED',
      providerReservationReference: createShape.providerReservationReference,
      supplierConfirmationReference: expectedSupplierConfirmation,
      providerCorrelationId: createShape.providerCorrelationId,
    });
  }

  return Object.freeze({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    providerCorrelationId: createShape.providerCorrelationId,
  });
}
