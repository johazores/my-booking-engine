import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Travelport production composition keeps operational logging below credential containment', () => {
  const integration = source('src/server/integrations/travelport-stays-integration.ts');

  assert.match(integration, /createTravelportStaysOperationalLogFetch/);
  assert.equal(
    [...integration.matchAll(/createTravelportStaysOAuthCredentialContainmentFetch\(\{[\s\S]*?fetchImpl: operationalFetch,[\s\S]*?\}\);/g)].length,
    2,
  );
  assert.match(
    integration,
    /const operationalFetch = createOperationalFetch\(\{[\s\S]*?organizationId: input\.organizationId,[\s\S]*?integrationId: integration\.id,[\s\S]*?credentialVersion: integration\.credentialVersion,[\s\S]*?environment: normalizedCredentials\.environment,[\s\S]*?fetchImpl: input\.fetchImpl,[\s\S]*?\}\);/,
  );
  assert.match(
    integration,
    /const operationalFetch = createOperationalFetch\(\{[\s\S]*?organizationId,[\s\S]*?integrationId: integration\.id,[\s\S]*?credentialVersion: integration\.credentialVersion,[\s\S]*?environment: normalizedCredentials\.environment,[\s\S]*?fetchImpl: fetch,[\s\S]*?\}\);/,
  );
});

test('Travelport operational record schema excludes request and provider-sensitive payload channels', () => {
  const logger = source('src/server/suppliers/travelport-stays-operational-log-fetch.ts');

  const recordType = logger.match(/export interface StructuredTravelportStaysProviderRequestLogRecord \{([\s\S]*?)\n\}/)?.[1] ?? '';
  for (const forbidden of [
    'authorization',
    'accessGroup',
    'body',
    'headers',
    'locator',
    'pagination',
    'query',
    'url',
    'username',
    'password',
    'clientId',
    'clientSecret',
    'errorMessage',
    'stack',
  ]) {
    assert.equal(recordType.toLowerCase().includes(forbidden.toLowerCase()), false);
  }

  assert.match(logger, /event: 'supplier\.provider-request\.completed'/);
  assert.match(logger, /requestCorrelationId: string/);
  assert.match(logger, /providerCorrelationId: string \| null/);
  assert.match(logger, /failureClass: 'aborted' \| 'transport' \| null/);
  assert.doesNotMatch(logger, /console\.(?:error|warn)\([^)]*error/);
});

test('Travelport transport operation labels preserve Create versus Booking.com Sync semantics', () => {
  const logger = source('src/server/suppliers/travelport-stays-operational-log-fetch.ts');
  const createObservation = source('src/server/suppliers/travelport-stays-reservation-create-observability.ts');
  const syncObservation = source('src/server/suppliers/travelport-stays-reservation-sync-observability.ts');

  assert.match(
    logger,
    /reservationBuild\) return 'reservation\.create'/,
  );
  assert.match(
    logger,
    /reservationCollection\) return 'reservation\.sync'/,
  );
  assert.doesNotMatch(logger, /'reservation\.build'/);
  assert.match(createObservation, /operation: 'reservation\.create'/);
  assert.match(syncObservation, /operation: 'reservation\.sync'/);
});

test('Travelport operational logging documentation records the non-authoritative and secret-free boundary', () => {
  const documentation = source('docs/travelport-stays-operational-logging.md');

  assert.match(documentation, /not product analytics/i);
  assert.match(documentation, /downstream of secret containment/i);
  assert.match(documentation, /never records or serializes/i);
  assert.match(documentation, /bearer tokens/i);
  assert.match(documentation, /request or response bodies/i);
  assert.match(documentation, /pagination tokens or reservation locators/i);
  assert.match(documentation, /do not authorize tenant access/i);
  assert.match(documentation, /reservation\.create/);
  assert.match(documentation, /reservation\.sync/);
  assert.match(documentation, /GitHub Actions are not used/i);
});
