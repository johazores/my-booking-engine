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
  assert.match(executor, /acquirePaymentCard: \(\) => Promise<TravelportStaysSensitiveReservationPaymentCard>/);
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
  const commonStart = executor.indexOf('async #createReservation');
  const tokenIndex = executor.indexOf('const accessToken = await this.#accessToken()', commonStart);
  const sourceIndex = executor.indexOf('const paymentCard = await input.acquirePaymentCard()', tokenIndex);
  const requestIndex = executor.indexOf('const requestBody = buildTravelportStaysReservationCreateRequest', sourceIndex);
  const markerIndex = executor.indexOf('await input.beforeProviderRequest()', requestIndex);
  assert.ok(commonStart >= 0 && tokenIndex > commonStart && sourceIndex > tokenIndex && requestIndex > sourceIndex && markerIndex > requestIndex);
  assert.match(executor, /const address = normalizeBillingAddress\(input\.billingAddress\)/);
  assert.match(executor, /const telephone = normalizePaymentTelephone\(input\.telephone\)/);
  assert.match(executor, /MAX_CARD_CODE_LENGTH = 2/);
  assert.match(executor, /expires before the reservation stay is complete/);
  assert.match(executor, /billing country code/);
  assert.match(executor, /payment card telephone/);
});

test('OAuth finishes before sensitive acquisition, and provider I/O starts only after durable marking', () => {
  const executor = source('src/server/suppliers/travelport-stays-reservation-create-executor.ts');
  const commonStart = executor.indexOf('async #createReservation');
  const authorityIndex = executor.indexOf('assertPaymentAuthorityMatchesRequestMaterial(input.requestMaterial, input.paymentAuthority)', commonStart);
  const urlIndex = executor.indexOf('const reservationUrl = reviewedReservationBuildUrl', authorityIndex);
  const tokenIndex = executor.indexOf('const accessToken = await this.#accessToken()', urlIndex);
  const sourceIndex = executor.indexOf('const paymentCard = await input.acquirePaymentCard()', tokenIndex);
  const requestIndex = executor.indexOf('const requestBody = buildTravelportStaysReservationCreateRequest', sourceIndex);
  const markerIndex = executor.indexOf('await input.beforeProviderRequest()', requestIndex);
  const fetchIndex = executor.indexOf('response = await this.#fetchImpl', markerIndex);
  assert.ok(
    commonStart >= 0
      && authorityIndex > commonStart
      && urlIndex > authorityIndex
      && tokenIndex > urlIndex
      && sourceIndex > tokenIndex
      && requestIndex > sourceIndex
      && markerIndex > requestIndex
      && fetchIndex > markerIndex,
  );
  assert.match(executor, /Do not acquire PAN\/CVV until provider authentication has succeeded/);
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
    assert.match(doc, /OAuth[\s\S]{0,300}(?:before|prior to)[\s\S]{0,300}(?:payment-card source|form-of-payment|PAN|CVV)/i);
  }
  assert.match(readiness, /one-to-two-character provider card code/i);
  assert.match(readiness, /departure date/i);
  assert.match(coordinator, /only `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `TIMEOUT`/i);
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
