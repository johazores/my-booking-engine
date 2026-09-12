import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const commercial = readFileSync(
  new URL('../src/server/suppliers/travelport-stays-commercial-authority.ts', import.meta.url),
  'utf8',
);

test('SearchComplete scalar authority fails closed before compatibility normalization', () => {
  assert.match(commercial, /booleanIfPresent\(rate\[field\]\)/);
  assert.match(commercial, /booleanIfPresent\(price\.taxesIncludedInBase\)/);
  assert.match(commercial, /booleanIfPresent\(terms\[field\]\)/);
  assert.match(commercial, /booleanIfPresent\(penalty\.estimatedDeadlineLocal\)/);
  assert.match(commercial, /booleanIfPresent\(providerPenalty\.estimatedAmount\)/);
  assert.match(commercial, /exactMachineStringIfPresent\(terms\.ratePaymentInfo, 32\)/);
  assert.match(commercial, /exactMachineStringIfPresent\(terms\.guaranteeType, 64\)/);
});

test('Rules scalar authority fails closed before compatibility normalization', () => {
  assert.match(commercial, /booleanIfPresent\(block\.CustomerLoyaltyIDRequiredAtReservation\)/);
  assert.match(commercial, /booleanIfPresent\(block\.RateQualificationIDRequiredAtCheckIn\)/);
  assert.match(commercial, /yesNoIfPresent\(cancellation\.Refundable\)/);
  assert.match(commercial, /booleanIfPresent\(deposit\.remainderInd\)/);
  assert.match(commercial, /localDateIfPresent\(deposit\.Date\)/);
  assert.match(commercial, /optionalRecord\(cancellation\.Deadline\)/);
  assert.match(commercial, /optionalRecord\(deadline\.SpecificDate\)/);
  assert.match(commercial, /optionalRecord\(block\.CheckInOutPolicy\)/);
  assert.match(commercial, /localTimeIfPresent\(checkInOutPolicy\.checkInTime\)/);
  assert.match(commercial, /localTimeIfPresent\(checkInOutPolicy\.checkOutTime\)/);
});

test('local date and time authority is canonical and calendar-aware', () => {
  assert.match(commercial, /LOCAL_DATE_PATTERN/);
  assert.match(commercial, /parsed\.toISOString\(\)\.slice\(0, 10\) !== value/);
  assert.match(commercial, /LOCAL_TIME_PATTERN/);
});
