import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const schema = readFileSync(new URL('../prisma/rental-damage-liability.prisma', import.meta.url), 'utf8');
const damageSchema = readFileSync(new URL('../prisma/rental-damage-case.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../prisma/migrations/20260917005000_rental_damage_liability_decisions/migration.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/server/bookings/rental-damage-liability-service.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/components/rental-damage-liability-panel.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/inventory/rentals/bookings/[booking-id]/damage-case/[case-id]/liability/route.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/rental-damage-liability.md', import.meta.url), 'utf8');

test('liability persistence is tenant-owned, unique, and linked to retained damage authority', () => {
  assert.match(schema, /model RentalDamageLiabilityDecision/);
  assert.match(schema, /damageCase\s+RentalDamageCase\s+@relation\(fields: \[damageCaseId, organizationId\]/);
  assert.match(schema, /@@unique\(\[organizationId, bookingId\]/);
  assert.match(schema, /@@unique\(\[organizationId, damageCaseId\]/);
  assert.match(schema, /@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(schema, /securityBondForfeiture\s+RentalSecurityBondForfeiture\?/);
  assert.match(damageSchema, /liabilityDecision\s+RentalDamageLiabilityDecision\?/);
});

test('server authority requires booking and payment permissions with scoped serialization', () => {
  for (const permission of ['booking:read', 'payment:read', 'booking:manage', 'payment:manage']) assert.match(service, new RegExp(`permission: '${permission.replace(':', '\\:')}'`));
  assert.match(service, /rentalUnitLockKey\(input\.organizationId, located\.unitId\)/);
  assert.match(service, /rental-damage-liability:idempotency:/);
  assert.match(service, /organizationId: input\.organizationId/);
  assert.match(service, /bookingId: input\.bookingId/);
  assert.match(service, /damageCaseId: input\.damageCaseId/);
  assert.match(service, /damageCase\.status !== 'CLOSED'/);
  assert.match(service, /damageCase\.estimatedRepairCostMinor === null/);
});

test('database independently enforces closed source authority, exact amount shape, append-only evidence, and wall-clock time', () => {
  assert.match(migration, /'rental-damage-liability:' \|\| NEW\."damageCaseId"::text/);
  assert.match(migration, /case_status <> 'CLOSED'/);
  assert.match(migration, /booking\."currency" = damage_case\."currency"/);
  assert.match(migration, /NEW\."liableAmountMinor" > case_estimate/);
  assert.match(migration, /no-liability decision cannot retain a customer amount/);
  assert.match(migration, /TG_OP <> 'INSERT'/);
  assert.match(migration, /clock_timestamp\(\)/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/);
});

test('real staff UI is wired to the server decision boundary without fake collection controls', () => {
  assert.match(component, /Customer damage liability/);
  assert.match(component, /Record liability decision/);
  assert.match(component, /does not collect money/);
  assert.match(component, /cannot exceed the retained repair estimate/);
  assert.match(component, /RentalDamageSettlementPanel/);
  assert.match(route, /decideRentalDamageLiability/);
  assert.match(route, /prepareInventoryMutationRequest\(request, 'booking\.rental\.damage-liability\.decide'\)/);
  assert.doesNotMatch(component, /Charge customer|Capture payment|Collect bond/);
});

test('documentation keeps liability authority separate while allowing explicit exact-match bond settlement', () => {
  assert.match(docs, /decision itself does not collect money/);
  assert.match(docs, /Booking-price settlement stays in `RentalPaymentTransaction`/);
  assert.match(docs, /explicit exact-match `RentalSecurityBondForfeiture` path/);
  assert.match(docs, /Bond forfeiture is not automatic/);
  assert.match(docs, /same liability cannot be collected twice/);
});
