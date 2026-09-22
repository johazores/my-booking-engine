export type HospitalitySupplierReservationRecoveryExpectation = Readonly<{
  supplierPropertyReference: string;
  arrivalDateLocal: string;
  departureDateLocal: string;
  rooms: number;
  adults: number;
  childAges: readonly number[];
}>;

export type HospitalitySupplierReservationRecoveryRequest = Readonly<{
  providerReservationReference: string;
  requestCorrelationId: string;
  expectedReservation: HospitalitySupplierReservationRecoveryExpectation;
  beforeProviderRequest: () => Promise<void>;
}>;

export type HospitalitySupplierReservationRecoveryResult =
  | Readonly<{
      status: 'FOUND';
      providerReservationReference: string;
      supplierConfirmationReference: string | null;
      providerCorrelationId: string | null;
    }>
  | Readonly<{
      status: 'NOT_FOUND';
      providerReservationReference: string;
      providerCorrelationId: string | null;
    }>;

export interface HospitalitySupplierReservationRecoveryProvider {
  readonly code: string;
  readonly requiresSupplierConfirmationForFound?: boolean;
  readonly supportsAuthoritativeNotFound?: boolean;
  retrieveReservation(input: HospitalitySupplierReservationRecoveryRequest): Promise<HospitalitySupplierReservationRecoveryResult>;
}
