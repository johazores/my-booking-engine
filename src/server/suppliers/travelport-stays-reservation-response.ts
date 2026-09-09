import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

const MAX_CORRELATION_LENGTH = 512;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;
const MAX_WARNINGS = 32;
const MAX_PRODUCT_TYPE_LENGTH = 64;

type RecordValue = Record<string, unknown>;

export type TravelportStaysReservationResponseEvidence = Readonly<{
  providerReservationReference: string;
  supplierConfirmationReference: string | null;
  providerCorrelationId: string | null;
}>;

export type TravelportStaysReservationRecoveryExpectation = Readonly<{
  chainCode: string;
  propertyCode: string;
  arrivalDateLocal: string;
  departureDateLocal: string;
  rooms: number;
  guests: number;
}>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }
  return value as RecordValue;
}

function boundedProviderValue(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) return null;
  return normalized;
}

function assertSupportedResultEvidence(response: RecordValue) {
  if (response.Result === undefined || response.Result === null) return;

  const result = record(response.Result);
  if (
    (result.Error !== undefined && result.Error !== null)
    || (result.Errors !== undefined && result.Errors !== null)
  ) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained embedded result error evidence.',
    );
  }

  const hasWarning = result.Warning !== undefined && result.Warning !== null;
  const hasWarnings = result.Warnings !== undefined && result.Warnings !== null;
  if (hasWarning && hasWarnings) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained conflicting result warning evidence.',
    );
  }
  if (!hasWarning && !hasWarnings) return;

  const warningValues = hasWarning ? result.Warning : result.Warnings;
  if (!Array.isArray(warningValues) || warningValues.length > MAX_WARNINGS) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained malformed or oversized result warning evidence.',
    );
  }

  for (const warningValue of warningValues) {
    const warning = record(warningValue);
    if (!boundedProviderValue(warning.Message, 512)) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained a malformed result warning message.',
      );
    }
  }
}

function assertExpectedReservationMatch(
  reservation: RecordValue,
  expected: TravelportStaysReservationRecoveryExpectation,
) {
  const offers = reservation.Offer;
  if (!Array.isArray(offers) || offers.length < 1 || offers.length > MAX_OFFERS) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }

  let matches = 0;
  let activeHospitalitySegments = 0;
  for (const offerValue of offers) {
    const offer = record(offerValue);
    const passiveOfferInd = offer.passiveOfferInd;
    if (
      passiveOfferInd !== undefined
      && passiveOfferInd !== null
      && typeof passiveOfferInd !== 'boolean'
    ) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed passive-offer evidence.',
      );
    }

    if (passiveOfferInd === true) continue;

    const products = offer.Product;
    if (!Array.isArray(products) || products.length < 1 || products.length > MAX_PRODUCTS_PER_OFFER) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed active offer product evidence.',
      );
    }

    for (const productValue of products) {
      const product = record(productValue);
      const productType = boundedProviderValue(product['@type'], MAX_PRODUCT_TYPE_LENGTH);
      if (!productType) {
        throw new HospitalitySupplierProviderError(
          'INVALID_RESPONSE',
          'Travelport reservation response contained malformed active product evidence.',
        );
      }
      if (productType !== 'ProductHospitality') continue;
      activeHospitalitySegments += 1;
      if (!product.PropertyKey || !product.DateRange) continue;
      const propertyKey = record(product.PropertyKey);
      const dateRange = record(product.DateRange);
      const chainCode = boundedProviderValue(propertyKey.chainCode, 16);
      const propertyCode = boundedProviderValue(propertyKey.propertyCode, 32);
      const arrivalDateLocal = boundedProviderValue(dateRange.start, 10);
      const departureDateLocal = boundedProviderValue(dateRange.end, 10);
      if (
        chainCode === expected.chainCode
        && propertyCode === expected.propertyCode
        && arrivalDateLocal === expected.arrivalDateLocal
        && departureDateLocal === expected.departureDateLocal
        && product.Quantity === expected.rooms
        && product.guests === expected.guests
      ) {
        matches += 1;
      }
    }
  }

  if (activeHospitalitySegments !== 1 || matches !== 1) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response did not contain exactly one active hospitality segment matching the durable reservation request.',
    );
  }
}

export function parseTravelportStaysReservationResponse(
  value: unknown,
  input: Readonly<{
    expectedProviderReservationReference?: string;
    expectedReservation?: TravelportStaysReservationRecoveryExpectation;
    requireConfirmedTravelportReceipt?: boolean;
  }> = {},
): TravelportStaysReservationResponseEvidence {
  const root = record(value);
  if (root.ErrorResponse !== undefined && root.ErrorResponse !== null) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained contradictory top-level error evidence.',
    );
  }

  const response = record(root.ReservationResponse);
  assertSupportedResultEvidence(response);

  const reservation = record(response.Reservation);
  const receiptEvidence = inspectTravelportStaysReservationReceiptEvidence(reservation.Receipt);
  if (!receiptEvidence.valid) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained malformed receipt evidence.',
    );
  }

  const travelportReceipts = receiptEvidence.travelportPnrReceipts;
  const supplierReceipts = receiptEvidence.supplierConfirmationReceipts;
  const supplierCancellationEvidence = receiptEvidence.supplierCancellationReceipts.length > 0;

  if (travelportReceipts.length !== 1) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response did not contain exactly one Travelport PNR locator receipt.',
    );
  }
  const providerReservationReference = travelportReceipts[0]!.reference;

  if (
    input.expectedProviderReservationReference !== undefined
    && providerReservationReference !== input.expectedProviderReservationReference
  ) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response did not match the requested reservation locator.',
    );
  }

  if (input.expectedReservation) {
    assertExpectedReservationMatch(reservation, input.expectedReservation);
  }

  if (input.requireConfirmedTravelportReceipt) {
    if (travelportReceipts[0]!.status !== 'Confirmed') {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response did not contain one confirmed Travelport PNR receipt.',
      );
    }
    if (supplierCancellationEvidence) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained supplier cancellation evidence.',
      );
    }
  }

  if (supplierReceipts.length > 1) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport returned multiple supplier confirmation receipts for a single-room reservation.',
    );
  }
  if (input.requireConfirmedTravelportReceipt && supplierReceipts.some((receipt) => receipt.status !== 'Confirmed')) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained an unconfirmed supplier confirmation receipt.',
    );
  }

  return Object.freeze({
    providerReservationReference,
    supplierConfirmationReference: supplierReceipts[0]?.reference ?? null,
    providerCorrelationId: boundedProviderValue(response.traceId ?? response.traceID, MAX_CORRELATION_LENGTH),
  });
}
