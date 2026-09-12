import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  materializeHospitalitySupplierReservationReconciliationInput,
  materializeHospitalitySupplierReservationRecoveryProvider,
  materializeHospitalitySupplierReservationRecoveryResult,
} from './hospitality-supplier-reservation-reconciliation-authority.ts';

function fixedFailure(code: 'INVALID_REQUEST' | 'INVALID_RESPONSE', message: string, forbidden?: string) {
  return (error: unknown) => error instanceof HospitalitySupplierProviderError
    && error.code === code
    && error.message === message
    && (!forbidden || !error.message.includes(forbidden));
}

test('reconciliation input is a one-read frozen allowlist with sanitized accessor failures', () => {
  let organizationReads = 0;
  const provider = {
    code: 'travelport-stays',
    async retrieveReservation() {
      return { status: 'NOT_FOUND' as const, providerReservationReference: 'ABC123', providerCorrelationId: null };
    },
  };
  const input = {
    get organizationId() {
      organizationReads += 1;
      return 'organization-a';
    },
    actorUserId: 'actor-a',
    reservationId: 'reservation-a',
    provider,
    ignored: 'not-authority',
  };

  const snapshot = materializeHospitalitySupplierReservationReconciliationInput(input);
  assert.equal(organizationReads, 1);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(Object.keys(snapshot).sort(), ['actorUserId', 'organizationId', 'provider', 'reservationId']);
  assert.equal(snapshot.organizationId, 'organization-a');
  assert.equal(snapshot.provider, provider);

  const hostile = {
    get organizationId() {
      throw new Error('caller secret');
    },
    actorUserId: 'actor-a',
    reservationId: 'reservation-a',
    provider,
  };
  assert.throws(
    () => materializeHospitalitySupplierReservationReconciliationInput(hostile),
    fixedFailure(
      'INVALID_REQUEST',
      'Supplier reservation reconciliation input authority could not be materialized safely.',
      'caller secret',
    ),
  );
});

test('recovery provider capability is snapshotted once, bounded, and preserves its receiver', async () => {
  let codeReads = 0;
  let methodReads = 0;
  let confirmationReads = 0;
  const provider = {
    marker: 'original',
    get code() {
      codeReads += 1;
      return 'travelport-stays';
    },
    get requiresSupplierConfirmationForFound() {
      confirmationReads += 1;
      return true;
    },
    get retrieveReservation() {
      methodReads += 1;
      return async function (this: { marker: string }) {
        assert.equal(this.marker, 'original');
        return {
          status: 'FOUND' as const,
          providerReservationReference: 'ABC123',
          supplierConfirmationReference: 'SUP123',
          providerCorrelationId: null,
        };
      };
    },
  };

  const snapshot = materializeHospitalitySupplierReservationRecoveryProvider(provider);
  assert.equal(codeReads, 1);
  assert.equal(methodReads, 1);
  assert.equal(confirmationReads, 1);
  assert.equal(Object.isFrozen(snapshot), true);
  Object.defineProperty(provider, 'code', { value: 'mutated-provider' });
  assert.equal(snapshot.code, 'travelport-stays');
  const result = await snapshot.retrieveReservation({
    providerReservationReference: 'ABC123',
    requestCorrelationId: 'request-1',
    expectedReservation: {
      supplierPropertyReference: 'P1',
      arrivalDateLocal: '2026-10-01',
      departureDateLocal: '2026-10-02',
      rooms: 1,
      adults: 1,
      childAges: [],
    },
  });
  assert.equal(result.status, 'FOUND');

  for (const code of ['', ' travelport-stays', 'travelport-stays\n', 'x'.repeat(65)]) {
    assert.throws(
      () => materializeHospitalitySupplierReservationRecoveryProvider({
        code,
        async retrieveReservation() {
          return { status: 'NOT_FOUND' as const, providerReservationReference: 'ABC123', providerCorrelationId: null };
        },
      }),
      fixedFailure(
        'INVALID_REQUEST',
        'Supplier reservation recovery provider authority could not be materialized safely.',
      ),
    );
  }
});

test('recovery provider capability sanitizes hostile getters', () => {
  const provider = {
    code: 'travelport-stays',
    get retrieveReservation(): never {
      throw new Error('provider capability secret');
    },
  };
  assert.throws(
    () => materializeHospitalitySupplierReservationRecoveryProvider(provider as never),
    fixedFailure(
      'INVALID_REQUEST',
      'Supplier reservation recovery provider authority could not be materialized safely.',
      'provider capability secret',
    ),
  );
});

test('recovery result is a one-read frozen semantic allowlist and cannot mutate after validation', () => {
  const reads = new Map<string, number>();
  const values: Record<string, unknown> = {
    status: 'FOUND',
    providerReservationReference: 'ABC123',
    supplierConfirmationReference: 'SUP123',
    providerCorrelationId: 'CORR123',
  };
  const once = (name: string) => ({
    enumerable: true,
    get() {
      reads.set(name, (reads.get(name) ?? 0) + 1);
      return values[name];
    },
  });
  const raw = Object.defineProperties({ secretMetadata: 'discard-me' }, {
    status: once('status'),
    providerReservationReference: once('providerReservationReference'),
    supplierConfirmationReference: once('supplierConfirmationReference'),
    providerCorrelationId: once('providerCorrelationId'),
  });

  const snapshot = materializeHospitalitySupplierReservationRecoveryResult(raw as never);
  assert.deepEqual(Object.fromEntries(reads), {
    status: 1,
    providerReservationReference: 1,
    supplierConfirmationReference: 1,
    providerCorrelationId: 1,
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['providerCorrelationId', 'providerReservationReference', 'status', 'supplierConfirmationReference'],
  );
  values.providerReservationReference = 'MUTATED';
  values.status = 'NOT_FOUND';
  assert.equal(snapshot.providerReservationReference, 'ABC123');
  assert.equal(snapshot.status, 'FOUND');
});

test('recovery result rejects malformed status and operational references before settlement', () => {
  const invalidResults = [
    { status: 'UNKNOWN', providerReservationReference: 'ABC123', supplierConfirmationReference: null, providerCorrelationId: null },
    { status: 'FOUND', providerReservationReference: '', supplierConfirmationReference: null, providerCorrelationId: null },
    { status: 'FOUND', providerReservationReference: ' ABC123', supplierConfirmationReference: null, providerCorrelationId: null },
    { status: 'FOUND', providerReservationReference: 'ABC123', supplierConfirmationReference: ' SUP123', providerCorrelationId: null },
    { status: 'FOUND', providerReservationReference: 'ABC123', supplierConfirmationReference: null, providerCorrelationId: 'corr\n1' },
    { status: 'NOT_FOUND', providerReservationReference: 'ABC123', supplierConfirmationReference: ' '.repeat(2), providerCorrelationId: null },
    { status: 'NOT_FOUND', providerReservationReference: 'x'.repeat(513), providerCorrelationId: null },
    { status: 'NOT_FOUND', providerReservationReference: 'ABC123', providerCorrelationId: undefined },
  ];

  for (const value of invalidResults) {
    assert.throws(
      () => materializeHospitalitySupplierReservationRecoveryResult(value as never),
      fixedFailure(
        'INVALID_RESPONSE',
        'Supplier reservation recovery result authority could not be materialized safely.',
      ),
    );
  }
});

test('not-found recovery preserves only bounded contradictory confirmation evidence for continuity checks', () => {
  const snapshot = materializeHospitalitySupplierReservationRecoveryResult({
    status: 'NOT_FOUND',
    providerReservationReference: 'ABC123',
    providerCorrelationId: 'CORR123',
    supplierConfirmationReference: 'SUP123',
  } as never) as unknown as Readonly<{ supplierConfirmationReference?: unknown }>;

  assert.equal(snapshot.supplierConfirmationReference, 'SUP123');
  assert.equal(Object.isFrozen(snapshot), true);
});

test('recovery result sanitizes throwing and revoked provider-owned evidence', () => {
  const hostile = {
    status: 'FOUND',
    get providerReservationReference(): never {
      throw new Error('provider response secret');
    },
    supplierConfirmationReference: 'SUP123',
    providerCorrelationId: null,
  };
  assert.throws(
    () => materializeHospitalitySupplierReservationRecoveryResult(hostile as never),
    fixedFailure(
      'INVALID_RESPONSE',
      'Supplier reservation recovery result authority could not be materialized safely.',
      'provider response secret',
    ),
  );

  const revocable = Proxy.revocable({
    status: 'NOT_FOUND' as const,
    providerReservationReference: 'ABC123',
    providerCorrelationId: null,
  }, {});
  revocable.revoke();
  assert.throws(
    () => materializeHospitalitySupplierReservationRecoveryResult(revocable.proxy),
    fixedFailure(
      'INVALID_RESPONSE',
      'Supplier reservation recovery result authority could not be materialized safely.',
    ),
  );
});
