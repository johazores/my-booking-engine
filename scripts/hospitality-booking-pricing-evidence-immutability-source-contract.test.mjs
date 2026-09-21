import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('prisma/migrations/20260922012500-hospitality-booking-pricing-evidence-immutability/migration.sql');
const integration = read('src/server/bookings/hospitality-booking-pricing-evidence-integrity.integration.ts');
const databaseRunner = read('scripts/run-database-tests.mjs');
const sourceEvidenceDocs = read('docs/hospitality-booking-source-evidence-integrity.md');
const invoiceDocs = read('docs/invoice-foundation.md');

test('pricing evidence rejects every in-place rewrite', () => {
  assert.match(migration, /sf_guard_hospitality_booking_pricing_evidence_update/);
  assert.match(migration, /hospitality booking pricing evidence is immutable/);
  assert.match(migration, /BEFORE UPDATE ON "hospitality_booking_pricing_evidence"/);
});

test('pricing evidence cannot be deleted while its tenant booking is retained', () => {
  assert.match(migration, /sf_guard_hospitality_booking_pricing_evidence_deletion/);
  assert.match(migration, /booking\."organizationId" = OLD\."organizationId"/);
  assert.match(migration, /booking\."id" = OLD\."bookingId"/);
  assert.match(migration, /hospitality booking pricing evidence is append-only while the booking is retained/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER hospitality_booking_pricing_evidence_deletion_guard/);
  assert.match(migration, /AFTER DELETE ON "hospitality_booking_pricing_evidence"/);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/);
});

test('guarded PostgreSQL scenario covers active and cancelled evidence plus coherent teardown', () => {
  assert.match(integration, /hospitalityBookingPricingEvidence\.update\(\{/);
  assert.match(integration, /hospitality booking pricing evidence is immutable/i);
  assert.match(integration, /hospitalityBookingPricingEvidence\.delete\(\{/);
  assert.match(integration, /cancelHospitalityBooking\(\{/);
  assert.match(integration, /append-only while the booking is retained/i);
  assert.match(integration, /db\.\$transaction\(async \(transaction\) => \{/);
  assert.match(integration, /transaction\.hospitalityBookingPricingEvidence\.deleteMany/);
  assert.match(integration, /transaction\.hospitalityBooking\.deleteMany/);
  assert.match(databaseRunner, /src\/server\/bookings\/hospitality-booking-pricing-evidence-integrity\.integration\.ts/);
});

test('documentation treats accepted pricing rows as database-enforced append-only evidence', () => {
  assert.match(sourceEvidenceDocs, /Pricing evidence history/);
  assert.match(sourceEvidenceDocs, /PostgreSQL rejects every in-place `UPDATE`/i);
  assert.match(sourceEvidenceDocs, /standalone deletion while the owning booking remains retained/i);
  assert.match(invoiceDocs, /PostgreSQL now enforces that append-only contract/i);
  assert.match(invoiceDocs, /coherent booking teardown/i);
});
