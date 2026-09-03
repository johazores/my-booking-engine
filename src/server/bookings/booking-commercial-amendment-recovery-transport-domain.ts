import type { HospitalityCommercialAmendmentRecoveryDecision } from './booking-commercial-amendment-recovery-domain.ts';

export type HospitalityCommercialAmendmentRecoveryCheckoutClaimState =
  | 'NONE'
  | 'INTERNAL_CLAIM'
  | 'CHECKOUT_SESSION'
  | 'OTHER_PROVIDER_REFERENCE';

export type HospitalityCommercialAmendmentRecoveryTransportState =
  | 'CHECKOUT_REQUIRED'
  | 'CHECKOUT_RESUME_REQUIRED'
  | 'CHECKOUT_PENDING'
  | 'READY_TO_CLOSE'
  | 'RECOVERED'
  | 'WAIT_FOR_PROVIDER'
  | 'RECOVERY_REQUIRED'
  | 'NOT_EXPIRED'
  | 'TERMINAL'
  | 'CONFLICT';

export function hospitalityCommercialAmendmentRecoveryCheckoutAttemptRequestKey(failedAttempts: number) {
  if (!Number.isSafeInteger(failedAttempts) || failedAttempts < 0) {
    throw new Error('failedAttempts must be a non-negative safe integer.');
  }
  return `staff-recovery-checkout-attempt-${failedAttempts + 1}`;
}

export function deriveHospitalityCommercialAmendmentRecoveryTransportState(input: {
  decision: HospitalityCommercialAmendmentRecoveryDecision;
  checkoutClaimState: HospitalityCommercialAmendmentRecoveryCheckoutClaimState;
}): HospitalityCommercialAmendmentRecoveryTransportState {
  const decision = input.decision;
  if (decision.state === 'TERMINAL') return decision.status === 'EXPIRED' ? 'RECOVERED' : 'TERMINAL';
  if (decision.state === 'READY_TO_EXPIRE') return 'READY_TO_CLOSE';
  if (decision.state === 'NOT_EXPIRED') return 'NOT_EXPIRED';
  if (decision.state === 'CONFLICT') return 'CONFLICT';
  if (
    decision.state === 'COMPENSATE'
    && decision.operation === 'ADDITIONAL_CHARGE'
    && decision.providerCode === 'stripe'
  ) {
    return 'CHECKOUT_REQUIRED';
  }
  if (decision.state === 'WAIT_FOR_PROVIDER') {
    if (input.checkoutClaimState === 'INTERNAL_CLAIM') return 'CHECKOUT_RESUME_REQUIRED';
    if (input.checkoutClaimState === 'CHECKOUT_SESSION') return 'CHECKOUT_PENDING';
    return 'WAIT_FOR_PROVIDER';
  }
  return 'RECOVERY_REQUIRED';
}
