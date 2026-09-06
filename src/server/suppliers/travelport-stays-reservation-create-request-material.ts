import { moneyMinorToMajorString } from '../pricing/money.ts';
import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import type { HospitalitySupplierReservationPaymentAuthority } from './hospitality-supplier-reservation-payment-authority.ts';
import {
  normalizeHospitalitySupplierReservationTravelerPayload,
  type NormalizedHospitalitySupplierReservationTravelerPayload,
} from './hospitality-supplier-reservation-traveler-authority.ts';

const MAX_PROVIDER_SUBMISSION_REFERENCE_LENGTH = 4_096;
const MAX_TRAVELPORT_PERSON_NAME_LENGTH = 22;
const MAX_PAYMENT_CARD_CODES = 32;
const MAX_PAYMENT_CARD_CODE_LENGTH = 16;

export type TravelportStaysReservationCreateRequestMaterial = Readonly<{
  BuildFromCatalogOfferingHospitality: Readonly<{
    '@type': 'BuildFromCatalogOfferingHospitality';
    CatalogOfferingIdentifier: Readonly<{ value: string }>;
  }>;
  Traveler: readonly [Readonly<{
    '@type': 'Traveler';
    PersonName: Readonly<{
      Given: string;
      Surname: string;
    }>;
    Telephone: readonly [Readonly<{
      '@type': 'TelephoneDetail';
      countryAccessCode: string;
      areaCityCode: string;
      phoneNumber: string;
    }>];
    Email: readonly [Readonly<{ value: string }>];
  }>];
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

function providerSubmissionReference(value: unknown) {
  if (typeof value !== 'string') invalidRequest('Travelport reservation offer reference is required.');
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > MAX_PROVIDER_SUBMISSION_REFERENCE_LENGTH
    || /[\r\n]/.test(normalized)
  ) {
    invalidRequest('Travelport reservation offer reference is invalid.');
  }
  return normalized;
}

function travelerPayload(input: NormalizedHospitalitySupplierReservationTravelerPayload) {
  const traveler = normalizeHospitalitySupplierReservationTravelerPayload(input);
  if (traveler.firstName.length + traveler.lastName.length > MAX_TRAVELPORT_PERSON_NAME_LENGTH) {
    invalidRequest(
      'Travelport limits the combined primary traveler given and surname to 22 characters. Review the traveler name before reservation submission.',
    );
  }

  return Object.freeze({
    '@type': 'Traveler' as const,
    PersonName: Object.freeze({
      Given: traveler.firstName,
      Surname: traveler.lastName,
    }),
    Telephone: Object.freeze([
      Object.freeze({
        '@type': 'TelephoneDetail' as const,
        countryAccessCode: traveler.telephone.countryCallingCode,
        areaCityCode: traveler.telephone.areaCode,
        phoneNumber: traveler.telephone.subscriberNumber,
      }),
    ]) as readonly [Readonly<{
      '@type': 'TelephoneDetail';
      countryAccessCode: string;
      areaCityCode: string;
      phoneNumber: string;
    }>],
    Email: Object.freeze([
      Object.freeze({ value: traveler.email }),
    ]) as readonly [Readonly<{ value: string }>],
  });
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
      || !code
      || code !== code.trim()
      || code.length > MAX_PAYMENT_CARD_CODE_LENGTH
      || /[\r\n]/.test(code)
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
  const submissionReference = providerSubmissionReference(input.providerSubmissionReference);
  const traveler = travelerPayload(input.traveler);
  const payment = paymentPayload(input.paymentAuthority);

  return Object.freeze({
    BuildFromCatalogOfferingHospitality: Object.freeze({
      '@type': 'BuildFromCatalogOfferingHospitality' as const,
      CatalogOfferingIdentifier: Object.freeze({ value: submissionReference }),
    }),
    Traveler: Object.freeze([traveler]) as TravelportStaysReservationCreateRequestMaterial['Traveler'],
    Payment: Object.freeze([payment]) as TravelportStaysReservationCreateRequestMaterial['Payment'],
  });
}
