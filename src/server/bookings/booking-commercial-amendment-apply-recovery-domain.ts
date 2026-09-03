export type HospitalityCommercialAmendmentApplyFailureRecoveryRoutingInput = Readonly<{
  amendmentStatus: 'PREPARED' | 'APPLIED' | 'CANCELLED' | 'EXPIRED';
  expiresAt: Date;
  now: Date;
  settlementState: 'REQUIRES_EXECUTION' | 'IN_PROGRESS' | 'READY_TO_APPLY' | 'CONFLICT';
}>;

export type HospitalityCommercialAmendmentApplyFailureRecoveryRoutingDecision = Readonly<
  | {
    state: 'KEEP_APPLY_FAILURE';
    routeToRecovery: false;
    reason: string;
  }
  | {
    state: 'ROUTE_TO_RECOVERY';
    routeToRecovery: true;
    recoveryExpiresAt: Date;
    reason: string;
  }
>;

export function deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting(
  input: HospitalityCommercialAmendmentApplyFailureRecoveryRoutingInput,
): HospitalityCommercialAmendmentApplyFailureRecoveryRoutingDecision {
  if (input.amendmentStatus !== 'PREPARED') {
    return Object.freeze({
      state: 'KEEP_APPLY_FAILURE',
      routeToRecovery: false,
      reason: 'Only a prepared commercial amendment can be routed from final apply into recovery.',
    });
  }

  if (input.settlementState !== 'READY_TO_APPLY') {
    return Object.freeze({
      state: 'KEEP_APPLY_FAILURE',
      routeToRecovery: false,
      reason: 'Final apply recovery routing requires authoritative settlement of the complete amendment delta.',
    });
  }

  const recoveryExpiresAt = input.expiresAt <= input.now ? input.expiresAt : input.now;
  return Object.freeze({
    state: 'ROUTE_TO_RECOVERY',
    routeToRecovery: true,
    recoveryExpiresAt,
    reason: 'External amendment settlement is complete but final booking application failed; compensation recovery now owns the settled delta.',
  });
}
