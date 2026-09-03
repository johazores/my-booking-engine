import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting } from './booking-commercial-amendment-apply-recovery-domain.ts';

const now = new Date('2026-09-03T12:00:00.000Z');
const later = new Date('2026-09-03T12:10:00.000Z');
const earlier = new Date('2026-09-03T11:50:00.000Z');

test('routes a fully settled prepared amendment into recovery immediately after apply failure', () => {
  const decision = deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting({
    amendmentStatus: 'PREPARED',
    expiresAt: later,
    now,
    settlementState: 'READY_TO_APPLY',
  });

  assert.equal(decision.state, 'ROUTE_TO_RECOVERY');
  assert.equal(decision.routeToRecovery, true);
  if (!decision.routeToRecovery) return;
  assert.equal(decision.recoveryExpiresAt.toISOString(), now.toISOString());
});

test('never extends an already expired amendment while routing settled money to recovery', () => {
  const decision = deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting({
    amendmentStatus: 'PREPARED',
    expiresAt: earlier,
    now,
    settlementState: 'READY_TO_APPLY',
  });

  assert.equal(decision.state, 'ROUTE_TO_RECOVERY');
  assert.equal(decision.routeToRecovery, true);
  if (!decision.routeToRecovery) return;
  assert.equal(decision.recoveryExpiresAt.toISOString(), earlier.toISOString());
});

test('does not surrender the apply window while provider settlement is unresolved', () => {
  for (const settlementState of ['REQUIRES_EXECUTION', 'IN_PROGRESS'] as const) {
    const decision = deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting({
      amendmentStatus: 'PREPARED',
      expiresAt: later,
      now,
      settlementState,
    });
    assert.equal(decision.state, 'KEEP_APPLY_FAILURE');
    assert.equal(decision.routeToRecovery, false);
  }
});

test('does not route a ledger conflict as though money were safely settled', () => {
  const decision = deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting({
    amendmentStatus: 'PREPARED',
    expiresAt: later,
    now,
    settlementState: 'CONFLICT',
  });

  assert.equal(decision.state, 'KEEP_APPLY_FAILURE');
  assert.equal(decision.routeToRecovery, false);
});

test('does not route terminal amendment states', () => {
  for (const amendmentStatus of ['APPLIED', 'CANCELLED', 'EXPIRED'] as const) {
    const decision = deriveHospitalityCommercialAmendmentApplyFailureRecoveryRouting({
      amendmentStatus,
      expiresAt: later,
      now,
      settlementState: 'READY_TO_APPLY',
    });
    assert.equal(decision.state, 'KEEP_APPLY_FAILURE');
    assert.equal(decision.routeToRecovery, false);
  }
});
