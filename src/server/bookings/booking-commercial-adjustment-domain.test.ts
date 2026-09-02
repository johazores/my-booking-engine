import assert from 'node:assert/strict';
import test from 'node:test';

import { createHospitalityBookingCommercialAdjustmentPreview } from './booking-commercial-adjustment-domain.ts';

const fingerprintA = 'a'.repeat(64);
const fingerprintB = 'b'.repeat(64);
const selectionFingerprint = 'c'.repeat(64);

function snapshot(input: Partial<{
  currency: string;
  accommodationSubtotalMinor: string;
  taxTotalMinor: string;
  feeTotalMinor: string;
  addonTotalMinor: string;
  totalMinor: string;
  pricingFingerprint: string;
}> = {}) {
  return {
    currency: input.currency ?? 'USD',
    accommodationSubtotalMinor: input.accommodationSubtotalMinor ?? '10000',
    taxTotalMinor: input.taxTotalMinor ?? '1000',
    feeTotalMinor: input.feeTotalMinor ?? '500',
    addonTotalMinor: input.addonTotalMinor ?? '0',
    totalMinor: input.totalMinor ?? '11500',
    pricingFingerprint: input.pricingFingerprint ?? fingerprintA,
  };
}

function preview(before = snapshot(), after = snapshot({ pricingFingerprint: fingerprintB })) {
  return createHospitalityBookingCommercialAdjustmentPreview({
    bookingId: 'booking-1',
    bookingVersion: '2026-09-03T00:00:00.000Z',
    selectionFingerprint,
    before,
    after,
  });
}

test('reports no payment adjustment for exact monetary equality', () => {
  const result = preview();
  assert.equal(result.direction, 'NONE');
  assert.equal(result.deltaMinor, '0');
  assert.equal(result.requiresPaymentAdjustment, false);
  assert.equal(result.canApplyWithoutPaymentAdjustment, true);
  assert.deepEqual(result.componentDeltas, {
    accommodationSubtotalMinor: '0',
    taxTotalMinor: '0',
    feeTotalMinor: '0',
    addonTotalMinor: '0',
  });
});

test('reports an exact additional charge without number conversion', () => {
  const result = preview(snapshot(), snapshot({
    accommodationSubtotalMinor: '12000',
    taxTotalMinor: '1200',
    feeTotalMinor: '500',
    addonTotalMinor: '300',
    totalMinor: '14000',
    pricingFingerprint: fingerprintB,
  }));
  assert.equal(result.direction, 'ADDITIONAL_CHARGE');
  assert.equal(result.deltaMinor, '2500');
  assert.equal(result.componentDeltas.accommodationSubtotalMinor, '2000');
  assert.equal(result.componentDeltas.taxTotalMinor, '200');
  assert.equal(result.componentDeltas.addonTotalMinor, '300');
});

test('reports an exact refund as a signed minor-unit delta', () => {
  const result = preview(snapshot(), snapshot({
    accommodationSubtotalMinor: '8000',
    taxTotalMinor: '800',
    feeTotalMinor: '500',
    addonTotalMinor: '0',
    totalMinor: '9300',
    pricingFingerprint: fingerprintB,
  }));
  assert.equal(result.direction, 'REFUND');
  assert.equal(result.deltaMinor, '-2200');
  assert.equal(result.requiresPaymentAdjustment, true);
});

test('rejects cross-currency comparisons', () => {
  assert.throws(
    () => preview(snapshot(), snapshot({ currency: 'EUR', pricingFingerprint: fingerprintB })),
    /different currencies/,
  );
});

test('fingerprint is deterministic and version-sensitive', () => {
  const first = preview();
  const second = preview();
  assert.equal(first.adjustmentFingerprint, second.adjustmentFingerprint);
  const changedVersion = createHospitalityBookingCommercialAdjustmentPreview({
    bookingId: 'booking-1',
    bookingVersion: '2026-09-03T00:00:01.000Z',
    selectionFingerprint,
    before: snapshot(),
    after: snapshot({ pricingFingerprint: fingerprintB }),
  });
  assert.notEqual(first.adjustmentFingerprint, changedVersion.adjustmentFingerprint);
});

test('canonicalizes minor-unit strings without losing precision', () => {
  const result = preview(
    snapshot({ totalMinor: '00011500' }),
    snapshot({
      accommodationSubtotalMinor: '8999999999998500',
      taxTotalMinor: '1000',
      feeTotalMinor: '500',
      totalMinor: '9000000000000000',
      pricingFingerprint: fingerprintB,
    }),
  );
  assert.equal(result.before.totalMinor, '11500');
  assert.equal(result.after.totalMinor, '9000000000000000');
  assert.equal(result.deltaMinor, '8999999999988500');
});

test('rejects internally inconsistent monetary snapshots', () => {
  assert.throws(
    () => preview(snapshot(), snapshot({ totalMinor: '99999', pricingFingerprint: fingerprintB })),
    /must equal its monetary components/,
  );
});
