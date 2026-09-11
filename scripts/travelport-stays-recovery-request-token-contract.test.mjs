import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('Travelport known-locator recovery requires exact control-free request authority before provider I/O', () => {
  const adapter = source('src/server/suppliers/travelport-stays-reservation-recovery-provider.ts');

  assert.match(adapter, /const ASCII_CONTROL_CHARACTER_PATTERN = \/\[\\u0000-\\u001f\\u007f\]\/u;/);
  assert.match(adapter, /const normalized = value\.trim\(\);/);
  assert.match(adapter, /normalized !== value/);
  assert.match(adapter, /ASCII_CONTROL_CHARACTER_PATTERN\.test\(normalized\)/);
  assert.doesNotMatch(adapter, /\/\[\\r\\n\]\//);

  const cacheValidation = adapter.indexOf("'Travelport reservation recovery cache key'");
  const locatorValidation = adapter.indexOf("'Provider reservation reference'");
  const correlationValidation = adapter.indexOf("'Request correlation ID'");
  const expectationValidation = adapter.indexOf('normalizeTravelportStaysReservationExpectation(input.expectedReservation)');
  const accessTokenRequest = adapter.indexOf('await this.#accessToken()', expectationValidation);

  assert.ok(cacheValidation >= 0, 'cache key must use the exact bounded string boundary');
  assert.ok(locatorValidation > cacheValidation, 'durable locator must be validated by the same exact boundary');
  assert.ok(correlationValidation > locatorValidation, 'request correlation must be validated by the same exact boundary');
  assert.ok(expectationValidation > correlationValidation, 'reservation expectation must be validated after request authority');
  assert.ok(accessTokenRequest > expectationValidation, 'all recovery authority must be validated before provider I/O');

  assert.match(adapter, /book\/reservations\/\$\{encodeURIComponent\(reference\)\}/);
  assert.match(adapter, /E2ETrackingID: `sf-\$\{requestCorrelationId\}`/);
  assert.match(adapter, /TraceId: requestCorrelationId/);
});

test('Travelport recovery authority documentation keeps reservation activation closed', () => {
  const document = source('docs/travelport-recovery-request-token-authority.md');

  assert.match(document, /provider reservation reference/i);
  assert.match(document, /request correlation/i);
  assert.match(document, /cache key/i);
  assert.match(document, /U\+0000/);
  assert.match(document, /U\+007F/);
  assert.match(document, /before provider I\/O/i);
  assert.match(document, /reservation.*remains.*disabled/is);
  assert.match(document, /PCI-safe FormOfPayment/i);
});
