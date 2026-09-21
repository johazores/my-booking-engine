import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260921215000-hospitality-booking-identity-integrity/migration.sql');
const integration = read('src/server/bookings/hospitality-booking-version-authority.integration.ts');
const lifecycleDocs = read('docs/booking-lifecycle-write-scope.md');
const integrityDocs = read('docs/hospitality-booking-source-evidence-integrity.md');

test('hospitality booking identity and creation chronology are immutable', () => {
  assert.match(migration, /sf_guard_hospitality_booking_identity_evidence/);
  assert.match(migration, /NEW\."id" IS DISTINCT FROM OLD\."id"/);
  assert.match(migration, /NEW\."createdAt" IS DISTINCT FROM OLD\."createdAt"/);
  assert.match(migration, /hospitality booking identity evidence is immutable/);
  assert.match(migration, /BEFORE UPDATE OF "id", "createdAt"/);
});

test('hospitality allocation identity and booking ownership are immutable', () => {
  assert.match(migration, /sf_guard_hospitality_booking_allocation_identity_evidence/);
  assert.match(migration, /NEW\."organizationId" IS DISTINCT FROM OLD\."organizationId"/);
  assert.match(migration, /NEW\."bookingId" IS DISTINCT FROM OLD\."bookingId"/);
  assert.match(migration, /hospitality booking allocation identity and ownership evidence is immutable/);
  assert.match(migration, /BEFORE UPDATE OF "id", "createdAt", "organizationId", "bookingId"/);
});

test('guarded database scenario attempts direct booking and allocation identity rewrites', () => {
  assert.match(integration, /hospitality booking identity evidence is immutable/i);
  assert.match(integration, /hospitality booking allocation identity and ownership evidence is immutable/i);
  assert.match(integration, /hospitalityBooking\.update\(\{/);
  assert.match(integration, /hospitalityBookingAllocation\.update\(\{/);
  assert.match(integration, /data: \{ bookingId: crypto\.randomUUID\(\) \}/);
});

test('documentation distinguishes immutable identity from supported allocation mutation', () => {
  assert.match(lifecycleDocs, /durable booking and allocation row identity/i);
  assert.match(lifecycleDocs, /hospitality-booking-source-evidence-integrity\.md/);
  assert.match(integrityDocs, /`HospitalityBooking\.id` and `createdAt` are immutable/);
  assert.match(integrityDocs, /`HospitalityBookingAllocation\.id`, `createdAt`, `organizationId`, and `bookingId` are immutable/);
  assert.match(integrityDocs, /property\/room-type assignment, stay dates, and quantity are intentionally outside this identity trigger/i);
  assert.match(integrityDocs, /GitHub Actions are intentionally not used/i);
});
