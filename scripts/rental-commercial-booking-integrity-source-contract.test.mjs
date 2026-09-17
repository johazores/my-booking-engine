import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const bookingSchema = read('prisma/rental-inventory.prisma');
const damageCaseSchema = read('prisma/rental-damage-case.prisma');
const liabilitySchema = read('prisma/rental-damage-liability.prisma');
const damageSettlementSchema = read('prisma/rental-damage-settlement.prisma');
const lateReturnSettlementSchema = read('prisma/rental-late-return-settlement.prisma');
const migration = read('prisma/migrations/20260917084900_rental_commercial_booking_integrity/migration.sql');
const liabilityDocs = read('docs/rental-damage-liability.md');
const damageSettlementDocs = read('docs/rental-damage-settlement.md');
const lateReturnSettlementDocs = read('docs/rental-late-return-settlement.md');

test('customer damage liability has a direct tenant-owned booking relation', () => {
  assert.match(
    liabilitySchema,
    /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\].*rental_damage_liability_decisions_booking_fkey/,
  );
  assert.match(bookingSchema, /damageLiabilityDecision\s+RentalDamageLiabilityDecision\?/);
  assert.match(
    migration,
    /ALTER TABLE "rental_damage_liability_decisions"[\s\S]*FOREIGN KEY \("bookingId", "organizationId"\)[\s\S]*REFERENCES "rental_bookings"\("id", "organizationId"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE;/,
  );
});

test('damage settlement is directly constrained to both booking and damage case', () => {
  assert.match(
    damageSettlementSchema,
    /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\].*rental_damage_settlement_transactions_booking_fkey/,
  );
  assert.match(
    damageSettlementSchema,
    /damageCase\s+RentalDamageCase\s+@relation\(fields: \[damageCaseId, organizationId\], references: \[id, organizationId\].*rental_damage_settlement_transactions_damage_case_fkey/,
  );
  assert.match(bookingSchema, /damageSettlementTransactions\s+RentalDamageSettlementTransaction\[\]/);
  assert.match(damageCaseSchema, /settlementTransactions\s+RentalDamageSettlementTransaction\[\]/);
  assert.match(migration, /CONSTRAINT "rental_damage_settlement_transactions_booking_fkey"/);
  assert.match(migration, /CONSTRAINT "rental_damage_settlement_transactions_damage_case_fkey"/);
});

test('late-return settlement has a direct tenant-owned booking relation', () => {
  assert.match(
    lateReturnSettlementSchema,
    /booking\s+RentalBooking\s+@relation\(fields: \[bookingId, organizationId\], references: \[id, organizationId\].*rental_late_return_settlement_transactions_booking_fkey/,
  );
  assert.match(bookingSchema, /lateReturnSettlementTransactions\s+RentalLateReturnSettlementTransaction\[\]/);
  assert.match(
    migration,
    /ALTER TABLE "rental_late_return_settlement_transactions"[\s\S]*FOREIGN KEY \("bookingId", "organizationId"\)[\s\S]*REFERENCES "rental_bookings"\("id", "organizationId"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE;/,
  );
});

test('commercial docs describe direct booking referential integrity as defense in depth', () => {
  assert.match(liabilityDocs, /composite `\(bookingId, organizationId\)` foreign key directly to `RentalBooking`/);
  assert.match(damageSettlementDocs, /direct composite tenant foreign keys to both `RentalBooking` and `RentalDamageCase`/);
  assert.match(lateReturnSettlementDocs, /direct composite `\(bookingId, organizationId\)` foreign key to `RentalBooking`/);
  assert.match(lateReturnSettlementDocs, /GitHub Actions are not required or used/);
});
