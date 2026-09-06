import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const MAX_REFERENCE_LENGTH = 512;
const MAX_CORRELATION_LENGTH = 512;
const MAX_RECEIPTS = 32;

type RecordValue = Record<string, unknown>;

export type TravelportStaysReservationResponseEvidence = Readonly<{
  providerReservationReference: string;
  supplierConfirmationReference: string | null;
  providerCorrelationId: string | null;
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

export function parseTravelportStaysReservationResponse(
  value: unknown,
  input: Readonly<{
    expectedProviderReservationReference?: string;
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
