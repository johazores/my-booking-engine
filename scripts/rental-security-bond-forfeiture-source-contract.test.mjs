import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const schema = read('prisma/rental-security-bond.prisma');
const rentalSchema = read('prisma/rental-inventory.prisma');
const liabilitySchema = read('prisma/rental-damage-liability.prisma');
const migration = read('prisma/migrations/20260917060000_rental_security_bond_forfeiture/migration.sql');
const service = read('src/server/payments/rental-security-bond-forfeiture-service.ts');
const domain = read('src/server/payments/rental-security-bond-domain.ts');
const route = read('app/api/inventory/rentals/bookings/[booking-id]/security-bond/forfeiture/route.ts');
const page = read('app/inventory/rentals/bookings/[booking-id]/security-bond/page.tsx');
const damagePanel = read('src/components/rental-damage-settlement-panel.tsx');
const bondDocs = read('docs/rental-security-bond.md');
const damageDocs = read('docs/rental-damage-settlement.md');

test('forfeiture persistence is tenant-owned, append-only, and relationally bound to exact authority', () => {
  assert.match(schema, /model RentalSecurityBondForfeiture/);
  assert.match(schema, /liabilityDecisionId\s+String\s+@db\.Uuid/);
  assert.match(schema, /collectionTransactionId\s+String\s+@db\.Uuid/);
  assert.match(schema, /@@unique\(\[organizationId, bondId\]/);
  assert.match(schema, /@@unique\(\[organizationId, liabilityDecisionId\]/);
  assert.match(rentalSchema, /securityBondForfeiture\s+RentalSecurityBondForfeiture\?/);
  assert.match(liabilitySchema, /securityBondForfeiture\s+RentalSecurityBondForfeiture\?/);
  assert.match(migration, /rental security bond forfeitures are append-only/);
  assert.match(migration, /rental_security_bond_forfeitures_booking_fkey/);
  assert.match(migration, /rental_security_bond_forfeitures_liability_fkey/);
  assert.match(migration, /rental_security_bond_forfeitures_collection_fkey/);
  assert.match(migration, /clock_timestamp\(\)/);
});

test('server derives forfeiture authority and requires dual booking/payment permissions', () => {
  for (const permission of ['booking:read', 'payment:read', 'booking:manage', 'payment:manage']) assert.match(service, new RegExp(`'${permission}'`));
  assert.match(service, /buildRentalSecurityBondForfeitureIdempotencyKey/);
  assert.match(domain, /rental-bond:forfeiture:/);
  assert.match(service, /rentalUnitLockKey/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /outcome: 'CUSTOMER_LIABLE'/);
  assert.match(service, /bond\.amountMinor !== context\.liability\.liableAmountMinor/);
  assert.doesNotMatch(service, /liabilityDecisionId:\s*input\./);
  assert.doesNotMatch(service, /amountMinor:\s*input\./);
  assert.doesNotMatch(service, /currency:\s*input\./);
});

test('database serializes terminal bond disposition and blocks double customer-damage settlement', () => {
  assert.match(migration, /sf:rental-security-bond-disposition:/);
  assert.match(migration, /sf:rental-damage-liability-settlement:/);
  assert.match(migration, /released rental security bond cannot be forfeited/);
  assert.match(migration, /forfeited rental security bond cannot also be released/);
  assert.match(migration, /customer damage liability already has separate settlement evidence/);
  assert.match(migration, /customer damage liability is already settled by security bond forfeiture/);
  assert.match(migration, /release or explicitly forfeit the collected rental security bond before cancelling this booking/);
  assert.match(migration, /kind" = 'RETURNED'/);
});

test('staff workflow requires explicit destructive confirmation and never presents partial offset as supported', () => {
  assert.match(route, /readInventoryFormData\(request\)/);
  assert.match(route, /formField\(formData, 'confirmation'\)/);
  assert.match(route, /!== 'FORFEIT'/);
  assert.match(route, /forfeitRentalSecurityBondAgainstDamageLiability/);
  assert.match(page, /Forfeit bond against damage liability/);
  assert.match(page, /sf-button sf-button--danger/);
  assert.match(page, /pattern="\[Ff\]\[Oo\]\[Rr\]\[Ff\]\[Ee\]\[Ii\]\[Tt\]"/);
  assert.match(damagePanel, /Settled by bond/);
  assert.match(damagePanel, /!forfeiture && result\.settlement\.state === 'UNPAID'/);
  assert.match(bondDocs, /Partial amounts|partial damage offset/i);
  assert.match(damageDocs, /Partial bond offsets are intentionally unsupported/i);
});
