import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const route = source('app/api/webhooks/stripe/[organization-id]/route.ts');
const reader = source('src/server/payments/stripe-webhook-request-body.ts');
const service = source('src/server/payments/stripe-webhook-service.ts');
const document = source('docs/stripe-webhook-write-scope.md');

test('Stripe webhook route bounds raw ingress before signature verification', () => {
  assert.doesNotMatch(route, /request\.text\(\)/);
  assert.match(route, /readStripeWebhookRequestBody\(request\)/);
  const bodyIndex = route.indexOf('await readStripeWebhookRequestBody(request)');
  const verificationIndex = route.indexOf('await ingestStripePaymentWebhook({');
  const tenantScopeIndex = route.indexOf('verifiedOrganizationId = organizationId;');
  assert.ok(bodyIndex >= 0 && verificationIndex > bodyIndex);
  assert.ok(tenantScopeIndex > verificationIndex);
  assert.match(route, /error instanceof StripeWebhookRequestBodyError/);
  assert.match(route, /error\.code === 'PAYLOAD_TOO_LARGE' \? 413 : 400/);
});

test('Stripe webhook reader enforces declared and actual byte ceilings', () => {
  assert.match(reader, /STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES = 262_144/);
  assert.match(reader, /request\.headers\.get\('content-length'\)/);
  assert.match(reader, /declaredLength > STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES/);
  assert.match(reader, /totalBytes > STRIPE_WEBHOOK_MAX_PAYLOAD_BYTES/);
  assert.match(reader, /reader\.cancel\(\)/);
  assert.match(reader, /request\.signal\.aborted/);
  assert.match(reader, /new TextDecoder\('utf-8', \{ fatal: true \}\)/);
});

test('service retains an independent byte limit for direct callers', () => {
  assert.match(service, /MAX_WEBHOOK_PAYLOAD_BYTES = 262_144/);
  assert.match(service, /Buffer\.byteLength\(input\.payload, 'utf8'\) > MAX_WEBHOOK_PAYLOAD_BYTES/);
});

test('webhook ingress resource policy is documented as fail closed', () => {
  assert.match(document, /256 KiB/);
  assert.match(document, /Content-Length/);
  assert.match(document, /counts every actual byte-stream chunk/);
  assert.match(document, /Request\.text\(\)/);
  assert.match(document, /defense in depth/i);
  assert.match(document, /HTTP 413/);
  assert.match(document, /GitHub Actions are intentionally not used/i);
});
