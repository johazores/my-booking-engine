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
const chronologyMigration = read('prisma/migrations/20261015013000-rental-bond-liability-return-chronology/migration.sql');
const bondIntegration = read('src/server/payments/rental-security-bond.integration.ts');
const service = read('src/server/payments/rental-security-bond-forfeiture-service.ts');
const financialService = read('src/server/payments/rental-security-bond-service.ts');
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

test('forfeiture eligibility and staff actions fail closed across booking and bond snapshots', () => {
  assert.match(service, /bookingStatus !== 'CONFIRMED'/);
  assert.match(service, /eligibility: deriveEligibility\(context, booking\.status\)/);
  assert.match(service, /const locatedEligibility = deriveEligibility\(located, booking\.status\)/);
  assert.match(service, /const eligibility = deriveEligibility\(context, booking\.status\)/);
  assert.match(service, /bookingStatus: booking\.status/);
  assert.match(service, /bondId: context\.bond\?\.id \?\? null/);
  assert.match(service, /transactionIds: context\.rows\.map/);
  assert.match(page, /financialState !== forfeitureState/);
  assert.match(page, /data\.booking\.status !== forfeitureData\.bookingStatus/);
  assert.match(page, /data\.forfeitureId !== \(forfeitureData\.forfeiture\?\.id \?\? null\)/);
  assert.match(page, /data\.transactions\.length !== forfeitureData\.transactionIds\.length/);
  assert.match(page, /data\.transactions\.some/);
  assert.match(financialService, /forfeitureId: state\?\.forfeitureId \?\? null/);
  assert.match(page, /\(data\.bond\?\.id \?\? null\) !== forfeitureData\.bondId/);
  assert.match(page, /Boolean\(forfeitureData\.forfeiture\) !== \(financialState === 'FORFEITED'\)/);
  assert.match(page, /Reload security bond/);
  assert.doesNotMatch(page, /forfeitureData\.settlement\?\.state \?\? data\.settlement\?\.state/);
});


test('both financial and forfeiture readers reject stale retained liability, custody and double settlement', () => {
  assert.match(domain, /export function isValidRentalSecurityBondRetainedLiabilityDisposition/);
  assert.match(domain, /liability\.id !== forfeiture\.liabilityDecisionId/);
  assert.match(domain, /liability\.liableAmountMinor !== forfeiture\.amountMinor/);
  assert.match(domain, /decidedAt <= forfeitedAt/);
  assert.match(domain, /returnedAt <= forfeitedAt/);
  assert.match(domain, /returnedAt <= decidedAt/);
  assert.match(domain, /isValidRentalSecurityBondLiabilityReturnChronology\(\{ liability, returnEvent \}\)/);
  assert.match(service, /isValidRentalSecurityBondLiabilityReturnChronology\(\{ liability: context\.liability, returnEvent: context\.returnEvent \}\)/);
  assert.match(service, /isValidRentalSecurityBondRetainedLiabilityDisposition\(\{/);
  assert.match(financialService, /isValidRentalSecurityBondRetainedLiabilityDisposition\(\{/);
  assert.match(financialService, /outcome: 'CUSTOMER_LIABLE'/);
  assert.match(financialService, /kind: 'RETURNED'/);
  assert.match(financialService, /unitId: liability\.unitId/);
  assert.match(financialService, /rentalDamageSettlementTransaction\.findFirst/);
  assert.match(service, /hasDamageSettlement: context\.hasDamageSettlement/);
  assert.match(bondDocs, /retained liability and custody evidence/i);
});

test('PostgreSQL independently rejects forfeiture when liability predates returned custody', () => {
  assert.match(chronologyMigration, /CREATE FUNCTION sf_guard_rental_bond_liability_return_chronology\(\)/);
  assert.match(chronologyMigration, /rental_security_bond_forfeitures_chronology_guard/);
  assert.match(chronologyMigration, /BEFORE INSERT ON "rental_security_bond_forfeitures"/);
  assert.match(chronologyMigration, /returned\."organizationId" = liability\."organizationId"/);
  assert.match(chronologyMigration, /returned\."bookingId" = liability\."bookingId"/);
  assert.match(chronologyMigration, /returned\."unitId" = liability\."unitId"/);
  assert.match(chronologyMigration, /returned\."kind" = 'RETURNED'/);
  assert.match(chronologyMigration, /returned\."occurredAt" <= liability\."decidedAt"/);
  assert.match(chronologyMigration, /liability\."organizationId" = NEW\."organizationId"/);
  assert.match(chronologyMigration, /liability\."bookingId" = NEW\."bookingId"/);
  assert.match(chronologyMigration, /liability\."id" = NEW\."liabilityDecisionId"/);
  assert.match(chronologyMigration, /ERRCODE = '23514'/);
});

test('disposable PostgreSQL coverage exercises applied forfeiture chronology and exclusivity', () => {
  assert.match(bondIntegration, /rental_security_bond_forfeitures_chronology_guard/);
  assert.match(bondIntegration, /chronologyTriggers/);
  assert.match(bondIntegration, /recordRentalBookingReturn/);
  assert.match(bondIntegration, /recordRentalReturnInspection/);
  assert.match(bondIntegration, /decideRentalDamageLiability/);
  assert.match(bondIntegration, /forfeitRentalSecurityBondAgainstDamageLiability/);
  assert.match(bondIntegration, /forfeitureReplay\.idempotent, true/);
  assert.match(bondIntegration, /recordRentalDamageManualOfflinePayment/);
  assert.match(bondIntegration, /recordRentalSecurityBondManualRelease/);
  assert.match(bondIntegration, /readRentalDamageSettlement/);
  assert.match(bondIntegration, /readRentalBookingSecurityBondGuard/);
  assert.match(bondIntegration, /db\.rentalSecurityBondForfeiture\.create/);
  assert.match(bondIntegration, /db\.rentalSecurityBondForfeiture\.update/);
  assert.match(bondIntegration, /forfeitureAudits, 1/);
  assert.match(bondIntegration, /damagePaymentsCount, 0/);
});
