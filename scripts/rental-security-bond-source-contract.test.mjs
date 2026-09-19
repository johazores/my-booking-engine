import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const schema = read('prisma/rental-security-bond.prisma');
const rentalSchema = read('prisma/rental-inventory.prisma');
const migration = read('prisma/migrations/20260917030000_rental_security_bond_foundation/migration.sql');
const integrityMigration = read('prisma/migrations/20260917033000_rental_security_bond_booking_integrity/migration.sql');
const registryMigration = read('prisma/migrations/20260918225500_rental-manual-reference-registry/migration.sql');
const service = read('src/server/payments/rental-security-bond-service.ts');
const domain = read('src/server/payments/rental-security-bond-domain.ts');
const page = read('app/inventory/rentals/bookings/[booking-id]/security-bond/page.tsx');
const requirementRoute = read('app/api/inventory/rentals/bookings/[booking-id]/security-bond/requirement/route.ts');
const collectionRoute = read('app/api/inventory/rentals/bookings/[booking-id]/security-bond/collection/route.ts');
const releaseRoute = read('app/api/inventory/rentals/bookings/[booking-id]/security-bond/release/route.ts');
const paymentPanel = read('src/components/rental-booking-payment-panel.tsx');
const docs = read('docs/rental-security-bond.md');
const databaseRunner = read('scripts/run-database-tests.mjs');
const integration = read('src/server/payments/rental-security-bond.integration.ts');

test('security bond persistence is tenant-owned, booking-bound, unique, append-only, and amount-bound', () => {
  assert.match(schema, /model RentalSecurityBondRequirement/);
  assert.match(schema, /model RentalSecurityBondTransaction/);
  assert.match(schema, /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\]/);
  assert.match(schema, /rental_security_bond_requirements_booking_fkey/);
  assert.match(schema, /rental_security_bond_transactions_booking_fkey/);
  assert.match(rentalSchema, /securityBondRequirement\s+RentalSecurityBondRequirement\?/);
  assert.match(rentalSchema, /securityBondTransactions\s+RentalSecurityBondTransaction\[\]/);
  assert.match(schema, /@@unique\(\[organizationId, bookingId\]/);
  assert.match(schema, /@@unique\(\[organizationId, bondId, kind\]/);
  assert.match(integrityMigration, /FOREIGN KEY \("bookingId", "organizationId"\)/);
  assert.match(integrityMigration, /REFERENCES "rental_bookings"\("id", "organizationId"\)/);
  assert.match(integrityMigration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(migration, /rental security bond requirements are append-only/);
  assert.match(migration, /rental security bond transactions are append-only/);
  assert.match(migration, /transaction must match retained requirement exactly/);
  assert.match(migration, /clock_timestamp\(\)/);
});

test('server derives tenant, permissions, idempotency, money, provider, and request evidence', () => {
  for (const permission of ['booking:read', 'payment:read', 'booking:manage', 'payment:manage']) assert.match(service, new RegExp(`permission: '${permission}'`));
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /parseMoneyMajorToMinor\(input\.amountMajor, booking\.currency\)/);
  assert.match(service, /ManualPaymentProvider/);
  assert.match(service, /buildRentalSecurityBondRequirementIdempotencyKey/);
  assert.match(service, /buildRentalSecurityBondTransactionIdempotencyKey/);
  assert.match(service, /buildRentalSecurityBondRequestFingerprint/);
  assert.match(domain, /rental-security-bond-request-v1/);
  assert.doesNotMatch(service, /idempotencyKey:\s*input\./);
});

test('database blocks pickup without active collection and cancellation while bond money remains held', () => {
  assert.match(migration, /rental pickup requires the retained security bond to be actively collected/);
  assert.match(migration, /rental_fulfillment_security_bond_pickup_guard/);
  assert.match(migration, /release the collected rental security bond before cancelling this booking/);
  assert.match(migration, /rental_booking_security_bond_cancellation_guard/);
});

test('manual references use the central tenant-wide registry across every current rental money ledger', () => {
  assert.match(registryMigration, /CREATE TABLE "rental_manual_provider_references"/);
  for (const ledger of [
    'rental_payment_transactions',
    'rental_damage_settlement_transactions',
    'rental_security_bond_transactions',
    'rental_late_return_settlement_transactions',
    'rental_booking_commercial_amendment_settlement_transactions',
    'rental_booking_effective_refund_transactions',
  ]) assert.match(registryMigration, new RegExp(ledger));
  assert.match(registryMigration, /rental_security_bond_transactions_register_manual_reference/);
  assert.match(registryMigration, /sf_register_rental_manual_reference/);
  assert.match(registryMigration, /sf:rental-manual-reference:/);
  assert.match(service, /rentalManualProviderReference\.findUnique/);
});

test('staff surface exposes only persisted requirement, collection, release, and explicit forfeiture actions', () => {
  assert.match(paymentPanel, /security-bond/);
  assert.match(page, /Require security bond/);
  assert.match(page, /Record bond collection/);
  assert.match(page, /Record bond release/);
  assert.match(page, /Forfeit bond against damage liability/);
  assert.match(requirementRoute, /createRentalSecurityBondRequirement/);
  assert.match(collectionRoute, /recordRentalSecurityBondManualCollection/);
  assert.match(releaseRoute, /recordRentalSecurityBondManualRelease/);
  for (const route of [collectionRoute, releaseRoute]) {
    assert.match(route, /readInventoryFormData\(request\)/);
    assert.match(route, /formField\(formData, 'reference'\)/);
    assert.doesNotMatch(route, /request\.formData\(\)/);
  }
  assert.match(docs, /does not implement card authorization or capture/i);
  assert.match(docs, /Forfeiture is never automatic/i);
  assert.match(docs, /RentalManualProviderReference/);
  assert.doesNotMatch(page, /Capture bond|Authorize card/);
});

test('guarded PostgreSQL coverage is registered for tenant scope, custody, cancellation, append-only evidence, and reference isolation', () => {
  assert.match(databaseRunner, /src\/server\/payments\/rental-security-bond\.integration\.ts/);
  assert.match(integration, /organizationId: otherOrganization\.id/);
  assert.match(integration, /recordRentalBookingPickup/);
  assert.match(integration, /cancelRentalBooking/);
  assert.match(integration, /rentalSecurityBondRequirement\.update/);
  assert.match(integration, /rentalSecurityBondTransaction\.delete/);
  assert.match(integration, /recordRentalManualOfflinePayment/);
});
