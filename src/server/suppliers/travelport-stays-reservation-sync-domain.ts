import type { NormalizedHospitalitySupplierReservationTravelerPayload } from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  classifyTravelportStaysReservationCreateOutcome,
  type TravelportStaysCreateExpectedReservation,
} from './travelport-stays-reservation-create-outcome.ts';
import {
  parseTravelportStaysSyncRecoveryReference,
} from './travelport-stays-sync-recovery-reference.ts';

const MAX_CONFIRMATION_LENGTH = 512;

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
    Traveler: readonly [Readonly<{
      '@type': 'Traveler';
      Email: readonly [Readonly<{ value: string }>];
    }>];
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

export function buildTravelportStaysReservationSyncRequest(input: Readonly<{
  providerRecoveryReference: unknown;
  supplierConfirmationReference: unknown;
  traveler: NormalizedHospitalitySupplierReservationTravelerPayload;
}>): TravelportStaysReservationSyncRequest {
  const recovery = parseTravelportStaysSyncRecoveryReference(input.providerRecoveryReference);
  const supplierConfirmationReference = confirmationReference(input.supplierConfirmationReference);
  if (!input.traveler || typeof input.traveler !== 'object' || Array.isArray(input.traveler)) {
    throw new Error('Travelport Sync traveler authority is required.');
  }
  if (typeof input.traveler.email !== 'string' || !input.traveler.email) {
    throw new Error('Travelport Sync traveler email authority is required.');
  }

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
      Traveler: Object.freeze([
        Object.freeze({
          '@type': 'Traveler' as const,
          Email: Object.freeze([
            Object.freeze({ value: input.traveler.email }),
          ]) as TravelportStaysReservationSyncRequest['ReservationDetail']['Traveler'][0]['Email'],
        }),
      ]) as TravelportStaysReservationSyncRequest['ReservationDetail']['Traveler'],
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
    body: input.body,
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
