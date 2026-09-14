import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RentalInventoryValidationError,
  assertRentalArchiveConfirmation,
  assertRentalRemoveConfirmation,
  normalizeRentalAvailabilityBlockInput,
  normalizeRentalLocationInput,
  normalizeRentalRatePeriodInput,
  normalizeRentalUnitInput,
  normalizeRentalUnitTypeInput,
} from '../src/server/inventory/rental-domain.ts';

test('normalizes unit type pricing and identifiers', () => {
  assert.deepEqual(normalizeRentalUnitTypeInput({
    name: '  City Bike ',
    code: ' city-bike ',
    description: '  Step-through frame ',
    currency: ' php ',
    defaultDailyRateMinor: '125000',
  }), {
    name: 'City Bike',
    code: 'CITY-BIKE',
    description: 'Step-through frame',
    currency: 'PHP',
    defaultDailyRateMinor: 125000,
  });
});

test('normalizes rental locations and validates country and timezone authority', () => {
  assert.deepEqual(normalizeRentalLocationInput({
    name: '  Makati Hub ',
    code: ' makati-hub ',
    addressLine1: '  123 Ayala Avenue ',
    addressLine2: '',
    city: ' Makati ',
    region: ' NCR ',
    postalCode: ' 1200 ',
    countryCode: ' ph ',
    timeZone: ' Asia/Manila ',
  }), {
    name: 'Makati Hub',
    code: 'MAKATI-HUB',
    addressLine1: '123 Ayala Avenue',
    addressLine2: null,
    city: 'Makati',
    region: 'NCR',
    postalCode: '1200',
    countryCode: 'PH',
    timeZone: 'Asia/Manila',
  });
  assert.throws(() => normalizeRentalLocationInput({
    name: 'Bad country',
    code: 'BAD-COUNTRY',
    addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '',
    countryCode: 'PHL',
    timeZone: 'Asia/Manila',
  }), RentalInventoryValidationError);
  assert.throws(() => normalizeRentalLocationInput({
    name: 'Bad timezone',
    code: 'BAD-TZ',
    addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '',
    countryCode: 'PH',
    timeZone: 'Not/A-Timezone',
  }), RentalInventoryValidationError);
});

test('new rental units require a canonical location code', () => {
  assert.deepEqual(normalizeRentalUnitInput({
    unitTypeId: ' type-id ',
    locationCode: ' makati-hub ',
    name: ' Bike 12 ',
    code: ' bike-12 ',
    description: '',
  }), {
    unitTypeId: 'type-id',
    locationCode: 'MAKATI-HUB',
    name: 'Bike 12',
    code: 'BIKE-12',
    description: null,
  });
  assert.throws(() => normalizeRentalUnitInput({
    unitTypeId: 'type-id',
    locationCode: '',
    name: 'Bike 13',
    code: 'BIKE-13',
  }), RentalInventoryValidationError);
});

test('uses valid half-open date ranges and rejects invalid calendar values', () => {
  const block = normalizeRentalAvailabilityBlockInput({
    unitId: 'unit-id',
    startsOn: '2026-10-01',
    endsOn: '2026-10-04',
    reason: 'Service',
  });
  assert.equal(block.startsOn.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(block.endsOn.toISOString(), '2026-10-04T00:00:00.000Z');
  assert.throws(() => normalizeRentalAvailabilityBlockInput({
    unitId: 'unit-id',
    startsOn: '2026-02-30',
    endsOn: '2026-03-01',
  }), RentalInventoryValidationError);
  assert.throws(() => normalizeRentalRatePeriodInput({
    unitTypeId: 'type-id',
    startsOn: '2026-10-04',
    endsOn: '2026-10-04',
    dailyRateMinor: 100,
  }), RentalInventoryValidationError);
});

test('requires positive safe minor-unit pricing', () => {
  assert.throws(() => normalizeRentalRatePeriodInput({
    unitTypeId: 'type-id',
    startsOn: '2026-10-01',
    endsOn: '2026-10-02',
    dailyRateMinor: '0',
  }), RentalInventoryValidationError);
});

test('requires explicit destructive confirmations', () => {
  assert.doesNotThrow(() => assertRentalArchiveConfirmation('archive'));
  assert.doesNotThrow(() => assertRentalRemoveConfirmation('REMOVE'));
  assert.throws(() => assertRentalArchiveConfirmation('yes'), RentalInventoryValidationError);
  assert.throws(() => assertRentalRemoveConfirmation('delete'), RentalInventoryValidationError);
});
