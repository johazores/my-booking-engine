import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fulfillmentService = read('src/server/bookings/rental-booking-fulfillment-service.ts');
const lateReturnService = read('src/server/bookings/rental-late-return-service.ts');
const custodyDomain = read('src/server/bookings/rental-custody-return-snapshot-domain.ts');
const migration = read('prisma/migrations/20260917143000_rental_custody_extension_return_reconciliation/migration.sql');
const lateReturnDocs = read('docs/rental-late-return-assessment.md');
const reconciliationDocs = read('docs/rental-custody-extension-return-reconciliation.md');

test('late-return application authority accepts only extension-safe return snapshots', () => {
  assert.match(lateReturnService, /validateRentalCustodyReturnSnapshot/);
  assert.match(lateReturnService, /select: \{ id: true, kind: true, unitId: true, startsOn: true, endsOn: true, occurredAt: true \}/);
  assert.match(custodyDomain, /input\.pickup\.startsOn\.getTime\(\) !== input\.returned\.startsOn\.getTime\(\)/);
  assert.match(custodyDomain, /input\.returned\.endsOn\.getTime\(\) < input\.pickup\.endsOn\.getTime\(\)/);
  assert.match(custodyDomain, /input\.returned\.occurredAt\.getTime\(\) < input\.pickup\.occurredAt\.getTime\(\)/);
  assert.match(custodyDomain, /custodyExtended: input\.returned\.endsOn\.getTime\(\) > input\.pickup\.endsOn\.getTime\(\)/);
  assert.doesNotMatch(lateReturnService, /returnEvent\.endsOn\.getTime\(\) !== pickupEvent\.endsOn\.getTime\(\)/);
});

test('PostgreSQL late-return authority permits a later extension end but never a shortened handback commitment', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION sf_author_rental_late_return_assessment\(\)/);
  assert.match(migration, /pickup_starts_on <> return_starts_on/);
  assert.match(migration, /pickup_ends_on > return_ends_on/);
  assert.match(migration, /NEW\."committedEndsOn" <> return_ends_on/);
  assert.match(migration, /return_occurred_at AT TIME ZONE booking_timezone/);
  assert.doesNotMatch(migration, /pickup_ends_on <> return_ends_on/);
});

test('idempotent pickup replay keeps historical pickup dates valid after a later extension', () => {
  assert.match(fulfillmentService, /const pickupReplay = input\.kind === 'PICKED_UP'/);
  assert.match(fulfillmentService, /existing\.endsOn\.getTime\(\) > effectiveEndsOn\.getTime\(\)/);
  assert.match(fulfillmentService, /startsOn: existing\.startsOn,\s*endsOn: existing\.endsOn,/);
  assert.match(fulfillmentService, /!sameDate\(existing\.endsOn, effectiveEndsOn\)/);
});

test('documentation records immutable pickup history and extension-aware return authority', () => {
  assert.match(lateReturnDocs, /pickup snapshot intentionally keeps the earlier handoff commitment/i);
  assert.match(lateReturnDocs, /return snapshot carries the later effective committed end/i);
  assert.match(reconciliationDocs, /different `endsOn` values across custody events/i);
  assert.match(reconciliationDocs, /Return replay still requires an exact match with the current effective end/i);
});
