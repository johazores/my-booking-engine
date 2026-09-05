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
  retrieveReservation(providerReservationReference: string): Promise<HospitalitySupplierReservationRecoveryResult>;
}
