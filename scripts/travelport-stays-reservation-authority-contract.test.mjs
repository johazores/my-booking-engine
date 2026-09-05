import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('reservation authority review stays read-only, bounded, and exact-offer scoped', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');

  assert.match(provider, /MAX_PAGE_COUNT = 5/);
  assert.match(provider, /MAX_PAGE_SIZE = 100/);
  assert.match(provider, /availability\/catalogofferingshospitality/);
  assert.match(provider, /verboseResponseInd: true/);
  assert.match(provider, /TVP-Cache-Control': 'no-cache'/);
  assert.match(provider, /expectedTermsFingerprint/);
  assert.match(provider, /completeForReservationReview/);
  assert.match(provider, /authorityFingerprint/);
  assert.match(provider, /identifiers\.size !== first\.total/);
  assert.match(provider, /matches\.length > 1/);
  assert.doesNotMatch(provider, /book\/reservations(?:\/build)?/);
  assert.doesNotMatch(provider, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);
});

test('reservation authority credentials load only after tenant product permissions', async () => {
  const service = await source('src/server/suppliers/hospitality-supplier-reservation-authority-service.ts');
  const loadIndex = service.indexOf('await loadTravelportStaysIntegration');
  assert.ok(loadIndex > 0);

  for (const permission of ['availability:read', 'pricing:read', 'booking:manage']) {
    const permissionIndex = service.indexOf(`permission: '${permission}'`);
    assert.ok(permissionIndex >= 0 && permissionIndex < loadIndex, `${permission} must be checked before credentials load`);
  }
  assert.match(service, /assertUuidIdentifier\(input\.organizationId/);
  assert.match(service, /assertUuidIdentifier\(input\.actorUserId/);
});

test('Travelport integration exposes review authority only as a server-side adapter', async () => {
  const integration = await source('src/server/integrations/travelport-stays-integration.ts');

  assert.match(integration, /TravelportStaysReservationAuthorityProvider/);
  assert.match(integration, /reservationAuthorityProvider:/);
  assert.match(integration, /bookingTermsProvider,/);
  assert.doesNotMatch(integration, /capabilities\s*:/);
});

test('documentation keeps create capability closed and records the payment-card boundary', async () => {
  const docs = await source('docs/travelport-stays-integration.md');

  assert.match(docs, /Availability authority bridge/);
  assert.match(docs, /never accepts raw card data/);
  assert.match(docs, /PlainText/);
  assert.match(docs, /reservation.*not advertised/i);
  assert.match(docs, /locator-less/i);
  assert.match(docs, /non-production/i);
});
