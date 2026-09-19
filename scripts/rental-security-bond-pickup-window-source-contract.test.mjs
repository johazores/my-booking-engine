import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const service = read('src/server/payments/rental-security-bond-service.ts');
const page = read('app/inventory/rentals/bookings/[booking-id]/security-bond/page.tsx');
const migration = read('prisma/migrations/20260919083000_rental_security_bond_pickup_window_guard/migration.sql');
const docs = read('docs/rental-security-bond-pickup-window.md');

test('fresh bond authority uses tenant reschedule, retained timezone, and PostgreSQL time', () => {
  assert.match(service, /deriveRentalBookingPickupWindow/);
  assert.match(service, /rentalBookingReschedule\.findFirst/);
  assert.match(service, /where: \{ organizationId, bookingId: booking\.id \}/);
  assert.match(service, /orderBy: \[\{ appliedAt: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/);
  assert.match(service, /SELECT clock_timestamp\(\) AS "now"/);
  assert.match(service, /timeZone: booking\.location\.timeZone/);
  assert.match(service, /pickupWindow\.state !== 'CLOSED'/);
});

test('fresh requirement and collection fail closed after missed pickup while exact replay stays historical', () => {
  const requirementExisting = service.indexOf('if (existing) {', service.indexOf('createRentalSecurityBondRequirement'));
  const requirementAuthority = service.indexOf('const preCustodyAuthority = await readFreshSecurityBondAuthority', requirementExisting);
  assert.ok(requirementExisting >= 0 && requirementAuthority > requirementExisting, 'requirement replay must precede fresh window authority');

  const collectionStart = service.indexOf("if (operation === 'collection') {");
  const transactionExisting = service.indexOf('if (existing) {', service.indexOf('recordManualBondEvidence'));
  const collectionAuthority = service.indexOf('const preCustodyAuthority = await readFreshSecurityBondAuthority', transactionExisting);
  const providerCall = service.indexOf('manualProvider.recordOfflinePayment', collectionAuthority);
  assert.ok(transactionExisting >= 0 && collectionAuthority > transactionExisting, 'collection replay must precede fresh window authority');
  assert.ok(providerCall > collectionAuthority, 'fresh pickup-window authority must run before manual provider collection I/O');
  assert.match(service, /Security bond requirement cannot be created after the committed pickup window has closed/);
  assert.match(service, /Security bond collection cannot be recorded after the committed pickup window has closed/);
  assert.ok(collectionStart >= 0);
});

test('database independently blocks fresh requirement and collection after lifecycle or pickup-window closure', () => {
  assert.match(migration, /sf_guard_rental_security_bond_fresh_write_window/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /booking\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /parent_booking\."status" <> 'CONFIRMED'/);
  assert.match(migration, /parent_booking\."cancelledAt" IS NOT NULL/);
  assert.match(migration, /rental_booking_fulfillment_events/);
  assert.match(migration, /reschedule\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /ORDER BY reschedule\."appliedAt" DESC, reschedule\."createdAt" DESC, reschedule\."id" DESC/);
  assert.match(migration, /location\."organizationId" = NEW\."organizationId"/);
  assert.match(migration, /clock_timestamp\(\) AT TIME ZONE retained_location\."timeZone"/);
  assert.match(migration, /observed_local_date >= effective_ends_on/);
  assert.match(migration, /rental_security_bond_requirements_pickup_window_guard/);
  assert.match(migration, /rental_security_bond_transactions_pickup_window_guard/);
});

test('release remains available to unwind held customer money', () => {
  assert.match(migration, /WHEN \(NEW\."kind" = 'OFFLINE_PAYMENT'\)/);
  assert.doesNotMatch(migration, /WHEN \(NEW\."kind" = 'REFUND'\)/);
  assert.match(page, /canManage && effectiveState === 'COLLECTED'/);
  assert.match(page, /A release remains available for already-collected money even after the pickup window closes/);
});

test('staff workspace removes dead fresh bond actions after custody or missed pickup', () => {
  assert.match(page, /!data\.preCustodyAuthority\.canEstablishOrCollect/);
  assert.match(page, /data\.preCustodyAuthority\.hasCustodyEvidence/);
  assert.match(page, /New security-bond setup is closed after custody begins/);
  assert.match(page, /New security-bond setup is closed for this missed pickup/);
  assert.match(page, /data\.preCustodyAuthority\.canEstablishOrCollect && effectiveState === 'REQUIRED'/);
  assert.match(page, /data\.preCustodyAuthority\.canEstablishOrCollect && data\.booking\.status === 'CONFIRMED'/);
});

test('documentation keeps the fresh-write and release boundaries explicit', () => {
  assert.match(docs, /missed pickup/);
  assert.match(docs, /PostgreSQL `clock_timestamp\(\)`/);
  assert.match(docs, /Exact idempotent replay/);
  assert.match(docs, /release is never blocked/i);
  assert.match(docs, /direct SQL can no longer insert a new collection after the booking has been cancelled/);
  assert.match(docs, /does not invent automatic cancellation/);
});
