import assert from 'node:assert/strict';
import test from 'node:test';

import { RentalInventoryValidationError } from './rental-domain.ts';
import {
  buildRentalPricingEvidence,
  buildRentalRateQuote,
  normalizeRentalAvailabilitySearchInput,
  RentalAvailabilityIntegrityError,
} from './rental-availability-domain.ts';

test('rental availability search normalizes tenant-local codes and bounded pagination', () => {
  const search = normalizeRentalAvailabilitySearchInput({
    unitTypeCode: ' sedan ',
    locationCode: ' mnl-1 ',
    startsOn: '2026-10-01',
    endsOn: '2026-10-05',
    page: '2',
    pageSize: '40',
  });

  assert.equal(search.unitTypeCode, 'SEDAN');
  assert.equal(search.locationCode, 'MNL-1');
  assert.equal(search.days, 4);
  assert.equal(search.page, 2);
  assert.equal(search.pageSize, 40);
});

test('rental availability search rejects excessive ranges and invalid pagination', () => {
  assert.throws(
    () => normalizeRentalAvailabilitySearchInput({
      unitTypeCode: 'SEDAN',
      startsOn: '2026-01-01',
      endsOn: '2026-04-02',
    }),
    RentalInventoryValidationError,
  );
  assert.throws(
    () => normalizeRentalAvailabilitySearchInput({
      unitTypeCode: 'SEDAN',
      startsOn: '2026-10-01',
      endsOn: '2026-10-02',
      pageSize: '101',
    }),
    RentalInventoryValidationError,
  );
});

test('rental rate quote applies half-open overrides using integer minor units', () => {
  const quote = buildRentalRateQuote({
    startsOn: new Date('2026-10-01T00:00:00.000Z'),
    endsOn: new Date('2026-10-05T00:00:00.000Z'),
    defaultDailyRateMinor: 100,
    ratePeriods: [{
      startsOn: new Date('2026-10-02T00:00:00.000Z'),
      endsOn: new Date('2026-10-04T00:00:00.000Z'),
      dailyRateMinor: 150,
    }],
  });

  assert.equal(quote.days, 4);
  assert.equal(quote.totalMinor, 500);
  assert.deepEqual(quote.segments, [
    { startsOn: '2026-10-01', endsOn: '2026-10-02', dailyRateMinor: 100, source: 'default' },
    { startsOn: '2026-10-02', endsOn: '2026-10-04', dailyRateMinor: 150, source: 'override' },
    { startsOn: '2026-10-04', endsOn: '2026-10-05', dailyRateMinor: 100, source: 'default' },
  ]);
});

test('rental pricing evidence is deterministic and changes with authoritative rate evidence', () => {
  const input = {
    unitTypeId: '4f45b570-b1c2-46f9-86d5-c2e26cf0b582',
    currency: 'php',
    startsOn: new Date('2026-10-01T00:00:00.000Z'),
    endsOn: new Date('2026-10-05T00:00:00.000Z'),
    defaultDailyRateMinor: 100,
    ratePeriods: [{
      startsOn: new Date('2026-10-02T00:00:00.000Z'),
      endsOn: new Date('2026-10-04T00:00:00.000Z'),
      dailyRateMinor: 150,
    }],
  } as const;

  const first = buildRentalPricingEvidence(input);
  const retry = buildRentalPricingEvidence(input);
  const changed = buildRentalPricingEvidence({
    ...input,
    ratePeriods: [{
      startsOn: new Date('2026-10-02T00:00:00.000Z'),
      endsOn: new Date('2026-10-04T00:00:00.000Z'),
      dailyRateMinor: 175,
    }],
  });

  assert.equal(first.currency, 'PHP');
  assert.equal(first.totalMinor, 500);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(first.fingerprint, retry.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.equal(first.snapshot.totalMinor, 500);
  assert.equal(changed.snapshot.totalMinor, 550);
});

test('rental rate quote fails closed for overlapping or unsafe persisted pricing', () => {
  assert.throws(
    () => buildRentalRateQuote({
      startsOn: new Date('2026-10-01T00:00:00.000Z'),
      endsOn: new Date('2026-10-05T00:00:00.000Z'),
      defaultDailyRateMinor: 100,
      ratePeriods: [
        { startsOn: new Date('2026-10-01T00:00:00.000Z'), endsOn: new Date('2026-10-04T00:00:00.000Z'), dailyRateMinor: 120 },
        { startsOn: new Date('2026-10-03T00:00:00.000Z'), endsOn: new Date('2026-10-05T00:00:00.000Z'), dailyRateMinor: 140 },
      ],
    }),
    RentalAvailabilityIntegrityError,
  );
  assert.throws(
    () => buildRentalRateQuote({
      startsOn: new Date('2026-10-01T00:00:00.000Z'),
      endsOn: new Date('2026-10-02T00:00:00.000Z'),
      defaultDailyRateMinor: Number.NaN,
      ratePeriods: [],
    }),
    RentalAvailabilityIntegrityError,
  );
  assert.throws(
    () => buildRentalPricingEvidence({
      unitTypeId: '',
      currency: 'PHP',
      startsOn: new Date('2026-10-01T00:00:00.000Z'),
      endsOn: new Date('2026-10-02T00:00:00.000Z'),
      defaultDailyRateMinor: 100,
      ratePeriods: [],
    }),
    RentalAvailabilityIntegrityError,
  );
});
