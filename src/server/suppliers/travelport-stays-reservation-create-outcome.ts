const MAX_REFERENCE_LENGTH = 512;
const MAX_CORRELATION_LENGTH = 512;
const MAX_ERRORS = 32;
const MAX_WARNINGS = 32;
const MAX_RECEIPTS = 32;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;

const GUARANTEE_CHANGE_SOURCE_CODES = new Set(['13016', '13017', '13018']);
const PRICE_CHANGE_SOURCE_CODE = '13020';
const SYNC_REQUIRED_SOURCE_CODE = '13034';
const CONFIRMED_WITHOUT_PNR_WARNING =
  'HOTEL SELL CONFIRMED FROM SUPPLIER. TRAVELPORT PNR PROCESSING DID NOT COMPLETE. USE SYNC MESSAGE WITH CONFIRMATION NUMBER TO COMPLETE PNR.';

type RecordValue = Record<string, unknown>;

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
      status: 'REVIEW_REQUIRED';
      reason: 'PRICE_CHANGED' | 'GUARANTEE_CHANGED' | 'PRICE_AND_GUARANTEE_CHANGED';
      providerCorrelationId: string | null;
    }>
  | Readonly<{
      status: 'AMBIGUOUS';
      failureCode: 'TRAVELPORT_SYNC_REQUIRED' | 'INVALID_RESPONSE';
      supplierConfirmationReference: string | null;
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

function correlationFromBody(value: unknown) {
  const root = optionalRecord(value);
  const response = optionalRecord(root?.ReservationResponse) ?? optionalRecord(root?.ErrorResponse);
  return boundedText(response?.traceId ?? response?.traceID, MAX_CORRELATION_LENGTH);
}

function providerSourceCodes(value: unknown) {
  const root = optionalRecord(value);
  const response = optionalRecord(root?.ErrorResponse);
  const result = optionalRecord(response?.Result);
  if (!result || !Array.isArray(result.Error) || result.Error.length < 1 || result.Error.length > MAX_ERRORS) return Object.freeze([] as string[]);
  const codes: string[] = [];
  for (const errorValue of result.Error) {
    const error = optionalRecord(errorValue);
    if (!error) continue;
    const raw = error.SourceCode;
    const code = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    if (/^\d{1,8}$/.test(code)) codes.push(code);
  }
  return Object.freeze([...new Set(codes)]);
}

function normalizedWarningMessages(value: unknown) {
  const root = optionalRecord(value);
  const response = optionalRecord(root?.ReservationResponse);
  const result = optionalRecord(response?.Result);
  const warningValues = Array.isArray(result?.Warning)
    ? result.Warning
    : Array.isArray(result?.Warnings)
      ? result.Warnings
      : [];
  if (warningValues.length > MAX_WARNINGS) return Object.freeze([] as string[]);
  const messages: string[] = [];
  for (const warningValue of warningValues) {
    const warning = optionalRecord(warningValue);
    const message = boundedText(warning?.Message, 512);
    if (message) messages.push(message.replace(/\s+/g, ' ').toUpperCase());
  }
  return Object.freeze(messages);
}

function reservationRecord(value: unknown) {
  const root = optionalRecord(value);
  const response = optionalRecord(root?.ReservationResponse);
  return optionalRecord(response?.Reservation);
}

function matchesExpectedReservation(reservation: RecordValue, expected: TravelportStaysCreateExpectedReservation) {
  const offers = reservation.Offer;
  if (!Array.isArray(offers) || offers.length < 1 || offers.length > MAX_OFFERS) return false;
  let matches = 0;
  for (const offerValue of offers) {
    const offer = optionalRecord(offerValue);
    if (!offer || !Array.isArray(offer.Product) || offer.Product.length > MAX_PRODUCTS_PER_OFFER) continue;
    for (const productValue of offer.Product) {
      const product = optionalRecord(productValue);
      if (!product || product['@type'] !== 'ProductHospitality') continue;
      const property = optionalRecord(product.PropertyKey);
      const dates = optionalRecord(product.DateRange);
      if (!property || !dates) continue;
      if (
        boundedText(property.chainCode, 16) === expected.chainCode
        && boundedText(property.propertyCode, 32) === expected.propertyCode
        && boundedText(dates.start, 10) === expected.arrivalDateLocal
        && boundedText(dates.end, 10) === expected.departureDateLocal
        && product.Quantity === expected.rooms
        && product.guests === expected.guests
      ) matches += 1;
    }
  }
  return matches === 1;
}

function confirmedLocatorEvidence(reservation: RecordValue) {
  const receipts = reservation.Receipt;
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > MAX_RECEIPTS) {
    return Object.freeze({ provider: null, supplier: null });
  }
  const providers: string[] = [];
  const suppliers: string[] = [];
  for (const receiptValue of receipts) {
    const receipt = optionalRecord(receiptValue);
    const confirmation = optionalRecord(receipt?.Confirmation);
    const locator = optionalRecord(confirmation?.Locator);
    const status = boundedText(optionalRecord(confirmation?.OfferStatus)?.Status, 64);
    const reference = boundedText(locator?.value, MAX_REFERENCE_LENGTH);
    const context = boundedText(locator?.sourceContext, 64);
    const locatorType = boundedText(locator?.locatorType, 64);
    if (!reference || !context || status !== 'Confirmed') continue;
    if (context === 'Travelport') providers.push(reference);
    if (context === 'Supplier' && locatorType === 'Confirmation Number') suppliers.push(reference);
  }
  const uniqueProviders = [...new Set(providers)];
  const uniqueSuppliers = [...new Set(suppliers)];
  return Object.freeze({
    provider: providers.length === 1 && uniqueProviders.length === 1 ? uniqueProviders[0]! : null,
    supplier: suppliers.length === 1 && uniqueSuppliers.length === 1 ? uniqueSuppliers[0]! : null,
  });
}

export function classifyTravelportStaysReservationCreateOutcome(input: Readonly<{
  httpStatus: number;
  body: unknown;
  expectedReservation: TravelportStaysCreateExpectedReservation;
}>): TravelportStaysReservationCreateOutcome {
  const providerCorrelationId = correlationFromBody(input.body);
  const sourceCodes = providerSourceCodes(input.body);

  if (sourceCodes.includes(SYNC_REQUIRED_SOURCE_CODE)) {
    return Object.freeze({
      status: 'AMBIGUOUS',
      failureCode: 'TRAVELPORT_SYNC_REQUIRED',
      supplierConfirmationReference: null,
      providerCorrelationId,
    });
  }

  const guaranteeChanged = sourceCodes.some((code) => GUARANTEE_CHANGE_SOURCE_CODES.has(code));
  const priceChanged = sourceCodes.includes(PRICE_CHANGE_SOURCE_CODE);
  const recognizedReviewCodes = sourceCodes.filter((code) => GUARANTEE_CHANGE_SOURCE_CODES.has(code) || code === PRICE_CHANGE_SOURCE_CODE);
  if (recognizedReviewCodes.length > 0 && recognizedReviewCodes.length === sourceCodes.length) {
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

  const reservation = reservationRecord(input.body);
  const reservationMatches = reservation ? matchesExpectedReservation(reservation, input.expectedReservation) : false;
  const locators = reservation ? confirmedLocatorEvidence(reservation) : Object.freeze({ provider: null, supplier: null });
  const confirmedWithoutPnr = normalizedWarningMessages(input.body).includes(CONFIRMED_WITHOUT_PNR_WARNING);
  if (confirmedWithoutPnr) {
    return Object.freeze({
      status: 'AMBIGUOUS',
      failureCode: 'TRAVELPORT_SYNC_REQUIRED',
      supplierConfirmationReference: reservationMatches ? locators.supplier : null,
      providerCorrelationId,
    });
  }

  if (input.httpStatus >= 200 && input.httpStatus < 300 && reservationMatches && locators.provider) {
    return Object.freeze({
      status: 'CONFIRMED',
      providerReservationReference: locators.provider,
      supplierConfirmationReference: locators.supplier,
      providerCorrelationId,
    });
  }

  // After a commercial POST crossed the provider boundary, an unrecognized or malformed
  // result cannot prove that no supplier sell occurred. Fail closed to ambiguity.
  return Object.freeze({
    status: 'AMBIGUOUS',
    failureCode: 'INVALID_RESPONSE',
    supplierConfirmationReference: null,
    providerCorrelationId,
  });
}
