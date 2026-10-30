import { spawnSync } from 'node:child_process';

import { assertRequiredDatabaseIntegrationTests, discoverDatabaseIntegrationTests } from './database-integration-discovery.mjs';

import { validateDisposableTestDatabase } from './database-test-safety.mjs';
import { assertSupportedDatabaseTestRuntime } from './database-test-runtime.mjs';
import { verifyDisposableDatabaseSession } from './database-test-session.mjs';
import { assertNoDotenvConfigurationOverrides, assertNoPostgresConnectionOverrides, readLocalApplicationDatabaseUrls } from './database-test-environment.mjs';

assertSupportedDatabaseTestRuntime();
assertNoPostgresConnectionOverrides(process.env);
assertNoDotenvConfigurationOverrides(process.env);

const testDatabaseUrl = validateDisposableTestDatabase({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  applicationDatabaseUrl: process.env.DATABASE_URL,
  applicationDatabaseUrls: readLocalApplicationDatabaseUrls(),
  confirmation: process.env.SF_DATABASE_TEST_CONFIRM,
  pgPort: process.env.PGPORT,
});

const env = {
  ...process.env,
  DATABASE_URL: testDatabaseUrl,
  NODE_ENV: 'test',
};

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Keep existing critical suites mandatory while discovering newly added suites automatically.
const requiredDatabaseIntegrationTests = [
  'src/server/tenancy/tenant-isolation.integration.ts',
  'src/server/auth/auth-persistence.integration.ts',
  'src/server/auth/auth-abuse-control.integration.ts',
  'src/server/authorization/authorization.integration.ts',
  'src/server/organizations/organization-management.integration.ts',
  'src/server/branding/branding.integration.ts',
  'src/server/customers/customer.integration.ts',
  'src/server/integrations/integration.integration.ts',
  'src/server/inventory/hospitality.integration.ts',
  'src/server/inventory/tour-inventory.integration.ts',
  'src/server/inventory/appointment-inventory.integration.ts',
  'src/server/inventory/rental-inventory.integration.ts',
  'src/server/inventory/rental-database-integrity.integration.ts',
  'src/server/inventory/rental-hold.integration.ts',
  'src/server/inventory/hospitality-rate-plan.integration.ts',
  'src/server/inventory/hospitality-restriction.integration.ts',
  'src/server/availability/hospitality-availability.integration.ts',
  'src/server/availability/hospitality-availability-hold.integration.ts',
  'src/server/pricing/hospitality-pricing.integration.ts',
  'src/server/pricing/hospitality-charge.integration.ts',
  'src/server/pricing/hospitality-addon.integration.ts',
  'src/server/bookings/hospitality-booking.integration.ts',
  'src/server/bookings/hospitality-booking-version-authority.integration.ts',
  'src/server/bookings/hospitality-cancelled-allocation-history-integrity.integration.ts',
  'src/server/bookings/hospitality-booking-guest-evidence-integrity.integration.ts',
  'src/server/bookings/hospitality-booking-pricing-evidence-integrity.integration.ts',
  'src/server/bookings/rental-booking.integration.ts',
  'src/server/bookings/rental-booking-source-evidence.integration.ts',
  'src/server/bookings/hospitality-booking-reschedule.integration.ts',
  'src/server/bookings/hospitality-booking-commercial-modification.integration.ts',
  'src/server/bookings/hospitality-booking-guest-modification.integration.ts',
  'src/server/bookings/public-booking-principal.integration.ts',
  'src/server/bookings/public-hospitality-hold.integration.ts',
  'src/server/bookings/public-hospitality-confirmation.integration.ts',
  'src/server/suppliers/hospitality-supplier-reservation.integration.ts',
  'src/server/suppliers/hospitality-supplier-reservation-confirmation-evidence.integration.ts',
  'src/server/suppliers/hospitality-supplier-reservation-attempt-recovery.integration.ts',
  'src/server/suppliers/hospitality-supplier-reservation-provider-evidence.integration.ts',
  'src/server/suppliers/hospitality-supplier-reservation-recovery-write.integration.ts',
  'src/server/suppliers/hospitality-supplier-reservation-reconciliation.integration.ts',
  'src/server/payments/payment.integration.ts',
  'src/server/payments/rental-payment.integration.ts',
  'src/server/payments/rental-security-bond.integration.ts',
  'src/server/payments/hospitality-invoice-preparation.integration.ts',
  'src/server/payments/hospitality-invoice-issuance.integration.ts',
  'src/server/payments/hospitality-invoice-number-sequence-integrity.integration.ts',
  'src/server/payments/hospitality-commercial-settlement-evidence-database-integrity.integration.ts',
  'src/server/payments/hospitality-v6-refund-authority-database-integrity.integration.ts',
  'src/server/payments/stripe-reference-database-constraints.integration.ts',
  'src/server/payments/stripe-payment.integration.ts',
  'src/server/payments/stripe-refund.integration.ts',
  'src/server/payments/stripe-refund-webhook.integration.ts',
];

const discoveredDatabaseIntegrationTests = discoverDatabaseIntegrationTests();
assertRequiredDatabaseIntegrationTests(requiredDatabaseIntegrationTests, discoveredDatabaseIntegrationTests);
// Read-only connection verification must precede Prisma schema and migration commands.
await verifyDisposableDatabaseSession(testDatabaseUrl);
run(npmCommand, ['run', 'prisma:validate']);
run(npmCommand, ['run', 'prisma:generate']);
run(npmCommand, ['run', 'db:deploy']);
run(npmCommand, ['run', 'db:status']);
run(npmCommand, ['run', 'db:drift']);
// Each suite opens database connections and manages its own tenant fixtures.
// Bound file-level concurrency without weakening intentional within-suite races.
run(process.execPath, ['--test', '--test-concurrency=1', ...discoveredDatabaseIntegrationTests]);
