import type { HospitalityCommercialAmendmentExecutionDecision } from './booking-commercial-amendment-execution-domain.ts';

export type HospitalityCommercialAmendmentTransportState =
  | 'MANUAL_SETTLEMENT_REQUIRED'
  | 'STRIPE_REFUND_REQUIRED'
  | 'STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED'
  | 'WAIT_FOR_PROVIDER'
  | 'READY_TO_APPLY'
  | 'RECOVERY_REQUIRED'
  | 'EXPIRED'
  | 'APPLIED'
  | 'CANCELLED'
  | 'CONFLICT';

export function deriveHospitalityCommercialAmendmentTransportState(
  decision: HospitalityCommercialAmendmentExecutionDecision,
): HospitalityCommercialAmendmentTransportState {
  if (decision.state === 'EXECUTE') {
    if (decision.providerCode === 'manual') return 'MANUAL_SETTLEMENT_REQUIRED';
    if (decision.operation === 'REFUND') return 'STRIPE_REFUND_REQUIRED';
    return 'STRIPE_CUSTOMER_AUTHORIZATION_REQUIRED';
  }
  if (decision.state === 'WAIT_FOR_PROVIDER') return 'WAIT_FOR_PROVIDER';
  if (decision.state === 'READY_TO_APPLY') return 'READY_TO_APPLY';
  if (decision.state === 'RECOVERY_REQUIRED') return 'RECOVERY_REQUIRED';
  if (decision.state === 'EXPIRED') return 'EXPIRED';
  if (decision.state === 'CONFLICT') return 'CONFLICT';
  if (decision.status === 'APPLIED') return 'APPLIED';
  if (decision.status === 'CANCELLED') return 'CANCELLED';
  if (decision.status === 'EXPIRED') return 'EXPIRED';
  return 'CONFLICT';
}
