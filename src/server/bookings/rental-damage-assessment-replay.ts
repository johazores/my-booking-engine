export type RentalDamageAssessmentReplayState = Readonly<{
  status: 'OPEN' | 'ASSESSED' | 'WAIVED' | 'CLOSED';
  estimatedRepairCostMinor: bigint | null;
  assessmentNotes: string | null;
}>;

export type RentalDamageAssessmentEvidence = Readonly<{
  estimatedRepairCostMinor: bigint;
  notes: string;
}>;

export type RentalDamageAssessmentReplayDisposition = 'FRESH' | 'REPLAY' | 'CONFLICT' | 'INVALID_TRANSITION';

export function classifyRentalDamageAssessmentReplay(
  current: RentalDamageAssessmentReplayState,
  assessment: RentalDamageAssessmentEvidence,
): RentalDamageAssessmentReplayDisposition {
  if (current.status === 'OPEN') return 'FRESH';

  const hasRetainedAssessment = current.estimatedRepairCostMinor !== null
    && current.assessmentNotes !== null;
  if (!hasRetainedAssessment) return 'INVALID_TRANSITION';

  if (
    current.estimatedRepairCostMinor === assessment.estimatedRepairCostMinor
    && current.assessmentNotes === assessment.notes
  ) {
    return 'REPLAY';
  }

  return 'CONFLICT';
}
