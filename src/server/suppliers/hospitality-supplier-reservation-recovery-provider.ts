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
  retrieveReservation(input: HospitalitySupplierReservationRecoveryRequest): Promise<HospitalitySupplierReservationRecoveryResult>;
}
