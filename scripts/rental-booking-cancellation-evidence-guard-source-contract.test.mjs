import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'prisma/migrations/20260918053000_rental-booking-cancellation-evidence-guard/migration.sql',
  'utf8',
);
const docs = readFileSync('docs/rental-booking-cancellation-database-evidence.md', 'utf8');

test('rental cancellation database evidence is enforced at transaction commit', () => {
  assert.match(migration, /CREATE CONSTRAINT TRIGGER rental_booking_cancellation_evidence_booking_guard/);
  assert.match(migration, /AFTER INSERT OR UPDATE OR DELETE ON "rental_bookings"/);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER rental_booking_cancellation_evidence_audit_guard/);
  assert.match(migration, /AFTER INSERT OR UPDATE OR DELETE ON "audit_events"/);
  assert.equal((migration.match(/DEFERRABLE INITIALLY DEFERRED/g) ?? []).length, 2);
  assert.match(docs, /commit-time validation checks the complete transaction/i);
});

test('tenant cancellation evidence requires exactly one matching terminal audit', () => {
  assert.match(migration, /audit\."organizationId" = p_organization_id/);
  assert.match(migration, /audit\."action" = 'booking\.rental\.cancelled'/);
  assert.match(migration, /audit\."resourceType" = 'rental-booking'/);
  assert.match(migration, /audit\."resourceId" = p_booking_resource_id/);
  assert.match(migration, /v_booking_status <> 'CANCELLED'/);
  assert.match(migration, /v_audit_count <> 0/);
  assert.match(migration, /v_audit_count <> 1/);
  assert.match(migration, /cannot outlive its tenant booking/);
});

test('terminal audit evidence matches reason timestamp release flag and allocation', () => {
  assert.match(migration, /v_after_data ->> 'status' <> 'CANCELLED'/);
  assert.match(migration, /jsonb_typeof\(v_after_data -> 'inventoryProtectionReleased'\)/);
  assert.match(migration, /v_after_data ->> 'inventoryProtectionReleased' <> 'true'/);
  assert.match(migration, /char_length\(v_reason\) > 1000/);
  assert.match(migration, /regexp_replace\(btrim\(v_reason\), '\[\[:space:\]\]\+', ' ', 'g'\)/);
  assert.match(migration, /v_after_data ->> 'cancelledAt' <> to_char/);
  assert.match(migration, /v_cancelled_at AT TIME ZONE 'UTC'/);
  assert.ok(migration.includes('\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\''));
  assert.match(migration, /FROM "rental_booking_allocations" allocation/);
  assert.match(migration, /v_after_data ->> 'allocationId' <> v_allocation_id::text/);
});

test('migration fails closed on historical divergence without adding fake commercial behavior', () => {
  assert.match(migration, /FOR evidence IN[\s\S]*FROM "rental_bookings" booking[\s\S]*FROM "audit_events" audit/);
  assert.match(migration, /PERFORM sf_assert_rental_booking_cancellation_evidence/);
  assert.match(docs, /migration deployment fails deliberately/i);
  assert.match(docs, /does not calculate cancellation fees, perform automatic refunds, release or forfeit security bonds/i);
  assert.match(docs, /does not invent a reason, timestamp, allocation, actor, fee, refund/i);
});
