import { moneyMinorToMajorString } from '../pricing/money.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import type { NormalizedHospitalitySupplierReservationTravelerPayload } from './hospitality-supplier-reservation-traveler-authority.ts';
import {
  buildTravelportStaysReservationTravelerRequest,
  type TravelportStaysReservationTravelerRequest,
} from './travelport-stays-reservation-traveler-request.ts';

const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_PROVIDER_SUBMISSION_REFERENCE_LENGTH = 4_096;
const MAX_PAYMENT_CARD_CODES = 32;
const PAYMENT_CARD_CODE_LENGTH = 2;
const PAYMENT_CARD_CODE_PATTERN = /^[A-Z0-9]{2}$/;
const MATERIALIZATION_FAILURE = 'Travelport reservation create request material authority could not be materialized safely.';

export type TravelportStaysReservationCreateRequestMaterial = Readonly<{
  BuildFromCatalogOfferingHospitality: Readonly<{
    '@type': 'BuildFromCatalogOfferingHospitality';
    CatalogOfferingIdentifier: Readonly<{ value: string }>;
  }>;
  Traveler: readonly [TravelportStaysReservationTravelerRequest];
  Payment: readonly [Readonly<{
    '@type': 'Payment';
    Amount: Readonly<{
      code: string;
      value: string;
    }>;
    guaranteeInd: boolean;
    depositInd: boolean;
  }>];
}>;

function invalidRequest(message: string): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

function materializationFailure(): never {
  invalidRequest(MATERIALIZATION_FAILURE);
}

function snapshotTraveler(
  value: unknown,
): NormalizedHospitalitySupplierReservationTravelerPayload {
  if (!value || typeof value !== 'object') return value as NormalizedHospitalitySupplierReservationTravelerPayload;

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    materializationFailure();
  }
  if (isArray) return value as NormalizedHospitalitySupplierReservationTravelerPayload;

  let firstName: unknown;
  let lastName: unknown;
  let email: unknown;
  let telephone: unknown;
  try {
    const traveler = value as Record<string, unknown>;
    firstName = traveler.firstName;
    lastName = traveler.lastName;
    email = traveler.email;
    telephone = traveler.telephone;
  } catch {
    materializationFailure();
  }

  let telephoneSnapshot = telephone;
  if (telephone && typeof telephone === 'object') {
    let telephoneIsArray: boolean;
    try {
      telephoneIsArray = Array.isArray(telephone);
    } catch {
      materializationFailure();
    }
    if (!telephoneIsArray) {
      try {
        const telephoneRecord = telephone as Record<string, unknown>;
        telephoneSnapshot = Object.freeze({
          countryCallingCode: telephoneRecord.countryCallingCode,
          areaCode: telephoneRecord.areaCode,
          subscriberNumber: telephoneRecord.subscriberNumber,
        });
      } catch {
        materializationFailure();
      }
    }
  }

  return Object.freeze({
    firstName,
    lastName,
    email,
    telephone: telephoneSnapshot,
  }) as NormalizedHospitalitySupplierReservationTravelerPayload;
}

function snapshotAcceptedPaymentCardCodes(value: unknown): unknown {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    materializationFailure();
  }
  if (!isArray) return value;

  let length: number;
  try {
    length = (value as unknown[]).length;
  } catch {
    materializationFailure();
  }
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_PAYMENT_CARD_CODES) {
    return Object.freeze([]);
  }

  const snapshot: unknown[] = [];
  try {
    for (let index = 0; index < length; index += 1) {
      snapshot.push((value as unknown[])[index]);
    }
  } catch {
    materializationFailure();
  }
  return Object.freeze(snapshot);
}

function snapshotPaymentAuthority(
  value: unknown,
): HospitalitySupplierReservationPaymentAuthority {
  if (!value || typeof value !== 'object') return value as HospitalitySupplierReservationPaymentAuthority;

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    materializationFailure();
  }
  if (isArray) return value as HospitalitySupplierReservationPaymentAuthority;

  let kind: unknown;
  let collectionTiming: unknown;
  let currency: unknown;
  let amountMinor: unknown;
  let acceptedPaymentCardCodes: unknown;
  try {
    const authority = value as Record<string, unknown>;
    kind = authority.kind;
    collectionTiming = authority.collectionTiming;
    currency = authority.currency;
    amountMinor = authority.amountMinor;
    acceptedPaymentCardCodes = authority.acceptedPaymentCardCodes;
  } catch {
    materializationFailure();
  }

  return Object.freeze({
    kind,
    collectionTiming,
    currency,
    amountMinor,
    acceptedPaymentCardCodes: snapshotAcceptedPaymentCardCodes(acceptedPaymentCardCodes),
  }) as HospitalitySupplierReservationPaymentAuthority;
}

function materializeInput(input: unknown) {
  let providerSubmissionReferenceValue: unknown;
  let travelerValue: unknown;
  let paymentAuthorityValue: unknown;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      materializationFailure();
    }
    const record = input as Record<string, unknown>;
    providerSubmissionReferenceValue = record.providerSubmissionReference;
    travelerValue = record.traveler;
    paymentAuthorityValue = record.paymentAuthority;
  } catch {
    materializationFailure();
  }

  return Object.freeze({
    providerSubmissionReference: providerSubmissionReferenceValue,
    traveler: snapshotTraveler(travelerValue),
    paymentAuthority: snapshotPaymentAuthority(paymentAuthorityValue),
  });
}

function providerSubmissionReference(value: unknown) {
  if (typeof value !== 'string') invalidRequest('Travelport reservation offer reference is required.');
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > MAX_PROVIDER_SUBMISSION_REFERENCE_LENGTH
    || ASCII_CONTROL_PATTERN.test(normalized)
  ) {
    invalidRequest('Travelport reservation offer reference is invalid.');
  }
  return normalized;
}

function paymentPayload(authority: HospitalitySupplierReservationPaymentAuthority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    invalidRequest('Travelport reservation payment authority is required.');
  }
  if (!/^[A-Z]{3}$/.test(authority.currency)) {
    invalidRequest('Travelport reservation payment currency is invalid.');
  }
  if (typeof authority.amountMinor !== 'bigint' || authority.amountMinor < 0n) {
    invalidRequest('Travelport reservation payment amount is invalid.');
  }

  const cardCodes = authority.acceptedPaymentCardCodes;
  if (!Array.isArray(cardCodes) || cardCodes.length < 1 || cardCodes.length > MAX_PAYMENT_CARD_CODES) {
    invalidRequest('Travelport reservation accepted-card authority is invalid.');
  }
  const seenCardCodes = new Set<string>();
  for (const code of cardCodes) {
    if (
      typeof code !== 'string'
      || code.length !== PAYMENT_CARD_CODE_LENGTH
      || !PAYMENT_CARD_CODE_PATTERN.test(code)
      || code !== code.trim()
      || ASCII_CONTROL_PATTERN.test(code)
      || seenCardCodes.has(code)
    ) {
      invalidRequest('Travelport reservation accepted-card authority is invalid.');
    }
    seenCardCodes.add(code);
  }

  const atBooking = authority.kind === 'PREPAY' || authority.kind === 'DEPOSIT';
  const atProperty = authority.kind === 'GUARANTEE';
  if (
    (!atBooking && !atProperty)
    || (atBooking && authority.collectionTiming !== 'AT_BOOKING')
    || (atProperty && authority.collectionTiming !== 'AT_PROPERTY')
  ) {
    invalidRequest('Travelport reservation payment timing is invalid.');
  }

  let amount: string;
  try {
    amount = moneyMinorToMajorString(authority.amountMinor, authority.currency);
  } catch {
    invalidRequest('Travelport reservation payment amount is invalid.');
  }

  return Object.freeze({
    '@type': 'Payment' as const,
    Amount: Object.freeze({
      code: authority.currency,
      value: amount,
    }),
    guaranteeInd: atProperty,
    depositInd: atBooking,
  });
}

export function buildTravelportStaysReservationCreateRequestMaterial(input: Readonly<{
  providerSubmissionReference: unknown;
  traveler: NormalizedHospitalitySupplierReservationTravelerPayload;
  paymentAuthority: HospitalitySupplierReservationPaymentAuthority;
}>): TravelportStaysReservationCreateRequestMaterial {
  const authority = materializeInput(input);
  const submissionReference = providerSubmissionReference(authority.providerSubmissionReference);
  const traveler = buildTravelportStaysReservationTravelerRequest(authority.traveler);
  const payment = paymentPayload(authority.paymentAuthority);

  return Object.freeze({
    BuildFromCatalogOfferingHospitality: Object.freeze({
      '@type': 'BuildFromCatalogOfferingHospitality' as const,
      CatalogOfferingIdentifier: Object.freeze({ value: submissionReference }),
    }),
    Traveler: Object.freeze([traveler]) as TravelportStaysReservationCreateRequestMaterial['Traveler'],
    Payment: Object.freeze([payment]) as TravelportStaysReservationCreateRequestMaterial['Payment'],
  });
}
