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
  assert.match(executor, /assertPaymentAuthorityMatchesRequestMaterial/);
  assert.match(executor, /moneyMinorToMajorString/);
  assert.match(executor, /assertExpectedReservation/);
  assert.match(executor, /SeriesCode/);
  assert.doesNotMatch(executor, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
  assert.doesNotMatch(executor, /\bdb\.|auditEvent|console\.|logger\.|structuredLog/i);
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
