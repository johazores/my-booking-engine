import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('application overdue authority follows latest tenant-scoped custody extension', async () => {
  const source = await read('src/server/inventory/rental-custody-availability.ts');

  assert.match(source, /reschedules:\s*\{/);
  assert.match(source, /where:\s*\{\s*organizationId:\s*input\.organizationId\s*\}/);
  assert.match(source, /orderBy:\s*\[\{\s*appliedAt:\s*'desc'\s*\},\s*\{\s*createdAt:\s*'desc'\s*\},\s*\{\s*id:\s*'desc'\s*\}\]/);
  assert.match(source, /const committedEndsOn = event\.booking\.reschedules\[0\]\?\.targetEndsOn \?\? event\.endsOn/);
  assert.match(source, /endsOn:\s*committedEndsOn/);
  assert.match(source, /effective end cannot predate retained pickup commitment/i);
});

test('staff overdue queue and row projection use the effective committed end', async () => {
  const source = await read('src/server/bookings/rental-booking-read-service.ts');
  const domain = await read('src/server/bookings/rental-booking-custody-read-domain.ts');

  const effectiveEndSubqueries = source.match(/SELECT reschedule\."targetEndsOn"[\s\S]*?pickup\."endsOn"/g) ?? [];
  assert.ok(effectiveEndSubqueries.length >= 2, 'overdue count and page SQL must both use latest reschedule fallback');
  assert.match(source, /const latestReschedule = reschedules\[reschedules\.length - 1\]/);
  assert.match(source, /committedEndsOn:\s*latestReschedule\?\.targetEndsOn \?\? booking\.endsOn/);
  assert.match(domain, /committedEndsOn:\s*Date/);
  assert.match(domain, /endsOn:\s*input\.committedEndsOn/);
  assert.match(domain, /expectedReturnOn:\s*input\.committedEndsOn/);
});

test('database overdue predicate follows latest extension while retaining immutable pickup fallback', async () => {
  const migration = await read('prisma/migrations/20260917115500_rental_custody_extension_overdue_reconciliation/migration.sql');

  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_rental_unit_has_overdue_custody/);
  assert.match(migration, /FROM "rental_booking_reschedules" reschedule/);
  assert.match(migration, /reschedule\."organizationId" = pickup\."organizationId"/);
  assert.match(migration, /reschedule\."bookingId" = pickup\."bookingId"/);
  assert.match(migration, /ORDER BY reschedule\."appliedAt" DESC,[\s\S]*reschedule\."createdAt" DESC,[\s\S]*reschedule\."id" DESC/);
  assert.match(migration, /COALESCE\([\s\S]*reschedule\."targetEndsOn"[\s\S]*pickup\."endsOn"[\s\S]*\)/);
});

test('documentation states extension-aware overdue authority explicitly', async () => {
  const documentation = await read('docs/rental-overdue-custody-availability.md');

  assert.match(documentation, /pickup event remains immutable historical custody evidence/i);
  assert.match(documentation, /latest append-only reschedule target end/i);
  assert.match(documentation, /database overdue predicate/i);
});
