import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

const MAX_CORRELATION_LENGTH = 512;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;
const MAX_WARNINGS = 32;
const MAX_RESERVATION_TYPE_LENGTH = 64;
const MAX_OFFER_TYPE_LENGTH = 64;
const MAX_PRODUCT_TYPE_LENGTH = 64;
const MAX_PROPERTY_KEY_TYPE_LENGTH = 64;
const MAX_OFFER_REFERENCE_LENGTH = 64;
const MAX_RESULT_TYPE_LENGTH = 64;
const MAX_WARNING_TYPE_LENGTH = 64;
const MAX_WARNING_MESSAGE_LENGTH = 512;
const MAX_WARNING_STATUS_CODE = 999;

type RecordValue = Record<string, unknown>;

type TravelportStaysReservationOfferScope = Readonly<{
  offerIds: ReadonlySet<string>;
  passiveOfferIds: ReadonlySet<string>;
  activeHospitalityOfferId: string;
}>;

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
  if (
    !normalized
    || normalized !== value
    || normalized.length > max
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return null;
  return normalized;
}

function boundedProviderText(value: unknown, max: number) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max) return null;
  return normalized;
}

function assertSupportedResultEvidence(response: RecordValue) {
  if (response.Result === undefined) return;

  const result = record(response.Result);
  const rawResultType = result['@type'];
  if (
    rawResultType !== undefined
    && boundedProviderValue(rawResultType, MAX_RESULT_TYPE_LENGTH) !== 'Result'
  ) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained malformed or unexpected result type evidence.',
    );
  }
  if (
    result.Error !== undefined
    || result.Errors !== undefined
  ) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained embedded result error evidence.',
    );
  }

  const hasWarning = result.Warning !== undefined;
  const hasWarnings = result.Warnings !== undefined;
  if (hasWarning && hasWarnings) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained conflicting result warning evidence.',
    );
  }
  if (!hasWarning && !hasWarnings) return;

  const warningValues = hasWarning ? result.Warning : result.Warnings;
  if (
    !Array.isArray(warningValues)
    || warningValues.length < 1
    || warningValues.length > MAX_WARNINGS
  ) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained malformed or oversized result warning evidence.',
    );
  }

  for (const warningValue of warningValues) {
    const warning = record(warningValue);
    const rawWarningType = warning['@type'];
    if (
      rawWarningType !== undefined
      && boundedProviderValue(rawWarningType, MAX_WARNING_TYPE_LENGTH) !== 'Warning'
    ) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed or unexpected warning type evidence.',
      );
    }

    const rawStatusCode = warning.StatusCode;
    if (
      rawStatusCode !== undefined
      && (
        typeof rawStatusCode !== 'number'
        || !Number.isInteger(rawStatusCode)
        || rawStatusCode < 0
        || rawStatusCode > MAX_WARNING_STATUS_CODE
      )
    ) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed warning status evidence.',
      );
    }

    if (!boundedProviderText(warning.Message, MAX_WARNING_MESSAGE_LENGTH)) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained a malformed result warning message.',
      );
    }
  }
}

function assertSupportedPropertyKeyType(propertyKey: RecordValue) {
  const rawPropertyKeyType = propertyKey['@type'];
  if (rawPropertyKeyType === undefined) return;

  const propertyKeyType = boundedProviderValue(rawPropertyKeyType, MAX_PROPERTY_KEY_TYPE_LENGTH);
  if (propertyKeyType !== 'PropertyKey') {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained malformed or unexpected property-key type evidence.',
    );
  }
}

function assertExpectedReservationMatch(
  reservation: RecordValue,
  expected: TravelportStaysReservationRecoveryExpectation,
): TravelportStaysReservationOfferScope {
  const offers = reservation.Offer;
  if (!Array.isArray(offers) || offers.length < 1 || offers.length > MAX_OFFERS) {
    throw new HospitalitySupplierProviderError('INVALID_RESPONSE');
  }

  const offerIds = new Set<string>();
  const passiveOfferIds = new Set<string>();
  let matches = 0;
  let activeHospitalitySegments = 0;
  let activeHospitalityOfferId: string | null = null;
  for (const offerValue of offers) {
    const offer = record(offerValue);
    const offerType = boundedProviderValue(offer['@type'], MAX_OFFER_TYPE_LENGTH);
    if (offerType !== 'Offer') {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained missing, malformed, or unexpected offer type evidence.',
      );
    }

    const offerId = boundedProviderValue(offer.id, MAX_OFFER_REFERENCE_LENGTH);
    if (!offerId || offerIds.has(offerId)) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained missing, malformed, or duplicate offer identifiers.',
      );
    }
    offerIds.add(offerId);

    const passiveOfferInd = offer.passiveOfferInd;
    if (
      passiveOfferInd !== undefined
      && typeof passiveOfferInd !== 'boolean'
    ) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed passive-offer evidence.',
      );
    }

    if (passiveOfferInd === true) {
      passiveOfferIds.add(offerId);
      continue;
    }

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
      assertSupportedPropertyKeyType(propertyKey);
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
        activeHospitalityOfferId = offerId;
      }
    }
  }

  if (activeHospitalitySegments !== 1 || matches !== 1 || !activeHospitalityOfferId) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response did not contain exactly one active hospitality segment matching the durable reservation request.',
    );
  }

  return Object.freeze({ offerIds, passiveOfferIds, activeHospitalityOfferId });
}

function isDocumentedPassivePlaceholderReceipt(receipt: RecordValue) {
  if (receipt['@type'] !== 'ReceiptConfirmation') return false;
  if (receipt.Cancellation !== undefined) return false;

  const confirmationValue = receipt.Confirmation;
  if (!confirmationValue || typeof confirmationValue !== 'object' || Array.isArray(confirmationValue)) return false;
  const confirmation = confirmationValue as RecordValue;
  if (confirmation['@type'] !== 'ConfirmationHold') return false;
  if (confirmation.Locator !== undefined) return false;

  const offerStatusValue = confirmation.OfferStatus;
  if (!offerStatusValue || typeof offerStatusValue !== 'object' || Array.isArray(offerStatusValue)) return false;
  const offerStatus = offerStatusValue as RecordValue;
  return offerStatus['@type'] === 'OfferStatusHospitality'
    && offerStatus.code === 'AK'
    && offerStatus.Status === 'Confirmed';
}

function activeReservationReceiptEvidence(
  value: unknown,
  offerScope: TravelportStaysReservationOfferScope,
) {
  if (!Array.isArray(value)) return value;

  return value.filter((receiptValue) => {
    if (!receiptValue || typeof receiptValue !== 'object' || Array.isArray(receiptValue)) return true;
    const receipt = receiptValue as RecordValue;
    const rawOfferRefs = receipt.OfferRef;
    if (rawOfferRefs === null) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained an explicit null receipt offer reference.',
      );
    }
    if (rawOfferRefs === undefined) {
      const unscopedReceiptEvidence = inspectTravelportStaysReservationReceiptEvidence([receipt]);
      if (!unscopedReceiptEvidence.valid) {
        throw new HospitalitySupplierProviderError(
          'INVALID_RESPONSE',
          'Travelport reservation response contained malformed unscoped reservation receipt evidence.',
        );
      }
      if (
        unscopedReceiptEvidence.supplierConfirmationReceipts.length > 0
        || unscopedReceiptEvidence.supplierCancellationReceipts.length > 0
      ) {
        throw new HospitalitySupplierProviderError(
          'INVALID_RESPONSE',
          'Travelport reservation response contained supplier receipt evidence without active hotel offer scope.',
        );
      }
      return true;
    }

    if (!Array.isArray(rawOfferRefs) || rawOfferRefs.length < 1 || rawOfferRefs.length > MAX_OFFERS) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed receipt offer references.',
      );
    }

    const offerRefs = rawOfferRefs.map((offerRef) => boundedProviderValue(offerRef, MAX_OFFER_REFERENCE_LENGTH));
    const normalizedOfferRefs = offerRefs.filter((offerRef): offerRef is string => offerRef !== null);
    if (normalizedOfferRefs.length !== offerRefs.length) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed receipt offer references.',
      );
    }
    if (new Set(normalizedOfferRefs).size !== normalizedOfferRefs.length) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained duplicate receipt offer references.',
      );
    }
    if (normalizedOfferRefs.some((offerRef) => !offerScope.offerIds.has(offerRef))) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained receipt evidence for an unknown offer.',
      );
    }

    const passiveMatches = normalizedOfferRefs.filter((offerRef) => offerScope.passiveOfferIds.has(offerRef));
    if (passiveMatches.length === 0) {
      const activeReceiptEvidence = inspectTravelportStaysReservationReceiptEvidence([receipt]);
      if (!activeReceiptEvidence.valid) {
        throw new HospitalitySupplierProviderError(
          'INVALID_RESPONSE',
          'Travelport reservation response contained malformed active reservation receipt evidence.',
        );
      }
      if (activeReceiptEvidence.travelportPnrReceipts.length > 0) {
        throw new HospitalitySupplierProviderError(
          'INVALID_RESPONSE',
          'Travelport reservation response contained offer-scoped Travelport PNR receipt evidence.',
        );
      }
      if (
        activeReceiptEvidence.supplierConfirmationReceipts.length > 0
        || activeReceiptEvidence.supplierCancellationReceipts.length > 0
      ) {
        if (
          normalizedOfferRefs.length !== 1
          || normalizedOfferRefs[0] !== offerScope.activeHospitalityOfferId
        ) {
          throw new HospitalitySupplierProviderError(
            'INVALID_RESPONSE',
            'Travelport reservation response contained supplier receipt evidence outside the active hotel offer.',
          );
        }
      }
      return true;
    }
    if (passiveMatches.length !== normalizedOfferRefs.length) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response mixed active and passive offer references in one receipt.',
      );
    }

    if (isDocumentedPassivePlaceholderReceipt(receipt)) return false;

    const passiveReceiptEvidence = inspectTravelportStaysReservationReceiptEvidence([receipt]);
    if (!passiveReceiptEvidence.valid) {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport reservation response contained malformed passive reservation receipt evidence.',
      );
    }

    const hasPassiveReservationAuthority = passiveReceiptEvidence.travelportPnrReceipts.length > 0
      || passiveReceiptEvidence.supplierConfirmationReceipts.length > 0
      || passiveReceiptEvidence.supplierCancellationReceipts.length > 0;

    if (hasPassiveReservationAuthority) {
      // OfferRef proves this durable locator or lifecycle evidence belongs only
      // to an explicitly passive segment. Validate it first so malformed Stays
      // evidence cannot disappear, then exclude it from active reservation
      // identity/lifecycle authority.
      return false;
    }

    return true;
  });
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
  if (root.ErrorResponse !== undefined) {
    throw new HospitalitySupplierProviderError(
      'INVALID_RESPONSE',
      'Travelport reservation response contained contradictory top-level error evidence.',
    );
  }

  const response = record(root.ReservationResponse);
  assertSupportedResultEvidence(response);

  const reservation = record(response.Reservation);
  let receiptInput = reservation.Receipt;
  if (input.expectedReservation) {
    const reservationType = boundedProviderValue(reservation['@type'], MAX_RESERVATION_TYPE_LENGTH);
    if (reservationType !== 'ReservationDetail') {
      throw new HospitalitySupplierProviderError(
        'INVALID_RESPONSE',
        'Travelport known-locator response contained missing, malformed, or unexpected reservation type evidence.',
      );
    }

    const offerScope = assertExpectedReservationMatch(reservation, input.expectedReservation);
    receiptInput = activeReservationReceiptEvidence(reservation.Receipt, offerScope);
  }
  const receiptEvidence = inspectTravelportStaysReservationReceiptEvidence(receiptInput);
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
