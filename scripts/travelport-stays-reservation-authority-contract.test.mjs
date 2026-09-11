import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('reservation authority review stays read-only, bounded, exact-offer scoped, and guarded before compatibility parsing', async () => {
  const provider = await source('src/server/suppliers/travelport-stays-reservation-authority-provider.ts');
  const core = await source('src/server/suppliers/travelport-stays-reservation-authority-provider-core.ts');
  const boundary = await source('src/server/suppliers/travelport-stays-reservation-authority-boundary.ts');

  assert.match(provider, /CoreTravelportStaysReservationAuthorityProvider/);
  assert.match(provider, /assertTravelportStaysPropertyReference\(input\.supplierPropertyReference\)/);
  assert.match(provider, /assertTravelportStaysOfferReference\(input\.supplierOfferReference\)/);
  assert.match(provider, /createTravelportStaysReservationAuthorityResponseFetch/);

  assert.match(core, /MAX_PAGE_COUNT = 5/);
  assert.match(core, /MAX_PAGE_SIZE = 100/);
  assert.match(core, /availability\/catalogofferingshospitality/);
  assert.match(core, /verboseResponseInd: true/);
  assert.match(core, /TVP-Cache-Control': 'no-cache'/);
  assert.match(core, /expectedTermsFingerprint/);
  assert.match(core, /completeForReservationReview/);
  assert.match(core, /authorityFingerprint/);
  assert.match(core, /identifiers\.size !== first\.total/);
  assert.match(core, /matches\.length > 1/);
  assert.doesNotMatch(core, /book\/reservations(?:\/build)?/);
  assert.doesNotMatch(core, /acceptPriceChangeInd|acceptGuaranteeChangeInd/);

  assert.match(boundary, /ASCII_CONTROL_PATTERN/);
  assert.match(boundary, /validateSearchCompleteResponse/);
  assert.match(boundary, /validateAvailabilityResponse/);
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
  assert.doesNotMatch(integration, /reservation-authority-provider-core/);
  assert.doesNotMatch(integration, /capabilities\s*:/);
});

test('documentation keeps create capability closed and records the payment-card boundary', async () => {
  const docs = await source('docs/travelport-stays-integration.md');

  assert.match(docs, /SearchComplete, Rules, and Availability authority/);
  assert.match(docs, /raw card data is no longer accepted/);
  assert.match(docs, /PAN\/CVV/);
  assert.match(docs, /not advertised/);
  assert.match(docs, /locator-less/i);
  assert.match(docs, /non-production/i);
});
