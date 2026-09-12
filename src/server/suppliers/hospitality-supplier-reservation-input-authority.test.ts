import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierReservationConflictError } from './hospitality-supplier-reservation-domain.ts';
import {
  materializeHospitalitySupplierReservationAcceptedReviewInput,
  materializeHospitalitySupplierReservationCommercialReviewAcceptanceInput,
  materializeHospitalitySupplierReservationPreparationInput,
  materializeHospitalitySupplierReservationReconciliationSettlementInput,
  materializeHospitalitySupplierReservationReviewAndClaimInput,
  materializeHospitalitySupplierReservationSubmissionSettlementInput,
} from './hospitality-supplier-reservation-input-authority.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  actorUserId: '22222222-2222-4222-8222-222222222222',
  reservationId: '33333333-3333-4333-8333-333333333333',
  attemptId: '44444444-4444-4444-8444-444444444444',
  integrationId: '55555555-5555-4555-8555-555555555555',
};

function assertSanitized(callback: () => unknown) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof HospitalitySupplierReservationConflictError);
    assert.equal(error.message, 'Supplier reservation request authority is invalid.');
    assert.doesNotMatch(error.message, /caller secret/i);
    return true;
  });
}

function selection(childAges: unknown = [8, 11]) {
  return {
    providerCode: 'travelport-stays',
    supplierPropertyReference: 'property',
    supplierOfferReference: 'offer',
    offerFingerprint: 'a'.repeat(64),
    termsFingerprint: 'b'.repeat(64),
    reservationAuthorityFingerprint: 'c'.repeat(64),
    reservationPayloadFingerprint: 'd'.repeat(64),
    currency: 'AUD',
    expectedTotalMinor: 12_345n,
    arrivalDateLocal: '2026-10-01',
    departureDateLocal: '2026-10-02',
    rooms: 1,
    adults: 2,
    childAges,
  };
}

function traveler() {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    telephone: {
      countryCallingCode: '61',
      areaCode: '2',
      subscriberNumber: '99999999',
    },
  };
}

test('preparation freezes tenant, commercial selection, and child-age authority before awaits', () => {
  let organizationReads = 0;
  let childReads = 0;
  const childAges = new Proxy([8, 11], {
    get(target, property, receiver) {
      if (property === '0' || property === '1') childReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const raw = {
    get organizationId() {
      organizationReads += 1;
      return ids.organizationId;
    },
    actorUserId: ids.actorUserId,
    integrationId: ids.integrationId,
    idempotencyKey: 'booking-123',
    selection: selection(childAges),
  };

  const authority = materializeHospitalitySupplierReservationPreparationInput(raw);
  childAges[0] = 17;

  assert.equal(organizationReads, 1);
  assert.equal(childReads, 2);
  assert.equal(authority.organizationId, ids.organizationId);
  assert.deepEqual(authority.selection.childAges, [8, 11]);
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.selection));
  assert.ok(Object.isFrozen(authority.selection.childAges));
});

test('submission settlement materializes only the selected result branch', () => {
  let irrelevantReads = 0;
  const authority = materializeHospitalitySupplierReservationSubmissionSettlementInput({
    ...ids,
    outcome: {
      status: 'FAILED',
      failureCode: 'TIMEOUT',
      retryable: true,
      providerCorrelationId: 'corr-1',
      get providerReservationReference() {
        irrelevantReads += 1;
        throw new Error('irrelevant branch getter must not run');
      },
    },
  });

  assert.equal(authority.outcome.status, 'FAILED');
  assert.equal(authority.outcome.retryable, true);
  assert.equal(irrelevantReads, 0);
  assert.ok(Object.isFrozen(authority.outcome));
  assertSanitized(() => materializeHospitalitySupplierReservationSubmissionSettlementInput({
    ...ids,
    outcome: { status: 'FAILED', failureCode: 'TIMEOUT', retryable: 'true' },
  }));
});

test('reconciliation snapshots NOT_FOUND confirmation continuity evidence', () => {
  const authority = materializeHospitalitySupplierReservationReconciliationSettlementInput({
    ...ids,
    outcome: {
      status: 'NOT_FOUND',
      providerReservationReference: 'locator',
      supplierConfirmationReference: 'confirmation',
      providerCorrelationId: 'corr-2',
    },
  });
  assert.equal(authority.outcome.status, 'NOT_FOUND');
  assert.equal(authority.outcome.supplierConfirmationReference, 'confirmation');
});

test('traveler identity and telephone authority are copied before reviewed workflows await', () => {
  const rawTraveler = traveler();
  const authority = materializeHospitalitySupplierReservationReviewAndClaimInput({
    organizationId: ids.organizationId,
    actorUserId: ids.actorUserId,
    reservationId: ids.reservationId,
    traveler: rawTraveler,
  });
  rawTraveler.telephone.subscriberNumber = '11111111';
  rawTraveler.firstName = 'Grace';

  assert.equal(authority.traveler.firstName, 'Ada');
  assert.equal(authority.traveler.telephone.subscriberNumber, '99999999');
  assert.ok(Object.isFrozen(authority.traveler));
  assert.ok(Object.isFrozen(authority.traveler.telephone));

  const acceptance = materializeHospitalitySupplierReservationCommercialReviewAcceptanceInput({
    organizationId: ids.organizationId,
    actorUserId: ids.actorUserId,
    reservationId: ids.reservationId,
    traveler: traveler(),
    acceptPriceChange: true,
    acceptGuaranteeChange: false,
  });
  assert.equal(acceptance.acceptPriceChange, true);

  const accepted = materializeHospitalitySupplierReservationAcceptedReviewInput({
    organizationId: ids.organizationId,
    actorUserId: ids.actorUserId,
    reservationId: ids.reservationId,
    traveler: traveler(),
    expectedAcceptanceFingerprint: 'e'.repeat(64),
  });
  assert.equal(accepted.expectedAcceptanceFingerprint, 'e'.repeat(64));
});

test('throwing accessors and revoked proxies fail through one sanitized boundary', () => {
  assertSanitized(() => materializeHospitalitySupplierReservationReviewAndClaimInput({
    get organizationId() {
      throw new HospitalitySupplierReservationConflictError('caller secret');
    },
    actorUserId: ids.actorUserId,
    reservationId: ids.reservationId,
    traveler: traveler(),
  }));

  const { proxy, revoke } = Proxy.revocable({
    organizationId: ids.organizationId,
    actorUserId: ids.actorUserId,
    integrationId: ids.integrationId,
    idempotencyKey: 'booking-123',
    selection: selection(),
  }, {});
  revoke();
  assertSanitized(() => materializeHospitalitySupplierReservationPreparationInput(proxy));
});
