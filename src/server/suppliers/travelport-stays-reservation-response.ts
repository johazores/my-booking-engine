import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_REFERENCE_LENGTH = 512;
const MAX_CORRELATION_LENGTH = 512;
const MAX_RECEIPTS = 32;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;

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

function assertExpectedReservationMatch(
  reservation: RecordValue,
  expected: TravelportStaysReservationRecoveryExpectation,
) {
  const offers = reservation.Offer;
  if (!Array.isArray(offers) || offers.length < 1 || offers.length > MAX_OFFERS) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }

  let matches = 0;
  for (const offerValue of offers) {
    if (!offerValue || typeof offerValue !== 'object' || Array.isArray(offerValue)) continue;
    const products = (offerValue as RecordValue).Product;
    if (!Array.isArray(products) || products.length > MAX_PRODUCTS_PER_OFFER) continue;

    for (const productValue of products) {
      if (!productValue || typeof productValue !== 'object' || Array.isArray(productValue)) continue;
      const product = productValue as RecordValue;
      if (product['@type'] !== 'ProductHospitality') continue;
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

  if (matches !== 1) {
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
  const response = record(record(value).ReservationResponse);
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
    const reference = boundedProviderValue(locator.value, MAX_REFERENCE_LENGTH);
    const sourceContext = boundedProviderValue(locator.sourceContext, 64);
    if (!reference || !sourceContext) continue;

    if (sourceContext === 'Travelport') {
      travelportReceipts.push(Object.freeze({ reference, status: readOfferStatus(confirmation) }));
    } else if (sourceContext === 'Supplier') {
      supplierReceipts.push(Object.freeze({ reference, status: readOfferStatus(confirmation) }));
    }
  }

  const providerReferences = [...new Set(travelportReceipts.map((receipt) => receipt.reference))];
  if (providerReferences.length !== 1) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response did not contain exactly one aggregator locator.',
    );
  }
  const providerReservationReference = providerReferences[0]!;

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
    if (
      travelportReceipts.length !== 1
      || travelportReceipts[0]!.reference !== providerReservationReference
      || travelportReceipts[0]!.status !== 'Confirmed'
    ) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport create response did not contain one confirmed aggregator receipt.',
      );
    }
  }

  const uniqueSupplierReferences = [...new Set(supplierReceipts.map((receipt) => receipt.reference))];
  if (uniqueSupplierReferences.length > 1) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport returned multiple supplier confirmation references for a single-room reservation.',
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
    supplierConfirmationReference: uniqueSupplierReferences[0] ?? null,
    providerCorrelationId: boundedProviderValue(response.traceId ?? response.traceID, MAX_CORRELATION_LENGTH),
  });
}
