import assert from 'node:assert/strict';
import test from 'node:test';

import { HospitalitySupplierProviderError } from './hospitality-supplier-provider.ts';
import {
  materializeTravelportStaysOfferRevalidationInput,
  materializeTravelportStaysOfferSearchInput,
  materializeTravelportStaysReservationAuthorityInput,
  materializeTravelportStaysSearchPageInput,
} from './travelport-stays-input-materialization.ts';

const propertyReference = 'property-reference';
const offerReference = 'offer-reference';
const fingerprint = 'a'.repeat(64);
const termsFingerprint = 'b'.repeat(64);

function trackedInput() {
  const reads = new Map<string, number>();
  const childAges = [7, 12];
  const values = {
    supplierPropertyReference: propertyReference,
    checkInDateLocal: '2026-10-01',
    checkOutDateLocal: '2026-10-03',
    rooms: 1,
    adults: 2,
    childAges,
    currency: 'AUD',
    supplierOfferReference: offerReference,
    expectedTotalMinor: 12345n,
    expectedOfferFingerprint: fingerprint,
    expectedTermsFingerprint: termsFingerprint,
  } as const;

  const input = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(input, key, {
      enumerable: true,
      get() {
        reads.set(key, (reads.get(key) ?? 0) + 1);
        return value;
      },
    });
  }

  return { input, reads, childAges };
}

function assertOneRead(reads: Map<string, number>, keys: readonly string[]) {
  for (const key of keys) assert.equal(reads.get(key), 1, `${key} should be read exactly once`);
}

test('offer revalidation input is copied once into an immutable allowlisted snapshot', () => {
  const { input, reads, childAges } = trackedInput();
  const snapshot = materializeTravelportStaysOfferRevalidationInput(input as never);

  assertOneRead(reads, [
    'supplierPropertyReference',
    'checkInDateLocal',
    'checkOutDateLocal',
    'rooms',
    'adults',
    'childAges',
    'currency',
    'supplierOfferReference',
    'expectedTotalMinor',
    'expectedOfferFingerprint',
  ]);
  assert.equal(reads.get('expectedTermsFingerprint'), undefined);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.childAges));
  assert.deepEqual(snapshot.childAges, [7, 12]);

  childAges[0] = 17;
  assert.deepEqual(snapshot.childAges, [7, 12]);
});

test('reservation authority input materializes terms authority in the same snapshot', () => {
  const { input, reads } = trackedInput();
  const snapshot = materializeTravelportStaysReservationAuthorityInput(input as never);

  assertOneRead(reads, [
    'supplierPropertyReference',
    'checkInDateLocal',
    'checkOutDateLocal',
    'rooms',
    'adults',
    'childAges',
    'currency',
    'supplierOfferReference',
    'expectedTotalMinor',
    'expectedOfferFingerprint',
    'expectedTermsFingerprint',
  ]);
  assert.equal(snapshot.expectedTermsFingerprint, termsFingerprint);
  assert.ok(Object.isFrozen(snapshot));
});

test('offer search and pagination inputs are materialized before adapter validation', () => {
  let propertyReads = 0;
  const search = materializeTravelportStaysOfferSearchInput({
    get supplierPropertyReference() {
      propertyReads += 1;
      return propertyReference;
    },
    checkInDateLocal: '2026-10-01',
    checkOutDateLocal: '2026-10-03',
    rooms: 1,
    adults: 2,
    currency: 'AUD',
  });
  assert.equal(propertyReads, 1);
  assert.equal(search.supplierPropertyReference, propertyReference);
  assert.ok(Object.isFrozen(search));

  let tokenReads = 0;
  const page = materializeTravelportStaysSearchPageInput({
    get pageToken() {
      tokenReads += 1;
      return 'page-token';
    },
    pageNumber: 2,
  });
  assert.equal(tokenReads, 1);
  assert.deepEqual(page, { pageToken: 'page-token', pageNumber: 2 });
  assert.ok(Object.isFrozen(page));
});

test('throwing and revoked caller-owned inputs fail closed as INVALID_REQUEST', () => {
  const throwing = {
    get supplierPropertyReference(): string {
      throw new Error('caller secret should not escape');
    },
  };

  assert.throws(
    () => materializeTravelportStaysOfferSearchInput(throwing as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST'
      && !error.message.includes('caller secret'),
  );

  const target = {
    supplierPropertyReference: propertyReference,
    checkInDateLocal: '2026-10-01',
    checkOutDateLocal: '2026-10-03',
    rooms: 1,
    adults: 1,
    currency: 'AUD',
  };
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  assert.throws(
    () => materializeTravelportStaysOfferSearchInput(proxy as never),
    (error: unknown) => error instanceof HospitalitySupplierProviderError
      && error.code === 'INVALID_REQUEST',
  );
});

test('child-age authority rejects non-arrays and oversized arrays before copying', () => {
  const base = {
    supplierPropertyReference: propertyReference,
    checkInDateLocal: '2026-10-01',
    checkOutDateLocal: '2026-10-03',
    rooms: 1,
    adults: 1,
    currency: 'AUD',
  };

  for (const childAges of [{ 0: 8, length: 1 }, new Array(9).fill(8)]) {
    assert.throws(
      () => materializeTravelportStaysOfferSearchInput({ ...base, childAges } as never),
      (error: unknown) => error instanceof HospitalitySupplierProviderError
        && error.code === 'INVALID_REQUEST',
    );
  }
});
