import {
  createTravelportStaysSyncRecoveryReference,
  TravelportStaysSyncRecoveryReferenceError,
} from './travelport-stays-sync-recovery-reference.ts';
import { inspectTravelportStaysReservationReceiptEvidence } from './travelport-stays-reservation-receipt-evidence.ts';

const MAX_CORRELATION_LENGTH = 512;
const MAX_ERRORS = 32;
const MAX_WARNINGS = 32;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;
const MAX_OFFER_AUTHORITY_LENGTH = 64;
const MAX_RESERVATION_TYPE_LENGTH = 64;
const MAX_OFFER_TYPE_LENGTH = 64;
const MAX_PRODUCT_TYPE_LENGTH = 64;
const MAX_PROPERTY_KEY_TYPE_LENGTH = 64;

const GUARANTEE_CHANGE_SOURCE_CODES = new Set(['13016', '13017', '13018']);
const PRICE_CHANGE_SOURCE_CODE = '13020';
const SYNC_REQUIRED_SOURCE_CODE = '13034';
const RETRYABLE_EPHEMERAL_PAYMENT_VALIDATION_SOURCE_CODES = new Set([
  '1537',
  '1538',
  '1539',
  '1540',
  '1541',
  '1542',
  '1543',
  '1544',
  '1545',
  '1546',
  '1547',
  '13050',
  '13054',
  '13078',
  '13083',
]);
const DEFINITIVE_NO_SELL_VALIDATION_SOURCE_CODES = new Set([
  '1200',
  '1250',
  '1251',
  '1300',
  '1320',
  '1480',
  '1485',
  '1495',
  '1515',
  '1533',
  '1534',
  '1537',
  '1538',
  '1539',
  '1540',
  '1541',
  '1542',
  '1543',
  '1544',
  '1545',
  '1546',
  '1547',
  '1549',
  '1550',
  '1551',
  '13001',
  '13003',
  '13005',
  '13006',
  '13007',
  '13008',
  '13012',
  '13015',
  '13022',
  '13038',
  '13045',
  '13046',
  '13047',
  '13050',
  '13054',
  '13064',
  '13078',
  '13083',
]);
const CONFIRMED_WITHOUT_PNR_WARNING =
  'HOTEL SELL CONFIRMED FROM SUPPLIER. TRAVELPORT PNR PROCESSING DID NOT COMPLETE. USE SYNC MESSAGE WITH CONFIRMATION NUMBER TO COMPLETE PNR.';

type RecordValue = Record<string, unknown>;

type ProviderErrorDetail = Readonly<{
  sourceCode: string;
  category: string;
  statusCode: number;
}>;

type ProviderErrorInspection = Readonly<{
  present: boolean;
  valid: boolean;
  errors: readonly ProviderErrorDetail[];
  sourceCodes: readonly string[];
}>;

type ProviderWarningInspection = Readonly<{
  valid: boolean;
  messages: readonly string[];
}>;

type ProviderResponseEnvelopeInspection = Readonly<{
  valid: boolean;
  providerCorrelationId: string | null;
}>;

type ConfirmedLocatorEvidence = Readonly<{
  valid: boolean;
  provider: string | null;
  supplier: string | null;
  supplierSource: string | null;
}>;

type MatchedOfferEvidence = Readonly<{
  valid: boolean;
  matches: number;
  hospitalitySegments: number;
  offerAuthority: string | null;
}>;

export type TravelportStaysCreateExpectedReservation = Readonly<{
  chainCode: string;
  propertyCode: string;
  arrivalDateLocal: string;
  departureDateLocal: string;
  rooms: number;
  guests: number;
}>;

export type TravelportStaysReservationCreateOutcome =
  | Readonly<{
      status: 'CONFIRMED';
      providerReservationReference: string;
      supplierConfirmationReference: string | null;
      providerCorrelationId: string | null;
    }>
  | Readonly<{
      status: 'FAILED';
      failureCode: `TRAVELPORT_VALIDATION_${string}`;
      retryable: boolean;
      providerCorrelationId: string | null;
    }>
  | Readonly<{
      status: 'REVIEW_REQUIRED';
      reason: 'PRICE_CHANGED' | 'GUARANTEE_CHANGED' | 'PRICE_AND_GUARANTEE_CHANGED';
      providerCorrelationId: string | null;
    }>
  | Readonly<{
      status: 'AMBIGUOUS';
      failureCode: 'TRAVELPORT_SYNC_REQUIRED' | 'INVALID_RESPONSE';
      supplierConfirmationReference: string | null;
      providerRecoveryReference?: string | null;
      providerCorrelationId: string | null;
    }>;

function optionalRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function boundedText(value: unknown, max: number) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\r\n]/.test(normalized)) return null;
  return normalized;
}

function inspectProviderResponseEnvelope(value: unknown, httpStatus: number): ProviderResponseEnvelopeInspection {
  const root = optionalRecord(value);
  if (!root) return Object.freeze({ valid: false, providerCorrelationId: null });

  const hasReservationResponse = root.ReservationResponse !== undefined && root.ReservationResponse !== null;
  const hasErrorResponse = root.ErrorResponse !== undefined && root.ErrorResponse !== null;
  if (hasReservationResponse === hasErrorResponse) {
    return Object.freeze({ valid: false, providerCorrelationId: null });
  }

  const response = optionalRecord(hasReservationResponse ? root.ReservationResponse : root.ErrorResponse);
  const providerCorrelationId = boundedText(response?.traceId ?? response?.traceID, MAX_CORRELATION_LENGTH);
  if (!response || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
    return Object.freeze({ valid: false, providerCorrelationId });
  }

  const isSuccessStatus = httpStatus >= 200 && httpStatus < 300;
  const isErrorStatus = httpStatus >= 400;
  if ((hasReservationResponse && !isSuccessStatus) || (hasErrorResponse && !isErrorStatus)) {
    return Object.freeze({ valid: false, providerCorrelationId });
  }

  return Object.freeze({ valid: true, providerCorrelationId });
}

function inspectProviderErrors(value: unknown, httpStatus: number): ProviderErrorInspection {
  const root = optionalRecord(value);
  if (!root || root.ErrorResponse === undefined || root.ErrorResponse === null) {
    return Object.freeze({
      present: false,
      valid: true,
      errors: Object.freeze([] as ProviderErrorDetail[]),
      sourceCodes: Object.freeze([] as string[]),
    });
  }

  const response = optionalRecord(root.ErrorResponse);
  const result = optionalRecord(response?.Result);
  const errors = result?.Error;
  if (
    !response
    || !result
    || !Array.isArray(errors)
    || errors.length < 1
    || errors.length > MAX_ERRORS
    || !Number.isInteger(httpStatus)
    || httpStatus < 100
    || httpStatus > 599
  ) {
    return Object.freeze({
      present: true,
      valid: false,
      errors: Object.freeze([] as ProviderErrorDetail[]),
      sourceCodes: Object.freeze([] as string[]),
    });
  }

  const inspectedErrors: ProviderErrorDetail[] = [];
  let valid = true;
  for (const errorValue of errors) {
    const error = optionalRecord(errorValue);
    if (!error) {
      valid = false;
      continue;
    }

    const rawStatusCode = error.StatusCode;
    if (
      typeof rawStatusCode !== 'number'
      || !Number.isInteger(rawStatusCode)
      || rawStatusCode < 100
      || rawStatusCode > 599
      || rawStatusCode !== httpStatus
    ) {
      valid = false;
      continue;
    }

    const raw = error.SourceCode;
    const sourceCode = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    if (!/^\d{1,8}$/.test(sourceCode)) {
      valid = false;
      continue;
    }

    const rawCategory = error.category ?? error.Category;
    if (typeof rawCategory !== 'string') {
      valid = false;
      continue;
    }
    const category = rawCategory.trim().toUpperCase();
    if (!/^[A-Z_]{2,32}$/.test(category)) {
      valid = false;
      continue;
    }

    inspectedErrors.push(Object.freeze({ sourceCode, category, statusCode: rawStatusCode }));
  }

  return Object.freeze({
    present: true,
    valid: valid && inspectedErrors.length === errors.length,
    errors: Object.freeze(inspectedErrors),
    sourceCodes: Object.freeze([...new Set(inspectedErrors.map((error) => error.sourceCode))]),
  });
}

function inspectProviderWarnings(value: unknown): ProviderWarningInspection {
  const root = optionalRecord(value);
  if (!root || root.ReservationResponse === undefined || root.ReservationResponse === null) {
    return Object.freeze({ valid: true, messages: Object.freeze([] as string[]) });
  }

  const response = optionalRecord(root.ReservationResponse);
  if (!response) return Object.freeze({ valid: false, messages: Object.freeze([] as string[]) });
  if (response.Result === undefined || response.Result === null) {
    return Object.freeze({ valid: true, messages: Object.freeze([] as string[]) });
  }

  const result = optionalRecord(response.Result);
  if (!result) return Object.freeze({ valid: false, messages: Object.freeze([] as string[]) });
  if (
    (result.Error !== undefined && result.Error !== null)
    || (result.Errors !== undefined && result.Errors !== null)
  ) {
    return Object.freeze({ valid: false, messages: Object.freeze([] as string[]) });
  }
  const hasWarning = result.Warning !== undefined && result.Warning !== null;
  const hasWarnings = result.Warnings !== undefined && result.Warnings !== null;
  if (hasWarning && hasWarnings) {
    return Object.freeze({ valid: false, messages: Object.freeze([] as string[]) });
  }
  if (!hasWarning && !hasWarnings) {
    return Object.freeze({ valid: true, messages: Object.freeze([] as string[]) });
  }

  const warningValues = hasWarning ? result.Warning : result.Warnings;
  if (!Array.isArray(warningValues) || warningValues.length > MAX_WARNINGS) {
    return Object.freeze({ valid: false, messages: Object.freeze([] as string[]) });
  }

  const messages: string[] = [];
  for (const warningValue of warningValues) {
    const warning = optionalRecord(warningValue);
    const message = boundedText(warning?.Message, 512);
    if (!warning || !message) {
      return Object.freeze({ valid: false, messages: Object.freeze([] as string[]) });
    }
    messages.push(message.replace(/\s+/g, ' ').toUpperCase());
  }
  return Object.freeze({ valid: true, messages: Object.freeze(messages) });
}

function reservationRecord(value: unknown) {
  const root = optionalRecord(value);
  const response = optionalRecord(root?.ReservationResponse);
  return optionalRecord(response?.Reservation);
}

function validLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validExpectedReservation(expected: TravelportStaysCreateExpectedReservation) {
  return /^[A-Za-z0-9]{1,16}$/.test(expected.chainCode)
    && /^[A-Za-z0-9]{1,32}$/.test(expected.propertyCode)
    && validLocalDate(expected.arrivalDateLocal)
    && validLocalDate(expected.departureDateLocal)
    && expected.departureDateLocal > expected.arrivalDateLocal
    && expected.rooms === 1
    && Number.isInteger(expected.guests)
    && expected.guests >= 1
    && expected.guests <= 9;
}

function productMatchesExpectedReservation(product: RecordValue, expected: TravelportStaysCreateExpectedReservation) {
  if (product['@type'] !== 'ProductHospitality') return false;
  const property = optionalRecord(product.PropertyKey);
  const dates = optionalRecord(product.DateRange);
  if (!property || !dates) return false;
  const rawPropertyKeyType = property['@type'];
  if (
    rawPropertyKeyType !== undefined
    && rawPropertyKeyType !== null
    && boundedText(rawPropertyKeyType, MAX_PROPERTY_KEY_TYPE_LENGTH) !== 'PropertyKey'
  ) return false;
  return boundedText(property.chainCode, 16) === expected.chainCode
    && boundedText(property.propertyCode, 32) === expected.propertyCode
    && boundedText(dates.start, 10) === expected.arrivalDateLocal
    && boundedText(dates.end, 10) === expected.departureDateLocal
    && product.Quantity === expected.rooms
    && product.guests === expected.guests;
}

function invalidOfferEvidence(): MatchedOfferEvidence {
  return Object.freeze({ valid: false, matches: 0, hospitalitySegments: 0, offerAuthority: null });
}

function matchedOfferEvidence(
  reservation: RecordValue,
  expected: TravelportStaysCreateExpectedReservation,
): MatchedOfferEvidence {
  if (!validExpectedReservation(expected)) return invalidOfferEvidence();

  const reservationType = boundedText(reservation['@type'], MAX_RESERVATION_TYPE_LENGTH);
  if (reservationType !== 'ReservationDetail') return invalidOfferEvidence();

  const offers = reservation.Offer;
  if (!Array.isArray(offers) || offers.length < 1 || offers.length > MAX_OFFERS) {
    return invalidOfferEvidence();
  }

  let matches = 0;
  let hospitalitySegments = 0;
  let offerAuthority: string | null = null;
  for (const offerValue of offers) {
    const offer = optionalRecord(offerValue);
    if (!offer) return invalidOfferEvidence();

    const offerType = boundedText(offer['@type'], MAX_OFFER_TYPE_LENGTH);
    if (offerType !== 'Offer') return invalidOfferEvidence();

    const products = offer.Product;
    if (!Array.isArray(products) || products.length < 1 || products.length > MAX_PRODUCTS_PER_OFFER) {
      return invalidOfferEvidence();
    }

    for (const productValue of products) {
      const product = optionalRecord(productValue);
      const productType = boundedText(product?.['@type'], MAX_PRODUCT_TYPE_LENGTH);
      if (!product || !productType) return invalidOfferEvidence();
      if (productType !== 'ProductHospitality') continue;
      hospitalitySegments += 1;
      if (!productMatchesExpectedReservation(product, expected)) continue;
      matches += 1;
      offerAuthority = boundedText(optionalRecord(offer.Identifier)?.authority, MAX_OFFER_AUTHORITY_LENGTH);
    }
  }

  return Object.freeze({ valid: true, matches, hospitalitySegments, offerAuthority });
}

function confirmedLocatorEvidence(reservation: RecordValue): ConfirmedLocatorEvidence {
  const evidence = inspectTravelportStaysReservationReceiptEvidence(reservation.Receipt);
  if (
    !evidence.valid
    || evidence.supplierCancellationReceipts.length > 0
    || evidence.travelportPnrReceipts.length > 1
    || evidence.supplierConfirmationReceipts.length > 1
    || evidence.travelportPnrReceipts.some((receipt) => receipt.status !== 'Confirmed')
    || evidence.supplierConfirmationReceipts.some((receipt) => receipt.status !== 'Confirmed')
  ) {
    return Object.freeze({ valid: false, provider: null, supplier: null, supplierSource: null });
  }

  return Object.freeze({
    valid: true,
    provider: evidence.travelportPnrReceipts[0]?.reference ?? null,
    supplier: evidence.supplierConfirmationReceipts[0]?.reference ?? null,
    supplierSource: evidence.supplierConfirmationReceipts[0]?.source ?? null,
  });
}

function syncRecoveryReference(input: Readonly<{
  reservationMatches: boolean;
  providerReservationReference: string | null;
  supplierConfirmationReference: string | null;
  supplierSource: string | null;
  offerAuthority: string | null;
}>) {
  if (
    !input.reservationMatches
    || input.providerReservationReference
    || !input.supplierConfirmationReference
    || !input.supplierSource
    || !input.offerAuthority
  ) return null;
  try {
    return createTravelportStaysSyncRecoveryReference({
      offerAuthority: input.offerAuthority,
      supplierSource: input.supplierSource,
    });
  } catch (error) {
    if (error instanceof TravelportStaysSyncRecoveryReferenceError) return null;
    throw error;
  }
}

function invalidResponse(providerCorrelationId: string | null): TravelportStaysReservationCreateOutcome {
  return Object.freeze({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId,
  });
}

function definitiveValidationFailure(
  errors: ProviderErrorInspection,
  providerCorrelationId: string | null,
): TravelportStaysReservationCreateOutcome | null {
  if (!errors.present || !errors.valid || errors.errors.length < 1) return null;
  if (!errors.errors.every((error) => error.category === 'VALIDATION')) return null;
  if (!errors.errors.every((error) => DEFINITIVE_NO_SELL_VALIDATION_SOURCE_CODES.has(error.sourceCode))) return null;

  const sourceCodes = [...new Set(errors.errors.map((error) => error.sourceCode))];
  if (sourceCodes.length !== 1) return null;
  const sourceCode = sourceCodes[0]!;
  return Object.freeze({
    status: 'FAILED',
    failureCode: `TRAVELPORT_VALIDATION_${sourceCode}` as const,
    retryable: RETRYABLE_EPHEMERAL_PAYMENT_VALIDATION_SOURCE_CODES.has(sourceCode),
    providerCorrelationId,
  });
}

export function classifyTravelportStaysReservationCreateOutcome(input: Readonly<{
  httpStatus: number;
  body: unknown;
  expectedReservation: TravelportStaysCreateExpectedReservation;
}>): TravelportStaysReservationCreateOutcome {
  const envelope = inspectProviderResponseEnvelope(input.body, input.httpStatus);
  const providerCorrelationId = envelope.providerCorrelationId;
  if (!envelope.valid) return invalidResponse(providerCorrelationId);

  const errors = inspectProviderErrors(input.body, input.httpStatus);
  const warnings = inspectProviderWarnings(input.body);

  if (!errors.valid || !warnings.valid) return invalidResponse(providerCorrelationId);

  // SourceCode is available only in Travelport's newer Stays error envelope,
  // where Category and StatusCode are also part of the documented evidence.
  // Partial or HTTP-inconsistent envelopes cannot grant recovery semantics.
  const syncRequiredErrors = errors.present
    && errors.errors.length > 0
    && errors.errors.every(
      (error) => error.sourceCode === SYNC_REQUIRED_SOURCE_CODE
        && error.category === 'UNKNOWN',
    );
  if (syncRequiredErrors) {
    return Object.freeze({
      status: 'AMBIGUOUS',
      failureCode: 'TRAVELPORT_SYNC_REQUIRED',
      supplierConfirmationReference: null,
      providerCorrelationId,
    });
  }

  if (errors.present) {
    // Travelport documents the price/guarantee change family as VALIDATION in
    // the newer SourceCode-bearing envelope. Incomplete or contradictory
    // category evidence cannot authorize a reviewed second sell.
    const reviewErrors = errors.errors.length > 0
      && errors.errors.every((error) => (
        error.category === 'VALIDATION'
        && (GUARANTEE_CHANGE_SOURCE_CODES.has(error.sourceCode) || error.sourceCode === PRICE_CHANGE_SOURCE_CODE)
      ));
    if (reviewErrors) {
      const guaranteeChanged = errors.errors.some((error) => GUARANTEE_CHANGE_SOURCE_CODES.has(error.sourceCode));
      const priceChanged = errors.errors.some((error) => error.sourceCode === PRICE_CHANGE_SOURCE_CODE);
      return Object.freeze({
        status: 'REVIEW_REQUIRED',
        reason: guaranteeChanged && priceChanged
          ? 'PRICE_AND_GUARANTEE_CHANGED'
          : guaranteeChanged
            ? 'GUARANTEE_CHANGED'
            : 'PRICE_CHANGED',
        providerCorrelationId,
      });
    }

    const validationFailure = definitiveValidationFailure(errors, providerCorrelationId);
    if (validationFailure) return validationFailure;
    return invalidResponse(providerCorrelationId);
  }

  const reservation = reservationRecord(input.body);
  const offerEvidence = reservation
    ? matchedOfferEvidence(reservation, input.expectedReservation)
    : invalidOfferEvidence();
  const reservationMatches = offerEvidence.valid
    && offerEvidence.hospitalitySegments === 1
    && offerEvidence.matches === 1;
  const locators = reservation
    ? confirmedLocatorEvidence(reservation)
    : Object.freeze({ valid: false, provider: null, supplier: null, supplierSource: null });
  if (!locators.valid) return invalidResponse(providerCorrelationId);

  const confirmedWithoutPnr = warnings.messages.includes(CONFIRMED_WITHOUT_PNR_WARNING);
  if (confirmedWithoutPnr) {
    return Object.freeze({
      status: 'AMBIGUOUS',
      failureCode: 'TRAVELPORT_SYNC_REQUIRED',
      supplierConfirmationReference: reservationMatches ? locators.supplier : null,
      providerRecoveryReference: syncRecoveryReference({
        reservationMatches,
        providerReservationReference: locators.provider,
        supplierConfirmationReference: locators.supplier,
        supplierSource: locators.supplierSource,
        offerAuthority: offerEvidence.offerAuthority,
      }),
      providerCorrelationId,
    });
  }

  if (Number.isInteger(input.httpStatus) && input.httpStatus >= 200 && input.httpStatus < 300 && reservationMatches && locators.provider) {
    return Object.freeze({
      status: 'CONFIRMED',
      providerReservationReference: locators.provider,
      supplierConfirmationReference: locators.supplier,
      providerCorrelationId,
    });
  }

  return invalidResponse(providerCorrelationId);
}