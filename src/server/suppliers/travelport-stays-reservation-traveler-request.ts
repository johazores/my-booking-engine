import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  normalizeHospitalitySupplierReservationTravelerPayload,
  type NormalizedHospitalitySupplierReservationTravelerPayload,
} from './hospitality-supplier-reservation-traveler-authority.ts';

const MAX_TRAVELPORT_PERSON_NAME_LENGTH = 22;

export type TravelportStaysReservationTravelerRequest = Readonly<{
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
}>;

function invalidRequest(message: string): never {
  throw new HospitalitySupplierProviderError('INVALID_REQUEST', message);
}

export function buildTravelportStaysReservationTravelerRequest(
  input: NormalizedHospitalitySupplierReservationTravelerPayload,
): TravelportStaysReservationTravelerRequest {
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
    ]) as TravelportStaysReservationTravelerRequest['Telephone'],
    Email: Object.freeze([
      Object.freeze({ value: traveler.email }),
    ]) as TravelportStaysReservationTravelerRequest['Email'],
  });
}
