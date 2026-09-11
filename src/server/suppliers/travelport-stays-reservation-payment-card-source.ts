import { assertUuidIdentifier } from '../tenancy/tenant-scope.ts';
import {
  hospitalitySupplierFailureCodes,
  HospitalitySupplierProviderError,
  type HospitalitySupplierFailureCode,
} from './hospitality-supplier-provider.ts';
import type { TravelportStaysSensitiveReservationPaymentCard } from './travelport-stays-reservation-create-executor.ts';

const MAX_INTEGRATION_CREDENTIAL_VERSION = 2_147_483_647;
const SOURCE_FAILURE_MESSAGE = 'Travelport reservation payment-card source could not provide usable card material.';
const SOURCE_CONTEXT_FAILURE_MESSAGE = 'Travelport reservation payment-card source context is invalid.';
const BILLING_ADDRESS_KEYS = Object.freeze([
  'addressLine',
  'city',
  'stateProvince',
  'countryCode',
  'postalCode',
] as const);
const TELEPHONE_KEYS = Object.freeze([
  'countryAccessCode',
  'areaCityCode',
  'phoneNumber',
  'cityCode',
] as const);

export type TravelportStaysReservationPaymentCardPurpose =
  | 'INITIAL_CREATE'
  | 'REVIEW_ACCEPTANCE_CREATE';

export type TravelportStaysReservationPaymentCardSourceContext = Readonly<{
  organizationId: string;
  reservationId: string;
  integrationId: string;
  integrationCredentialVersion: number;
  attemptId: string;
  purpose: TravelportStaysReservationPaymentCardPurpose;
}>;

/**
 * Server-only capability for obtaining one ephemeral Travelport form of payment.
 *
 * Implementations must source the card through a separately reviewed PCI boundary. This contract
 * deliberately carries only non-sensitive reservation/integration identifiers; it is not a token
 * vault, browser collection API, persistence model, or evidence that SF is PCI-ready.
 */
export type TravelportStaysReservationPaymentCardSource = Readonly<{
  acquirePaymentCard(
    context: TravelportStaysReservationPaymentCardSourceContext,
  ): Promise<TravelportStaysSensitiveReservationPaymentCard>;
}>;

function invalidSource(message: string): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function requiredIdentifier(value: unknown, label: string) {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\r\n]/.test(value)) {
    invalidSource(`${label} is invalid.`);
  }
  try {
    return assertUuidIdentifier(value, label);
  } catch {
    invalidSource(`${label} is invalid.`);
  }
}

function sourceFailure(error: unknown): never {
  let code: HospitalitySupplierFailureCode = 'INVALID_REQUEST';
  try {
    if (
      error instanceof HospitalitySupplierProviderError
      && hospitalitySupplierFailureCodes.includes(error.code)
    ) {
      code = error.code;
    }
  } catch {
    // Source-controlled thrown values can themselves be hostile proxies. Treat them as untyped.
  }
  throw new HospitalitySupplierProviderError(code, SOURCE_FAILURE_MESSAGE);
}

function sourceRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  try {
    if (Array.isArray(value)) return null;
  } catch (error) {
    sourceFailure(error);
  }
  return value as Record<string, unknown>;
}

function snapshotOptionalRecord(
  value: unknown,
  keys: readonly string[],
): unknown {
  if (value === undefined) return undefined;
  const record = sourceRecord(value);
  if (!record) return value;

  const snapshot: Record<string, unknown> = {};
  try {
    for (const key of keys) snapshot[key] = record[key];
  } catch (error) {
    sourceFailure(error);
  }
  return Object.freeze(snapshot);
}

function snapshotPaymentCard(value: unknown): TravelportStaysSensitiveReservationPaymentCard {
  const paymentCard = sourceRecord(value);
  if (!paymentCard) {
    invalidSource('Travelport reservation payment-card source returned no usable card material.');
  }

  let cardType: unknown;
  let cardCode: unknown;
  let cardHolderName: unknown;
  let expireDate: unknown;
  let cardNumber: unknown;
  let securityCode: unknown;
  let billingAddress: unknown;
  let telephone: unknown;
  try {
    cardType = paymentCard.cardType;
    cardCode = paymentCard.cardCode;
    cardHolderName = paymentCard.cardHolderName;
    expireDate = paymentCard.expireDate;
    cardNumber = paymentCard.cardNumber;
    securityCode = paymentCard.securityCode;
    billingAddress = paymentCard.billingAddress;
    telephone = paymentCard.telephone;
  } catch (error) {
    sourceFailure(error);
  }

  const billingAddressSnapshot = snapshotOptionalRecord(billingAddress, BILLING_ADDRESS_KEYS);
  const telephoneSnapshot = snapshotOptionalRecord(telephone, TELEPHONE_KEYS);

  return Object.freeze({
    cardType,
    cardCode,
    cardHolderName,
    expireDate,
    cardNumber,
    securityCode,
    ...(billingAddressSnapshot === undefined ? {} : { billingAddress: billingAddressSnapshot }),
    ...(telephoneSnapshot === undefined ? {} : { telephone: telephoneSnapshot }),
  }) as TravelportStaysSensitiveReservationPaymentCard;
}

function materializeSourceContext(value: unknown): TravelportStaysReservationPaymentCardSourceContext {
  let organizationId: unknown;
  let reservationId: unknown;
  let integrationId: unknown;
  let integrationCredentialVersion: unknown;
  let attemptId: unknown;
  let purpose: unknown;

  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalidSource(SOURCE_CONTEXT_FAILURE_MESSAGE);
    }
    const context = value as Record<string, unknown>;
    organizationId = context.organizationId;
    reservationId = context.reservationId;
    integrationId = context.integrationId;
    integrationCredentialVersion = context.integrationCredentialVersion;
    attemptId = context.attemptId;
    purpose = context.purpose;
  } catch {
    invalidSource(SOURCE_CONTEXT_FAILURE_MESSAGE);
  }

  const normalizedContext = Object.freeze({
    organizationId: requiredIdentifier(organizationId, 'Travelport payment-card organization ID'),
    reservationId: requiredIdentifier(reservationId, 'Travelport payment-card reservation ID'),
    integrationId: requiredIdentifier(integrationId, 'Travelport payment-card integration ID'),
    integrationCredentialVersion,
    attemptId: requiredIdentifier(attemptId, 'Travelport payment-card attempt ID'),
    purpose,
  });

  if (
    !Number.isSafeInteger(normalizedContext.integrationCredentialVersion)
    || (normalizedContext.integrationCredentialVersion as number) < 1
    || (normalizedContext.integrationCredentialVersion as number) > MAX_INTEGRATION_CREDENTIAL_VERSION
  ) {
    invalidSource('Travelport payment-card integration credential version is invalid.');
  }
  if (
    normalizedContext.purpose !== 'INITIAL_CREATE'
    && normalizedContext.purpose !== 'REVIEW_ACCEPTANCE_CREATE'
  ) {
    invalidSource('Travelport reservation payment-card purpose is invalid.');
  }

  return normalizedContext as TravelportStaysReservationPaymentCardSourceContext;
}

export async function acquireTravelportStaysReservationPaymentCard(
  source: TravelportStaysReservationPaymentCardSource,
  context: TravelportStaysReservationPaymentCardSourceContext,
) {
  if (!source || typeof source !== 'object') {
    invalidSource('Travelport reservation payment-card source is unavailable.');
  }
  let sourceIsArray: boolean;
  try {
    sourceIsArray = Array.isArray(source);
  } catch (error) {
    sourceFailure(error);
  }
  if (sourceIsArray) {
    invalidSource('Travelport reservation payment-card source is unavailable.');
  }

  let acquirePaymentCard: TravelportStaysReservationPaymentCardSource['acquirePaymentCard'];
  try {
    acquirePaymentCard = source.acquirePaymentCard;
  } catch (error) {
    sourceFailure(error);
  }
  if (typeof acquirePaymentCard !== 'function') {
    invalidSource('Travelport reservation payment-card source is unavailable.');
  }

  const normalizedContext = materializeSourceContext(context);

  let paymentCard: unknown;
  try {
    paymentCard = await acquirePaymentCard.call(source, normalizedContext);
  } catch (error) {
    sourceFailure(error);
  }
  return snapshotPaymentCard(paymentCard);
}
