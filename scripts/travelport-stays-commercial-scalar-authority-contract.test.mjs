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
  assert.match(commercial, /enumStringIfPresent\(rate\.priceChangeProbability, SEARCH_PRICE_CHANGE_PROBABILITIES/);
  assert.match(commercial, /enumStringIfPresent\(terms\.ratePaymentInfo, SEARCH_PAYMENT_TIMINGS/);
  assert.match(commercial, /enumStringIfPresent\(terms\.guaranteeType, SEARCH_GUARANTEE_TYPES/);
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
  assert.match(commercial, /enumStringIfPresent\(penalty\.subjectToTax, RULE_SUBJECT_TO_TAX/);
});

test('documented enum allowlists are explicit and dependency-free', () => {
  assert.match(commercial, /SEARCH_PRICE_CHANGE_PROBABILITIES = new Set\(\['High', 'Medium', 'Low'\]\)/);
  assert.match(commercial, /SEARCH_PAYMENT_TIMINGS = new Set\(\['PrePay', 'PostPay', 'Unknown'\]\)/);
  assert.match(commercial, /'GuaranteeRequired',[\s\S]*'NoGuaranteesAccepted',[\s\S]*'DepositRequired',[\s\S]*'PrepayRequired'/);
  assert.match(commercial, /RULE_SUBJECT_TO_TAX = new Set\(\['Yes', 'No', 'Unknown'\]\)/);
});

test('local date and time authority is canonical and calendar-aware', () => {
  assert.match(commercial, /LOCAL_DATE_PATTERN/);
  assert.match(commercial, /parsed\.toISOString\(\)\.slice\(0, 10\) !== value/);
  assert.match(commercial, /LOCAL_TIME_PATTERN/);
});
