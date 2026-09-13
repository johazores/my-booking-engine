import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';

const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_RESULT_ITEMS = 32;
const MAX_OFFERS = 32;
const MAX_PRODUCTS_PER_OFFER = 8;
const MAX_RECEIPTS = 32;
const MAX_TYPE_LENGTH = 64;
const MAX_SOURCE_ID_LENGTH = 64;
const MAX_SOURCE_CODE_LENGTH = 8;
const MAX_CATEGORY_LENGTH = 32;
const MAX_WARNING_MESSAGE_LENGTH = 512;
const MAX_ERROR_MESSAGE_LENGTH = 4_096;
const MAX_OFFER_REFERENCE_LENGTH = 64;
const MAX_IDENTIFIER_LENGTH = 4_096;
const MAX_CHAIN_CODE_LENGTH = 16;
const MAX_PROPERTY_CODE_LENGTH = 32;
const MAX_LOCATOR_REFERENCE_LENGTH = 512;
const MAX_LOCATOR_SOURCE_LENGTH = 16;
const MAX_LOCATOR_CONTEXT_LENGTH = 64;
const MAX_LOCATOR_TYPE_LENGTH = 64;
const MAX_STATUS_LENGTH = 64;
const MIN_ERROR_STATUS_CODE = 100;
const MAX_ERROR_STATUS_CODE = 599;
const MAX_WARNING_STATUS_CODE = 999;

type RecordValue = Readonly<Record<string, unknown>>;
type ReservationResponseFamily = 'ReservationResponse' | 'ErrorResponse';

function invalidResponse(message = 'Travelport reservation response contained invalid machine authority evidence.'): never {
  throw new HospitalitySupplierProviderError('INVALID_RESPONSE', message);
}

function record(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function boundedArray(value: unknown, max: number): readonly unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) invalidResponse();
  return value;
}

function assertExactMachineStringIfPresent(value: unknown, max: number): void {
  if (value === undefined || value === null) return;
  if (
    typeof value !== 'string'
    || !value
    || value.length > max
    || value.trim() !== value
    || ASCII_CONTROL_PATTERN.test(value)
  ) invalidResponse();
}

function assertBoundedProviderTextIfPresent(value: unknown, max: number): void {
  if (value === undefined || value === null) return;
  if (
    typeof value !== 'string'
    || !value
    || value.length > max
    || value.trim() !== value
    || ASCII_CONTROL_PATTERN.test(value)
  ) invalidResponse();
}

function assertLocalDateIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalidResponse();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalidResponse();
}

function assertSourceCodeIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 99_999_999) invalidResponse();
    return;
  }
  assertExactMachineStringIfPresent(value, MAX_SOURCE_CODE_LENGTH);
  if (!/^\d{1,8}$/.test(value as string)) invalidResponse();
}

function assertCategoryIfPresent(value: unknown): void {
  if (value === undefined || value === null) return;
  assertExactMachineStringIfPresent(value, MAX_CATEGORY_LENGTH);
  if (!/^[A-Z_]{2,32}$/.test(value as string)) invalidResponse();
}

function validateResult(
  response: RecordValue,
  responseFamily: ReservationResponseFamily,
  httpStatus?: number,
): void {
  if (response.Result === undefined || response.Result === null) {
    if (responseFamily === 'ErrorResponse') invalidResponse();
    return;
  }
  const result = record(response.Result);
  if (!result) invalidResponse();

  const resultType = result['@type'];
  if (resultType !== undefined) {
    assertExactMachineStringIfPresent(resultType, MAX_TYPE_LENGTH);
    if (resultType !== 'Result') invalidResponse();
  }
  if (result.Errors !== undefined) invalidResponse();
  if (responseFamily === 'ReservationResponse' && result.Error !== undefined) invalidResponse();

  const errorValues = boundedArray(result.Error, MAX_RESULT_ITEMS);
  if (
    responseFamily === 'ErrorResponse'
    && (result.Error === undefined || errorValues.length < 1 || resultType !== 'Result')
  ) invalidResponse();
  if (result.Error !== undefined && (errorValues.length < 1 || resultType !== 'Result')) invalidResponse();
  for (const errorValue of errorValues) {
    const error = record(errorValue);
    if (!error || error['@type'] !== 'ErrorDetail' || error.Category !== undefined) invalidResponse();
    const statusCode = error.StatusCode;
    if (
      typeof statusCode !== 'number'
      || !Number.isInteger(statusCode)
      || statusCode < MIN_ERROR_STATUS_CODE
      || statusCode > MAX_ERROR_STATUS_CODE
      || (httpStatus !== undefined && statusCode !== httpStatus)
    ) invalidResponse();
    if (
      error.SourceID === undefined
      || error.SourceID === null
      || error.SourceCode === undefined
      || error.SourceCode === null
      || error.category === undefined
      || error.category === null
      || error.Message === undefined
      || error.Message === null
    ) invalidResponse();
    assertExactMachineStringIfPresent(error.SourceID, MAX_SOURCE_ID_LENGTH);
    assertSourceCodeIfPresent(error.SourceCode);
    assertCategoryIfPresent(error.category);
    assertBoundedProviderTextIfPresent(error.Message, MAX_ERROR_MESSAGE_LENGTH);
  }

  const hasWarning = result.Warning !== undefined;
  const hasWarnings = result.Warnings !== undefined;
  if (hasWarning && hasWarnings) invalidResponse();
  if (responseFamily === 'ErrorResponse' && (hasWarning || hasWarnings)) invalidResponse();
  if (errorValues.length > 0 && (hasWarning || hasWarnings)) invalidResponse();
  const warnings = hasWarning ? result.Warning : result.Warnings;
  const warningValues = boundedArray(warnings, MAX_RESULT_ITEMS);
  if ((hasWarning || hasWarnings) && warningValues.length < 1) invalidResponse();
  for (const warningValue of warningValues) {
    const warning = record(warningValue);
    if (!warning) invalidResponse();
    const warningType = warning['@type'];
    if (warningType !== undefined) {
      assertExactMachineStringIfPresent(warningType, MAX_TYPE_LENGTH);
      if (warningType !== 'Warning') invalidResponse();
    }
    const statusCode = warning.StatusCode;
    if (
      statusCode !== undefined
      && (
        typeof statusCode !== 'number'
        || !Number.isInteger(statusCode)
        || statusCode < 0
        || statusCode > MAX_WARNING_STATUS_CODE
      )
    ) invalidResponse();
    if (warning.Message === undefined || warning.Message === null) invalidResponse();
    assertBoundedProviderTextIfPresent(warning.Message, MAX_WARNING_MESSAGE_LENGTH);
  }
}

function validateOfferProduct(value: unknown): void {
  const product = record(value);
  if (!product) invalidResponse();
  assertExactMachineStringIfPresent(product['@type'], MAX_TYPE_LENGTH);
  if (product['@type'] !== 'ProductHospitality') return;

  const propertyKey = record(product.PropertyKey);
  if (product.PropertyKey !== undefined && !propertyKey) invalidResponse();
  if (propertyKey) {
    assertExactMachineStringIfPresent(propertyKey['@type'], MAX_TYPE_LENGTH);
    assertExactMachineStringIfPresent(propertyKey.chainCode, MAX_CHAIN_CODE_LENGTH);
    assertExactMachineStringIfPresent(propertyKey.propertyCode, MAX_PROPERTY_CODE_LENGTH);
  }

  const dateRange = record(product.DateRange);
  if (product.DateRange !== undefined && !dateRange) invalidResponse();
  if (dateRange) {
    assertLocalDateIfPresent(dateRange.start);
    assertLocalDateIfPresent(dateRange.end);
  }
}

function validateOffer(value: unknown): void {
  const offer = record(value);
  if (!offer) invalidResponse();
  assertExactMachineStringIfPresent(offer['@type'], MAX_TYPE_LENGTH);
  assertExactMachineStringIfPresent(offer.id, MAX_OFFER_REFERENCE_LENGTH);

  const identifier = record(offer.Identifier);
  if (offer.Identifier !== undefined && !identifier) invalidResponse();
  if (identifier) {
    assertExactMachineStringIfPresent(identifier.authority, MAX_TYPE_LENGTH);
    assertExactMachineStringIfPresent(identifier.value, MAX_IDENTIFIER_LENGTH);
  }

  for (const productValue of boundedArray(offer.Product, MAX_PRODUCTS_PER_OFFER)) {
    validateOfferProduct(productValue);
  }
}

function validateLocator(value: unknown): void {
  const locator = record(value);
  if (!locator) invalidResponse();
  assertExactMachineStringIfPresent(locator.value, MAX_LOCATOR_REFERENCE_LENGTH);
  assertExactMachineStringIfPresent(locator.source, MAX_LOCATOR_SOURCE_LENGTH);
  assertExactMachineStringIfPresent(locator.sourceContext, MAX_LOCATOR_CONTEXT_LENGTH);
  assertExactMachineStringIfPresent(locator.locatorType, MAX_LOCATOR_TYPE_LENGTH);
}

function validateOfferStatus(value: unknown): void {
  if (value === undefined || value === null) return;
  const offerStatus = record(value);
  if (!offerStatus) invalidResponse();
  assertExactMachineStringIfPresent(offerStatus['@type'], MAX_TYPE_LENGTH);
  assertExactMachineStringIfPresent(offerStatus.code, MAX_STATUS_LENGTH);
  assertExactMachineStringIfPresent(offerStatus.Status, MAX_STATUS_LENGTH);
}

function validateReceiptBranch(value: unknown): void {
  if (value === undefined || value === null) return;
  const branch = record(value);
  if (!branch) invalidResponse();
  assertExactMachineStringIfPresent(branch['@type'], MAX_TYPE_LENGTH);
  if (branch.Locator !== undefined && branch.Locator !== null) validateLocator(branch.Locator);
  validateOfferStatus(branch.OfferStatus);
}

function validateReceipt(value: unknown): void {
  const receipt = record(value);
  if (!receipt) invalidResponse();
  assertExactMachineStringIfPresent(receipt['@type'], MAX_TYPE_LENGTH);
  for (const offerRef of boundedArray(receipt.OfferRef, MAX_OFFERS)) {
    assertExactMachineStringIfPresent(offerRef, MAX_OFFER_REFERENCE_LENGTH);
  }
  validateReceiptBranch(receipt.Confirmation);
  validateReceiptBranch(receipt.Cancellation);
}

function validateReservation(response: RecordValue): void {
  if (response.Reservation === undefined || response.Reservation === null) return;
  const reservation = record(response.Reservation);
  if (!reservation) invalidResponse();
  assertExactMachineStringIfPresent(reservation['@type'], MAX_TYPE_LENGTH);

  for (const offerValue of boundedArray(reservation.Offer, MAX_OFFERS)) validateOffer(offerValue);
  for (const receiptValue of boundedArray(reservation.Receipt, MAX_RECEIPTS)) validateReceipt(receiptValue);
}

/**
 * Production reservation response authority guard.
 *
 * The compatibility classifiers intentionally remain isolated behind this boundary. Provider
 * machine evidence that can influence reservation identity, review/retry decisions, or Sync
 * recovery must arrive in one exact spelling; it may not gain authority through trimming,
 * recasing of error categories, or ignored ASCII control characters.
 */
export function assertTravelportStaysReservationResponseMachineAuthority(value: unknown, httpStatus?: number): void {
  if (
    httpStatus !== undefined
    && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)
  ) invalidResponse();
  const root = record(value);
  if (!root) invalidResponse();
  const hasReservationResponse = Object.prototype.hasOwnProperty.call(root, 'ReservationResponse');
  const hasErrorResponse = Object.prototype.hasOwnProperty.call(root, 'ErrorResponse');
  if (hasReservationResponse === hasErrorResponse) invalidResponse();

  const responseFamily: ReservationResponseFamily = hasReservationResponse ? 'ReservationResponse' : 'ErrorResponse';
  const response = record(root[responseFamily]);
  if (!response || Object.prototype.hasOwnProperty.call(response, 'traceID')) invalidResponse();
  if (responseFamily === 'ErrorResponse' && response.Reservation !== undefined) invalidResponse();
  assertExactMachineStringIfPresent(response.traceId, 120);
  validateResult(response, responseFamily, httpStatus);
  if (responseFamily === 'ReservationResponse') validateReservation(response);
}
