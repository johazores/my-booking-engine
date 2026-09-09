import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_REFERENCE_LENGTH = 512;
const MAX_CORRELATION_LENGTH = 512;
const MAX_RECEIPTS = 32;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;
const MAX_WARNINGS = 32;

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

function readOfferStatus(confirmation: RecordValue) {
  if (confirmation.OfferStatus === undefined || confirmation.OfferStatus === null) return null;
  const status = record(confirmation.OfferStatus);
  return boundedProviderValue(status.Status, 64);
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
  let hospitalitySegments = 0;
  for (const offerValue of offers) {
    if (!offerValue || typeof offerValue !== 'object' || Array.isArray(offerValue)) continue;
    const products = (offerValue as RecordValue).Product;
    if (!Array.isArray(products) || products.length > MAX_PRODUCTS_PER_OFFER) continue;

    for (const productValue of products) {
      if (!productValue || typeof productValue !== 'object' || Array.isArray(productValue)) continue;
      const product = productValue as RecordValue;
      if (product['@type'] !== 'ProductHospitality') continue;
      hospitalitySegments += 1;
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

  if (hospitalitySegments !== 1 || matches !== 1) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response did not contain exactly one hospitality segment matching the durable reservation request.',
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
  const receipts = reservation.Receipt;
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > MAX_RECEIPTS) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }

  const travelportReceipts: Array<Readonly<{ reference: string; status: string | null }>> = [];
  const supplierReceipts: Array<Readonly<{ reference: string; status: string | null }>> = [];

  for (const receiptValue of receipts) {
    if (!receiptValue || typeof receiptValue !== 'object' || Array.isArray(receiptValue)) continue;
    const confirmationValue = (receiptValue as RecordValue).Confirmation;
    if (!confirmationValue || typeof confirmationValue !== 'object' || Array.isArray(confirmationValue)) continue;
    const confirmation = confirmationValue as RecordValue;
    const locatorValue = confirmation.Locator;
    if (!locatorValue || typeof locatorValue !== 'object' || Array.isArray(locatorValue)) continue;
    const locator = locatorValue as RecordValue;
    const sourceContext = boundedProviderValue(locator.sourceContext, 64);
    const locatorType = boundedProviderValue(locator.locatorType, 64);
    if (!sourceContext || !locatorType) continue;

    if (sourceContext === 'Travelport' && locatorType === 'PNR Locator') {
      const reference = boundedProviderValue(locator.value, MAX_REFERENCE_LENGTH);
      if (!reference) {
        throw new HospitalitySupplierProviderError(
          'INVALID_RESPONSE',
          'Travelport reservation response contained an invalid Travelport PNR locator receipt.',
        );
      }
      travelportReceipts.push(Object.freeze({ reference, status: readOfferStatus(confirmation) }));
    } else if (sourceContext === 'Supplier' && locatorType === 'Confirmation Number') {
      const reference = boundedProviderValue(locator.value, MAX_REFERENCE_LENGTH);
      if (!reference) {
        throw new HospitalitySupplierProviderError(
          'INVALID_RESPONSE',
          'Travelport reservation response contained an invalid supplier confirmation receipt.',
        );
      }
      supplierReceipts.push(Object.freeze({ reference, status: readOfferStatus(confirmation) }));
    }
  }

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
        'Travelport create response did not contain one confirmed Travelport PNR receipt.',
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
      'Travelport create response contained an unconfirmed supplier receipt.',
    );
  }

  return Object.freeze({
    providerReservationReference,
    supplierConfirmationReference: supplierReceipts[0]?.reference ?? null,
    providerCorrelationId: boundedProviderValue(response.traceId ?? response.traceID, MAX_CORRELATION_LENGTH),
  });
}
