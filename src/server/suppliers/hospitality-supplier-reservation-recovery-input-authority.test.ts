import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import {
  materializeHospitalitySupplierReservationProviderRequestInput,
  materializeHospitalitySupplierReservationRecoveryEvidenceInput,
  materializeHospitalitySupplierReservationRecoveryScope,
  materializeHospitalitySupplierReservationRecoveryWriteClaimInput,
  materializeHospitalitySupplierReservationRecoveryWriteSettlementInput,
} from './hospitality-supplier-reservation-recovery-input-authority.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  reservationId: '33333333-3333-4333-8333-333333333333',
  attemptId: '44444444-4444-4444-8444-444444444444',
};

function assertSanitized(callback: () => unknown) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof HospitalitySupplierReservationConflictError);
    assert.equal(error.message, 'Supplier reservation recovery request authority is invalid.');
    assert.doesNotMatch(error.message, /caller secret/i);
    return true;
  });
}

test('recovery scope is one-read frozen authority', () => {
  let organizationReads = 0;
  let currentOrganizationId = ids.organizationId;
  const authority = materializeHospitalitySupplierReservationRecoveryScope({
    get organizationId() {
      organizationReads += 1;
      return currentOrganizationId;
    },
    actorUserId: ids.actorUserId,
    reservationId: ids.reservationId,
  });

  currentOrganizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(organizationReads, 1);
  assert.equal(authority.organizationId, ids.organizationId);
  assert.ok(Object.isFrozen(authority));
});

test('throwing accessors and revoked proxies fail through one sanitized boundary', () => {
  assertSanitized(() => materializeHospitalitySupplierReservationRecoveryScope({
    get organizationId() {
      throw new HospitalitySupplierReservationConflictError('caller secret');
    },
    actorUserId: ids.actorUserId,
    reservationId: ids.reservationId,
  }));

  const { proxy, revoke } = Proxy.revocable({ ...ids }, {});
  revoke();
  assertSanitized(() => materializeHospitalitySupplierReservationProviderRequestInput(proxy));
});

test('provider-request authority snapshots freshness once and validates its runtime type', () => {
  let reads = 0;
  const authority = materializeHospitalitySupplierReservationProviderRequestInput({
    ...ids,
    get requireFreshProviderRequest() {
      reads += 1;
      return true;
    },
  });
  assert.equal(reads, 1);
  assert.equal(authority.requireFreshProviderRequest, true);
  assert.ok(Object.isFrozen(authority));

  assert.equal(materializeHospitalitySupplierReservationProviderRequestInput(ids).requireFreshProviderRequest, false);
  assertSanitized(() => materializeHospitalitySupplierReservationProviderRequestInput({
    ...ids,
    requireFreshProviderRequest: 'true',
  }));
});

test('recovery evidence and recovery-write claim snapshot mutable caller values', () => {
  let confirmation = 'supplier-confirmation';
  let confirmationReads = 0;
  const evidence = materializeHospitalitySupplierReservationRecoveryEvidenceInput({
    ...ids,
    get supplierConfirmationReference() {
      confirmationReads += 1;
      return confirmation;
    },
    providerRecoveryReference: 'provider-recovery',
  });
  confirmation = 'mutated';
  assert.equal(confirmationReads, 1);
  assert.equal(evidence.supplierConfirmationReference, 'supplier-confirmation');
  assert.ok(Object.isFrozen(evidence));

  const fingerprint = 'a'.repeat(64);
  const claim = materializeHospitalitySupplierReservationRecoveryWriteClaimInput({
    organizationId: ids.organizationId,
    actorUserId: ids.actorUserId,
    reservationId: ids.reservationId,
    reservationPayloadFingerprint: fingerprint,
  });
  assert.equal(claim.reservationPayloadFingerprint, fingerprint);
  assert.ok(Object.isFrozen(claim));
});

test('settlement snapshots only branch-authoritative outcome fields', () => {
  let statusReads = 0;
  let retryableReads = 0;
  const failed = materializeHospitalitySupplierReservationRecoveryWriteSettlementInput({
    ...ids,
    outcome: {
      get status() {
        statusReads += 1;
        return 'FAILED';
      },
      failureCode: 'PROVIDER_UNAVAILABLE',
      get retryable() {
        retryableReads += 1;
        return true;
      },
      providerCorrelationId: 'corr-1',
      get providerReservationReference() {
        throw new Error('irrelevant branch getter must not run');
      },
    },
  });
  assert.equal(statusReads, 1);
  assert.equal(retryableReads, 1);
  assert.equal(failed.outcome.status, 'FAILED');
  assert.equal(failed.outcome.retryable, true);
  assert.ok(Object.isFrozen(failed));
  assert.ok(Object.isFrozen(failed.outcome));

  assertSanitized(() => materializeHospitalitySupplierReservationRecoveryWriteSettlementInput({
    ...ids,
    outcome: { status: 'FAILED', failureCode: 'X', retryable: 'false' },
  }));
  assertSanitized(() => materializeHospitalitySupplierReservationRecoveryWriteSettlementInput({
    ...ids,
    outcome: { status: 'UNKNOWN' },
  }));
});
