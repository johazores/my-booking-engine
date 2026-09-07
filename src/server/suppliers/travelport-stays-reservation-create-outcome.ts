import {
  createTravelportStaysSyncRecoveryReference,
  TravelportStaysSyncRecoveryReferenceError,
} from './travelport-stays-sync-recovery-reference.ts';

const MAX_REFERENCE_LENGTH = 512;
const MAX_CORRELATION_LENGTH = 512;
const MAX_ERRORS = 32;
const MAX_WARNINGS = 32;
const MAX_RECEIPTS = 32;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;
const MAX_OFFER_AUTHORITY_LENGTH = 64;

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
  category: string | null;
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

function correlationFromBody(value: unknown) {
  const root = optionalRecord(value);
  const response = optionalRecord(root?.ReservationResponse) ?? optionalRecord(root?.ErrorResponse);
  return boundedText(response?.traceId ?? response?.traceID, MAX_CORRELATION_LENGTH);
}

function inspectProviderErrors(value: unknown): ProviderErrorInspection {
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
  if (!response || !result || !Array.isArray(errors) || errors.length < 1 || errors.length > MAX_ERRORS) {
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
    const raw = error.SourceCode;
    const sourceCode = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    if (!/^\d{1,8}$/.test(sourceCode)) {
      valid = false;
      continue;
    }
    const rawCategory = error.category ?? error.Category;
    let category: string | null = null;
    if (rawCategory !== undefined && rawCategory !== null) {
      if (typeof rawCategory !== 'string') {
        valid = false;
        continue;
      }
      const normalizedCategory = rawCategory.trim().toUpperCase();
      if (!/^[A-Z_]{2,32}$/.test(normalizedCategory)) {
        valid = false;
        continue;
      }
      category = normalizedCategory;
    }
    inspectedErrors.push(Object.freeze({ sourceCode, category }));
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
  return boundedText(property.chainCode, 16) === expected.chainCode
    && boundedText(property.propertyCode, 32) === expected.propertyCode
    && boundedText(dates.start, 10) === expected.arrivalDateLocal
    && boundedText(dates.end, 10) === expected.departureDateLocal
    && product.Quantity === expected.rooms
    && product.guests === expected.guests;
}

function matchedOfferEvidence(reservation: RecordValue, expected: TravelportStaysCreateExpectedReservation) {
  if (!validExpectedReservation(expected)) {
    return Object.freeze({ matches: 0, offerAuthority: null as string | null });
  }
  const offers = reservation.Offer;
  if (!Array.isArray(offers) || offers.length < 1 || offers.length > MAX_OFFERS) {
    return Object.freeze({ matches: 0, offerAuthority: null as string | null });
  }
  let matches = 0;
  let offerAuthority: string | null = null;
  for (const offerValue of offers) {
    const offer = optionalRecord(offerValue);
    if (!offer || !Array.isArray(offer.Product) || offer.Product.length > MAX_PRODUCTS_PER_OFFER) continue;
    for (const productValue of offer.Product) {
      const product = optionalRecord(productValue);
      if (!product || !productMatchesExpectedReservation(product, expected)) continue;
      matches += 1;
      offerAuthority = boundedText(optionalRecord(offer.Identifier)?.authority, MAX_OFFER_AUTHORITY_LENGTH);
    }
  }
  return Object.freeze({ matches, offerAuthority });
}

function confirmedLocatorEvidence(reservation: RecordValue) {
  const receipts = reservation.Receipt;
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > MAX_RECEIPTS) {
    return Object.freeze({ provider: null, supplier: null, supplierSource: null });
  }
  const providers: string[] = [];
  const suppliers: Array<Readonly<{ reference: string; source: string | null }>> = [];
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
    if (context === 'Supplier' && locatorType === 'Confirmation Number') {
      suppliers.push(Object.freeze({ reference, source: boundedText(locator?.source, 16) }));
    }
  }
  const uniqueProviders = [...new Set(providers)];
  const uniqueSupplierReferences = [...new Set(suppliers.map((supplier) => supplier.reference))];
  const uniqueSupplierSources = [...new Set(suppliers.map((supplier) => supplier.source).filter((source): source is string => source !== null))];
  return Object.freeze({
    provider: providers.length === 1 && uniqueProviders.length === 1 ? uniqueProviders[0]! : null,
    supplier: suppliers.length === 1 && uniqueSupplierReferences.length === 1 ? uniqueSupplierReferences[0]! : null,
    supplierSource: suppliers.length === 1 && uniqueSupplierSources.length === 1 ? uniqueSupplierSources[0]! : null,
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
  const providerCorrelationId = correlationFromBody(input.body);
  const errors = inspectProviderErrors(input.body);
  const warnings = inspectProviderWarnings(input.body);

  if (!errors.valid || !warnings.valid) return invalidResponse(providerCorrelationId);

  // The current Stays error contract categorizes 13034 as UNKNOWN. Keep legacy
  // category-less envelopes compatible, but never allow an explicit contradictory
  // category or a mixed error family to grant Sync-required semantics.
  const syncRequiredErrors = errors.present
    && errors.errors.length > 0
    && errors.errors.every(
      (error) => error.sourceCode === SYNC_REQUIRED_SOURCE_CODE
        && (error.category === null || error.category === 'UNKNOWN'),
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
    // Travelport documents the price/guarantee change family as VALIDATION.
    // Category-less legacy envelopes remain reviewable, but a contradictory
    // category or unrelated code cannot authorize a second-sell review decision.
    const reviewErrors = errors.errors.length > 0
      && errors.errors.every((error) => (
        (error.category === null || error.category === 'VALIDATION')
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
    : Object.freeze({ matches: 0, offerAuthority: null as string | null });
  const reservationMatches = offerEvidence.matches === 1;
  const locators = reservation
    ? confirmedLocatorEvidence(reservation)
    : Object.freeze({ provider: null, supplier: null, supplierSource: null });
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
