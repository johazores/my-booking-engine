import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const confirmation = readFileSync('src/server/bookings/rental-booking-service.ts', 'utf8');
const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const reschedule = readFileSync('src/server/bookings/rental-booking-reschedule-service.ts', 'utf8');
const helper = readFileSync('src/server/bookings/rental-booking-write-errors.ts', 'utf8');
const confirmationRoute = readFileSync('app/api/inventory/rentals/holds/[hold-id]/confirm/route.ts', 'utf8');
const cancellationRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/cancel/route.ts', 'utf8');
const rescheduleRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/reschedule/route.ts', 'utf8');
const docs = readFileSync('docs/rental-booking-write-failure-handling.md', 'utf8');

const services = [confirmation, cancellation, reschedule];

test('shared classifier recognizes only the expected persistence race and constraint codes', () => {
  assert.match(helper, /code === 'P2034'/);
  assert.match(helper, /code === 'P2002'/);
  assert.match(helper, /code === 'P2003' \|\| code === 'P2004'/);
  assert.match(helper, /retryUniqueConflict \? 'RETRYABLE' : 'CONFLICT'/);
  assert.match(helper, /return 'UNKNOWN'/);
});

test('all rental booking writers use the shared classifier instead of local Prisma parsing', () => {
  for (const service of services) {
    assert.match(service, /classifyRentalBookingWriteError/);
    assert.doesNotMatch(service, /function prismaErrorCode/);
    assert.match(service, /attempt < 2/);
    assert.match(service, /disposition === 'RETRYABLE'/);
    assert.match(service, /disposition === 'CONFLICT'/);
  }
  assert.match(confirmation, /retryUniqueConflict: true/);
  assert.match(reschedule, /retryUniqueConflict: true/);
  assert.doesNotMatch(cancellation, /retryUniqueConflict: true/);
});

test('expected persistence failures remain explicit booking conflicts at the staff routes', () => {
  assert.match(confirmationRoute, /RentalBookingConflictError/);
  assert.match(confirmationRoute, /return 'conflict'/);
  assert.match(cancellationRoute, /RentalBookingCancellationConflictError/);
  assert.match(cancellationRoute, /return 'conflict'/);
  assert.match(rescheduleRoute, /RentalBookingRescheduleConflictError/);
  assert.match(rescheduleRoute, /return 'conflict'/);
});

test('documentation keeps retries bounded and unknown failures visible', () => {
  assert.match(docs, /three transaction attempts/);
  assert.match(docs, /every other error remains unknown and is rethrown unchanged/);
  assert.match(docs, /Cancellation has no equivalent record-creation replay boundary/);
  assert.match(docs, /does not relax tenant scope, authorization, advisory locks/);
});
