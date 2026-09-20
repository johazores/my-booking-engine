import type { RentalMaintenanceStatus } from './rental-maintenance-domain.ts';

export type RentalMaintenanceStartReplayState = Readonly<{
  status: RentalMaintenanceStatus;
  startedAt: Date | null;
  startedByUserId: string | null;
}>;

export type RentalMaintenanceStartReplayDisposition = 'FRESH' | 'REPLAY' | 'INVALID_TRANSITION';

function hasRetainedStartEvidence(current: RentalMaintenanceStartReplayState) {
  return current.startedAt instanceof Date
    && !Number.isNaN(current.startedAt.getTime())
    && typeof current.startedByUserId === 'string'
    && current.startedByUserId.length > 0;
}

export function classifyRentalMaintenanceStartReplay(
  current: RentalMaintenanceStartReplayState,
): RentalMaintenanceStartReplayDisposition {
  if (current.status === 'OPEN') return 'FRESH';
  if (hasRetainedStartEvidence(current)) return 'REPLAY';
  return 'INVALID_TRANSITION';
}
