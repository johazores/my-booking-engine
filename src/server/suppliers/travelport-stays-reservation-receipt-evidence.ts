const MAX_RECEIPTS = 32;
const MAX_RECEIPT_TYPE_LENGTH = 64;
const MAX_CONFIRMATION_TYPE_LENGTH = 64;
const MAX_REFERENCE_LENGTH = 512;
const MAX_LOCATOR_CONTEXT_LENGTH = 64;
const MAX_LOCATOR_TYPE_LENGTH = 64;
const MAX_LOCATOR_SOURCE_LENGTH = 16;
const MAX_OFFER_STATUS_TYPE_LENGTH = 64;
const MAX_STATUS_LENGTH = 64;

type RecordValue = Record<string, unknown>;

export type TravelportStaysLocatorReceiptEvidence = Readonly<{
  reference: string;
  status: string | null;
  source: string | null;
}>;

export type TravelportStaysReservationReceiptEvidence = Readonly<{
  valid: boolean;
  travelportPnrReceipts: readonly TravelportStaysLocatorReceiptEvidence[];
  supplierConfirmationReceipts: readonly TravelportStaysLocatorReceiptEvidence[];
  supplierCancellationReceipts: readonly TravelportStaysLocatorReceiptEvidence[];
}>;

function optionalRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function boundedProviderValue(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) return null;
  return normalized;
}

function invalidEvidence(): TravelportStaysReservationReceiptEvidence {
  return Object.freeze({
    valid: false,
    travelportPnrReceipts: Object.freeze([] as TravelportStaysLocatorReceiptEvidence[]),
    supplierConfirmationReceipts: Object.freeze([] as TravelportStaysLocatorReceiptEvidence[]),
    supplierCancellationReceipts: Object.freeze([] as TravelportStaysLocatorReceiptEvidence[]),
  });
}

function normalizedReceipt(
  locator: RecordValue,
  confirmation: RecordValue,
  requireHospitalityDiscriminators: boolean,
): TravelportStaysLocatorReceiptEvidence | null {
  const rawConfirmationType = confirmation['@type'];
  if (requireHospitalityDiscriminators && rawConfirmationType !== undefined && rawConfirmationType !== null) {
    const confirmationType = boundedProviderValue(rawConfirmationType, MAX_CONFIRMATION_TYPE_LENGTH);
    if (confirmationType !== 'ConfirmationHold') return null;
  }

  const reference = boundedProviderValue(locator.value, MAX_REFERENCE_LENGTH);
  if (!reference) return null;

  const rawSource = locator.source;
  const source = rawSource === undefined || rawSource === null
    ? null
    : boundedProviderValue(rawSource, MAX_LOCATOR_SOURCE_LENGTH);
  if (rawSource !== undefined && rawSource !== null && !source) return null;

  const offerStatus = confirmation.OfferStatus;
  let status: string | null = null;
  if (offerStatus !== undefined && offerStatus !== null) {
    const statusRecord = optionalRecord(offerStatus);
    if (!statusRecord) return null;

    const rawOfferStatusType = statusRecord['@type'];
    if (requireHospitalityDiscriminators && rawOfferStatusType !== undefined && rawOfferStatusType !== null) {
      const offerStatusType = boundedProviderValue(rawOfferStatusType, MAX_OFFER_STATUS_TYPE_LENGTH);
      if (offerStatusType !== 'OfferStatusHospitality') return null;
    }

    status = boundedProviderValue(statusRecord.Status, MAX_STATUS_LENGTH);
    if (!status) return null;
  }

  return Object.freeze({ reference, status, source });
}

/**
 * Normalizes only Travelport Stays locator families that can influence durable
 * reservation identity. Unrelated multi-content ReceiptPayment /
 * ReceiptCancellation records and generic confirmation locators without Stays
 * locator semantics are ignored, while malformed, partial, or contradictory
 * Stays locator evidence fails closed. Documented Booking.com Supplier + Pin
 * code receipts are structurally validated but remain non-durable evidence.
 */
export function inspectTravelportStaysReservationReceiptEvidence(
  value: unknown,
): TravelportStaysReservationReceiptEvidence {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RECEIPTS) {
    return invalidEvidence();
  }

  const travelportPnrReceipts: TravelportStaysLocatorReceiptEvidence[] = [];
  const supplierConfirmationReceipts: TravelportStaysLocatorReceiptEvidence[] = [];
  const supplierCancellationReceipts: TravelportStaysLocatorReceiptEvidence[] = [];

  for (const receiptValue of value) {
    const receipt = optionalRecord(receiptValue);
    if (!receipt) return invalidEvidence();

    const rawReceiptType = receipt['@type'];
    if (rawReceiptType !== undefined && rawReceiptType !== null) {
      const receiptType = boundedProviderValue(rawReceiptType, MAX_RECEIPT_TYPE_LENGTH);
      if (!receiptType) return invalidEvidence();
      if (receiptType === 'ReceiptPayment' || receiptType === 'ReceiptCancellation') continue;
      if (receiptType !== 'ReceiptConfirmation') return invalidEvidence();
    }

    const confirmation = optionalRecord(receipt.Confirmation);
    const locator = optionalRecord(confirmation?.Locator);
    if (!confirmation || !locator) return invalidEvidence();

    const rawSourceContext = locator.sourceContext;
    const rawLocatorType = locator.locatorType;
    const hasSourceContext = rawSourceContext !== undefined && rawSourceContext !== null;
    const hasLocatorType = rawLocatorType !== undefined && rawLocatorType !== null;

    if (!hasSourceContext && !hasLocatorType) {
      // Generic multi-content confirmation locators (for example air content)
      // do not use the Stays sourceContext + locatorType identity pair.
      continue;
    }

    const sourceContext = hasSourceContext
      ? boundedProviderValue(rawSourceContext, MAX_LOCATOR_CONTEXT_LENGTH)
      : null;
    const locatorType = hasLocatorType
      ? boundedProviderValue(rawLocatorType, MAX_LOCATOR_TYPE_LENGTH)
      : null;
    if ((hasSourceContext && !sourceContext) || (hasLocatorType && !locatorType)) {
      return invalidEvidence();
    }

    if (!hasLocatorType) {
      // Air/NDC confirmation contexts such as OrderId and VendorLocator can
      // coexist in the shared reservation model. Stays authority contexts may
      // not omit locatorType (the documented Sync-only Travelport omission is
      // normalized before this helper is called).
      if (sourceContext === 'Travelport' || sourceContext === 'Supplier' || sourceContext === 'Agency') {
        return invalidEvidence();
      }
      continue;
    }
    if (!hasSourceContext) return invalidEvidence();

    const hasStaysSourceContext = sourceContext === 'Travelport' || sourceContext === 'Supplier' || sourceContext === 'Agency';
    const hasStaysLocatorType = locatorType === 'PNR Locator'
      || locatorType === 'Confirmation Number'
      || locatorType === 'Cancellation Number'
      || locatorType === 'IATA Number'
      || locatorType === 'Pin code';
    const hasCanonicalStaysPair = (sourceContext === 'Travelport' && locatorType === 'PNR Locator')
      || (sourceContext === 'Supplier' && locatorType === 'Confirmation Number')
      || (sourceContext === 'Supplier' && locatorType === 'Cancellation Number')
      || (sourceContext === 'Agency' && locatorType === 'IATA Number');
    const hasSupportedStaysPair = hasCanonicalStaysPair
      || (sourceContext === 'Supplier' && locatorType === 'Pin code');
    if ((hasStaysSourceContext || hasStaysLocatorType) && !hasSupportedStaysPair) {
      return invalidEvidence();
    }

    const normalized = normalizedReceipt(locator, confirmation, hasSupportedStaysPair);
    if (!normalized) return invalidEvidence();

    if (sourceContext === 'Travelport' && locatorType === 'PNR Locator') {
      travelportPnrReceipts.push(normalized);
    } else if (sourceContext === 'Supplier' && locatorType === 'Confirmation Number') {
      supplierConfirmationReceipts.push(normalized);
    } else if (sourceContext === 'Supplier' && locatorType === 'Cancellation Number') {
      supplierCancellationReceipts.push(normalized);
    }
  }

  return Object.freeze({
    valid: true,
    travelportPnrReceipts: Object.freeze(travelportPnrReceipts),
    supplierConfirmationReceipts: Object.freeze(supplierConfirmationReceipts),
    supplierCancellationReceipts: Object.freeze(supplierCancellationReceipts),
  });
}
