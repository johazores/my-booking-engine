import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(new URL('../src/server/payments/stripe-webhook-service.ts', import.meta.url), 'utf8');
const domain = readFileSync(new URL('../src/server/payments/stripe-webhook-payment-mutation-domain.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/stripe-webhook-payment-attempt-authority.md', import.meta.url), 'utf8');

test('generic PaymentIntent webhook resolves exact provider ownership before pending claims', () => {
  const exactIndex = service.indexOf('const exactCandidates = await transaction.paymentTransaction.findMany({');
  const pendingIndex = service.indexOf('const pendingCandidates = exactCandidates.length === 0');
  const decisionIndex = service.indexOf('decideStripeWebhookPaymentMutation({');
  assert.ok(exactIndex >= 0, 'exact provider-reference lookup must exist');
  assert.ok(pendingIndex > exactIndex, 'pending claim lookup must follow exact provider identity');
  assert.ok(decisionIndex > pendingIndex, 'payment mutation decision must consume both authority sets');
  assert.match(service, /providerReference:\s*event\.paymentIntent\.providerReference,[\s\S]*kind:\s*\{ in: \['AUTHORIZATION', 'CAPTURE'\] \}/);
});

test('generic pending fallback excludes specialized commercial-amendment operations', () => {
  assert.match(service, /const pendingCandidates = exactCandidates\.length === 0[\s\S]*commercialAmendmentId:\s*null,[\s\S]*status:\s*'PENDING'/);
  assert.match(domain, /selected\.commercialAmendmentId !== null \|\| selected\.status === 'AMBIGUOUS'/);
  assert.match(domain, /payment-specialized-flow-owned/);
});

test('failed exact attempts can only recover from positive provider truth and writes retain prior lifecycle', () => {
  assert.match(domain, /selected\.status === 'FAILED'[\s\S]*input\.providerStatus !== 'succeeded'[\s\S]*input\.providerStatus !== 'requires_capture'/);
  assert.match(domain, /payment-failure-already-recorded/);
  assert.match(domain, /payment-already-settled/);
  assert.match(service, /status:\s*payment\.status,[\s\S]*providerReference:\s*current\.providerReference/);
  assert.match(service, /payment-failed-attempt-recovered/);
});

test('documentation records order-independent provider-reference authority', () => {
  assert.match(docs, /does not guarantee webhook delivery order/i);
  assert.match(docs, /Exact provider identity outranks a pending claim/);
  assert.match(docs, /commercialAmendmentId = null/);
  assert.match(docs, /requires_payment_method/);
  assert.match(docs, /created/);
  assert.match(docs, /docs\.stripe\.com\/webhooks#event-ordering/);
  assert.match(docs, /docs\.stripe\.com\/payments\/paymentintents\/lifecycle/);
});
