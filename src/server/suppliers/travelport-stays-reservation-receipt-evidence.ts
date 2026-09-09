const MAX_RECEIPTS = 32;
const MAX_RECEIPT_TYPE_LENGTH = 64;
const MAX_CONFIRMATION_TYPE_LENGTH = 64;
const MAX_CANCELLATION_TYPE_LENGTH = 64;
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

type TravelportStaysCancellationInspection = Readonly<{
  valid: boolean;
  relevant: boolean;
  receipt: TravelportStaysLocatorReceiptEvidence | null;
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

function isStaysSourceContext(value: string | null) {
  return value === 'Travelport' || value === 'Supplier' || value === 'Agency';
}

function isStaysLocatorType(value: string | null) {
  return value === 'PNR Locator'
    || value === 'Confirmation Number'
    || value === 'Cancellation Number'
    || value === 'IATA Number'
    || value === 'Pin code';
}

function isCanonicalStaysPair(sourceContext: string | null, locatorType: string | null) {
  return (sourceContext === 'Travelport' && locatorType === 'PNR Locator')
    || (sourceContext === 'Supplier' && locatorType === 'Confirmation Number')
    || (sourceContext === 'Supplier' && locatorType === 'Cancellation Number')
    || (sourceContext === 'Agency' && locatorType === 'IATA Number');
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

function inspectCancellationReceipt(receipt: RecordValue): TravelportStaysCancellationInspection {
  const cancellation = optionalRecord(receipt.Cancellation);
  const locator = optionalRecord(cancellation?.Locator);
  if (!cancellation || !locator) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const rawSourceContext = locator.sourceContext;
  const rawLocatorType = locator.locatorType;
  const hasSourceContext = rawSourceContext !== undefined && rawSourceContext !== null;
  const hasLocatorType = rawLocatorType !== undefined && rawLocatorType !== null;
  const sourceContext = hasSourceContext
    ? boundedProviderValue(rawSourceContext, MAX_LOCATOR_CONTEXT_LENGTH)
    : null;
  const locatorType = hasLocatorType
    ? boundedProviderValue(rawLocatorType, MAX_LOCATOR_TYPE_LENGTH)
    : null;
  if ((hasSourceContext && !sourceContext) || (hasLocatorType && !locatorType)) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const hasStaysSourceContext = isStaysSourceContext(sourceContext);
  const hasStaysLocatorType = isStaysLocatorType(locatorType);
  const hasCanonicalStaysPair = isCanonicalStaysPair(sourceContext, locatorType);

  if (hasStaysSourceContext && !hasLocatorType) {
    // A provider-owned Stays context cannot be partially presented and then
    // disappear as unrelated multi-content evidence. Explicit generic locator
    // families (for example Travelport + Locator on air cancellations) remain
    // outside Stays authority when a locatorType is actually supplied.
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const offerStatus = cancellation.OfferStatus;
  const offerStatusRecord = offerStatus === undefined || offerStatus === null
    ? null
    : optionalRecord(offerStatus);
  if ((hasCanonicalStaysPair || hasStaysSourceContext || hasStaysLocatorType) && offerStatus !== undefined && offerStatus !== null && !offerStatusRecord) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const rawOfferStatusType = offerStatusRecord?.['@type'];
  const offerStatusType = rawOfferStatusType === undefined || rawOfferStatusType === null
    ? null
    : boundedProviderValue(rawOfferStatusType, MAX_OFFER_STATUS_TYPE_LENGTH);
  if (
    rawOfferStatusType !== undefined
    && rawOfferStatusType !== null
    && !offerStatusType
    && (hasCanonicalStaysPair || hasStaysLocatorType)
  ) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const hasHospitalityStatus = offerStatusType === 'OfferStatusHospitality';
  if (hasStaysLocatorType && !hasCanonicalStaysPair) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const relevant = hasCanonicalStaysPair || hasHospitalityStatus;
  if (!relevant) {
    return Object.freeze({ valid: true, relevant: false, receipt: null });
  }

  if (
    hasHospitalityStatus
    && (hasSourceContext || hasLocatorType)
    && !hasCanonicalStaysPair
  ) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const rawCancellationType = cancellation['@type'];
  if (rawCancellationType !== undefined && rawCancellationType !== null) {
    const cancellationType = boundedProviderValue(rawCancellationType, MAX_CANCELLATION_TYPE_LENGTH);
    if (cancellationType !== 'CancellationHold') {
      return Object.freeze({ valid: false, relevant: false, receipt: null });
    }
  }

  if (offerStatusType !== null && offerStatusType !== 'OfferStatusHospitality') {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const reference = boundedProviderValue(locator.value, MAX_REFERENCE_LENGTH);
  if (!reference) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  const rawSource = locator.source;
  const source = rawSource === undefined || rawSource === null
    ? null
    : boundedProviderValue(rawSource, MAX_LOCATOR_SOURCE_LENGTH);
  if (rawSource !== undefined && rawSource !== null && !source) {
    return Object.freeze({ valid: false, relevant: false, receipt: null });
  }

  let status: string | null = null;
  if (offerStatusRecord) {
    status = boundedProviderValue(offerStatusRecord.Status, MAX_STATUS_LENGTH);
    if (!status || status !== 'Cancelled') {
      return Object.freeze({ valid: false, relevant: false, receipt: null });
    }
  }

  return Object.freeze({
    valid: true,
    relevant: true,
    receipt: Object.freeze({ reference, status, source }),
  });
}

/**
 * Normalizes only Travelport Stays locator families that can influence durable
 * reservation identity or active/cancelled lifecycle authority. Unrelated
 * multi-content ReceiptPayment, generic ReceiptCancellation, and confirmation
 * locators without Stays semantics are ignored, while malformed, partial, or
 * contradictory Stays evidence fails closed. Documented Booking.com Supplier
 * + Pin code receipts are structurally validated but remain non-durable.
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
      if (receiptType === 'ReceiptPayment') continue;
      if (receiptType === 'ReceiptCancellation') {
        const cancellation = inspectCancellationReceipt(receipt);
        if (!cancellation.valid) return invalidEvidence();
        if (cancellation.relevant && cancellation.receipt) {
          // Existing callers treat this collection as cancellation lifecycle
          // evidence rather than as durable supplier identity. Keeping
          // self-identifying Stays ReceiptCancellation evidence here makes
          // Create/Sync and active Retrieve reject the cancelled lifecycle
          // without exposing a new provider-neutral identifier.
          supplierCancellationReceipts.push(cancellation.receipt);
        }
        continue;
      }
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
      if (isStaysSourceContext(sourceContext)) {
        return invalidEvidence();
      }
      continue;
    }
    if (!hasSourceContext) return invalidEvidence();

    const hasStaysSourceContext = isStaysSourceContext(sourceContext);
    const hasStaysLocatorType = isStaysLocatorType(locatorType);
    const hasCanonicalStaysPair = isCanonicalStaysPair(sourceContext, locatorType);
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
