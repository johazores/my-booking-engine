import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Travelport create executor keeps sensitive card material inside the server adapter boundary', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  assert.match(executor, /book\/reservations\/build/);
  assert.match(executor, /FormOfPaymentPaymentCard/);
  assert.match(executor, /PaymentCardDetail/);
  assert.match(executor, /acceptedPaymentCardCodes\.includes\(cardCode\)/);
  assert.match(executor, /input\.cardType !== 'Credit'/);
  assert.match(executor, /assertPaymentAuthorityMatchesRequestMaterial/);
  assert.match(executor, /moneyMinorToMajorString/);
  assert.match(executor, /assertExpectedReservation/);
  assert.match(executor, /SeriesCode/);
  assert.match(executor, /AddressDetail/);
  assert.match(executor, /TelephoneDetail/);
  assert.match(executor, /\\d\{8,19\}/);
  assert.match(executor, /validThroughDateLocal: input\.expectedReservation\.departureDateLocal/);
  assert.match(executor, /createReservationAfterAcceptedReview/);
  assert.match(executor, /acceptPriceChangeInd/);
  assert.match(executor, /acceptGuaranteeChangeInd/);
  assert.doesNotMatch(executor, /\bdb\.|auditEvent|console\.|logger\.|structuredLog/i);
});

test('Travelport initial create cannot inherit accepted-review flags', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const initialStart = executor.indexOf('async createReservation(input:');
  const reviewedStart = executor.indexOf('async createReservationAfterAcceptedReview', initialStart);
  assert.ok(initialStart >= 0 && reviewedStart > initialStart);
  const initial = executor.slice(initialStart, reviewedStart);
  assert.match(initial, /#createReservation\(input, null\)/);
  assert.doesNotMatch(initial, /acceptedReview|acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('Travelport create validates optional billing and payment-phone details before the provider marker', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const normalizeIndex = executor.indexOf('const address = normalizeBillingAddress(input.billingAddress)');
  const requestIndex = executor.indexOf('const requestBody = buildTravelportStaysReservationCreateRequest');
  const tokenIndex = executor.indexOf('const accessToken = await this.#accessToken()');
  const markerIndex = executor.indexOf('await input.beforeProviderRequest()');
  assert.ok(normalizeIndex >= 0 && requestIndex > normalizeIndex && tokenIndex > requestIndex && markerIndex > tokenIndex);
  assert.match(executor, /MAX_CARD_CODE_LENGTH = 2/);
  assert.match(executor, /expires before the reservation stay is complete/);
  assert.match(executor, /billing country code/);
  assert.match(executor, /payment card telephone/);
});

test('OAuth and request composition finish before the durable marker, and provider I/O starts only after it', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const requestIndex = executor.indexOf('const requestBody = buildTravelportStaysReservationCreateRequest');
  const tokenIndex = executor.indexOf('const accessToken = await this.#accessToken()');
  const markerIndex = executor.indexOf('await input.beforeProviderRequest()');
  const fetchIndex = executor.indexOf('response = await this.#fetchImpl', markerIndex);
  assert.ok(requestIndex >= 0 && tokenIndex > requestIndex && markerIndex > tokenIndex && fetchIndex > markerIndex);
  assert.match(executor, /status: 'AMBIGUOUS'/);
  assert.match(executor, /failureCode: 'INVALID_RESPONSE'/);
});

test('Travelport sensitive form-of-payment documentation stays server-only and fail-closed', () => {
  const readiness = source('docs/supplier-reservation-create-readiness.md');
  const coordinator = source('docs/travelport-reservation-create-coordinator.md');
  for (const doc of [readiness, coordinator]) {
    assert.match(doc, /PCI/i);
    assert.match(doc, /reservation.*disabled/i);
    assert.match(doc, /billing address|billing-address/i);
    assert.match(doc, /telephone/i);
    assert.match(doc, /not.*(?:collection|browser|route|API)|no route/i);
  }
  assert.match(readiness, /one-to-two-character provider card code/i);
  assert.match(readiness, /departure date/i);
  assert.match(coordinator, /only `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `TIMEOUT`/);
  assert.doesNotMatch(readiness, /acceptPriceChangeInd=true|acceptGuaranteeChangeInd=true/);
});

test('integration constructs the executor without advertising reservation capability', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');
  const provider = source('src/server/suppliers/travelport-stays-provider.ts');
  const docs = source('docs/supplier-reservation-create-readiness.md');
  assert.match(integration, /TravelportStaysReservationCreateExecutor/);
  assert.match(integration, /reservationCreateExecutor/);
  assert.match(integration, /fetchImpl/);
  assert.match(provider, /capabilities: Object\.freeze\(\['availability', 'hotel-search', 'pricing'\]/);
  assert.doesNotMatch(provider, /capabilities: Object\.freeze\([^\n]*'reservation'/);
  assert.match(docs, /capability remains disabled/i);
  assert.match(docs, /PCI/i);
});
