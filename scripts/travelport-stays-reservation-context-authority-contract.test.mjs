import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('expected reservation materialization fails closed around caller-owned accessors', () => {
  const authority = source('src/server/suppliers/travelport-stays-reservation-expected-authority.ts');
  assert.match(authority, /try \{[\s\S]*Array\.isArray\(value\)[\s\S]*chainCode: expected\.chainCode/);
  assert.match(authority, /catch \{\s*return null;\s*\}/);
  assert.match(authority, /Hostile\/revoked proxies and throwing accessors fail closed/);
});

test('payment-card source materializes non-sensitive context before external capability invocation', () => {
  const boundary = source('src/server/suppliers/travelport-stays-reservation-payment-card-source.ts');
  const materializeIndex = boundary.indexOf('const normalizedContext = materializeSourceContext(context);');
  const invokeIndex = boundary.indexOf('await acquirePaymentCard.call(source, normalizedContext)');
  assert.ok(materializeIndex >= 0 && invokeIndex > materializeIndex);
  assert.match(boundary, /function materializeSourceContext\(value: unknown\)/);
  for (const field of [
    'organizationId',
    'reservationId',
    'integrationId',
    'integrationCredentialVersion',
    'attemptId',
    'purpose',
  ]) {
    assert.match(boundary, new RegExp(`${field} = context\\.${field}`));
  }
  assert.match(boundary, /SOURCE_CONTEXT_FAILURE_MESSAGE/);
  assert.match(boundary, /sourceIsArray = Array\.isArray\(source\)/);
});

test('authority documentation keeps reservation activation closed', () => {
  const prewrite = source('docs/travelport-reservation-prewrite-authority.md');
  const payment = source('docs/travelport-reservation-payment-card-boundary.md');
  for (const doc of [prewrite, payment]) {
    assert.match(doc, /fail(?:s|ed)? closed/i);
    assert.match(doc, /(?:reservation.*disabled|does not enable.*reservation)/i);
    assert.match(doc, /PCI/i);
  }
  assert.match(payment, /read(?:s)? each allowed context field exactly once/i);
  assert.match(payment, /caller-only metadata is not copied/i);
});
