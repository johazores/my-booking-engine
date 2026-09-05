import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/server/customers/customer-service.ts', 'utf8');
const repository = readFileSync('src/server/customers/customer-repository.ts', 'utf8');
const route = readFileSync('app/api/customers/[customer-id]/deidentify/route.ts', 'utf8');
const page = readFileSync('app/customers/[customer-id]/page.tsx', 'utf8');
const docs = readFileSync('docs/customer-data-lifecycle.md', 'utf8');

test('profile de-identification is tenant-scoped, authorized, archived-only, and blocked by any booking reference', () => {
  assert.match(service, /permission: 'customer:manage'/);
  assert.match(service, /where: \{ id: input\.customerId, organizationId: input\.organizationId, status: 'ARCHIVED' \}/);
  assert.match(service, /transaction\.hospitalityBooking\.count\(\{\s*where: \{ organizationId: input\.organizationId, customerId: current\.id \}/s);
  assert.match(service, /if \(bookingReferenceCount > 0\) throw new CustomerDeidentificationBlockedError\(\)/);
});

test('customer detail derives tenant-scoped de-identification eligibility without replacing write-time authority', () => {
  assert.match(service, /const bookingReferenceCount = customer\.status === 'ARCHIVED' && !deidentification/);
  assert.match(service, /where: \{ organizationId: input\.organizationId, customerId: input\.customerId \}/);
  assert.match(service, /reason: 'BOOKING_REFERENCES'/);
  assert.match(service, /allowed: true, reason: null/);
  assert.match(service, /return \{ customer, activity, deidentification, deidentificationEligibility \}/);
  assert.match(service, /return db\.\$transaction\(async \(transaction\) => \{[\s\S]*?transaction\.hospitalityBooking\.count/s);
});

test('profile de-identification clears direct mutable identifiers and records PII-free audit evidence', () => {
  assert.match(service, /firstName: DEIDENTIFIED_CUSTOMER_FIRST_NAME/);
  assert.match(service, /lastName: DEIDENTIFIED_CUSTOMER_LAST_NAME/);
  assert.match(service, /email: null/);
  assert.match(service, /phone: null/);
  assert.match(service, /notes: null/);
  assert.match(service, /action: 'customer\.deidentified'/);
  const auditBlock = service.match(/action: 'customer\.deidentified'[\s\S]*?return updated;/);
  assert.ok(auditBlock);
  assert.doesNotMatch(auditBlock[0], /current\.(firstName|lastName|email|phone|notes)/);
});

test('de-identification evidence reads remain tenant and resource scoped', () => {
  assert.match(repository, /organizationId: input\.organizationId,[\s\S]*?resourceType: 'customer',[\s\S]*?resourceId: input\.customerId,[\s\S]*?action: 'customer\.deidentified'/);
  assert.match(repository, /select: \{ createdAt: true \}/);
});

test('product route is correlated and keeps identifiers out of structured log scope', () => {
  assert.ok(route.includes("operation: 'customer.deidentify'"));
  assert.match(route, /\{ organizationId \}/);
  const finishDefinition = route.match(/const finish = [\s\S]*?;\n\n/);
  assert.ok(finishDefinition);
  assert.equal(finishDefinition[0].includes('customerId'), false);
  assert.match(route, /CustomerDeidentificationBlockedError/);
  assert.match(route, /deidentify-linked-bookings/);
});

test('operator UI only offers the destructive action when the server-derived eligibility allows it', () => {
  assert.match(page, /const deidentificationEligibility = detail\.deidentificationEligibility/);
  assert.match(page, /canManage && deidentificationEligibility\.allowed/);
  assert.match(page, /deidentificationEligibility\.reason === 'BOOKING_REFERENCES'/);
  assert.match(page, /De-identification unavailable/);
  assert.match(page, /the server will check the complete eligibility rules again when you submit/);
  assert.match(page, /aria-describedby="deidentify-customer-description"/);
});

test('operator UI and lifecycle contract state the narrow irreversible boundary without claiming linked evidence disposal', () => {
  assert.match(page, /It does not delete booking, guest, payment, or issued legal-document evidence/);
  assert.match(page, /DEIDENTIFY/);
  assert.match(docs, /zero hospitality booking references/i);
  assert.match(docs, /does not mutate or delete booking guest snapshots/i);
  assert.match(docs, /does not infer disposal authority from age/i);
  assert.match(docs, /write-time authority/i);
});
