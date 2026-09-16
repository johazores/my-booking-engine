import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const confirmation = readFileSync('src/server/bookings/rental-booking-service.ts', 'utf8');
const cancellation = readFileSync('src/server/bookings/rental-booking-cancellation-service.ts', 'utf8');
const reschedule = readFileSync('src/server/bookings/rental-booking-reschedule-service.ts', 'utf8');
const substitution = readFileSync('src/server/bookings/rental-booking-unit-substitution-service.ts', 'utf8');
const fulfillment = readFileSync('src/server/bookings/rental-booking-fulfillment-service.ts', 'utf8');
const earlyReturnRelease = readFileSync('src/server/bookings/rental-booking-early-return-release-service.ts', 'utf8');
const payment = readFileSync('src/server/payments/rental-payment-service.ts', 'utf8');
const helper = readFileSync('src/server/bookings/rental-booking-write-errors.ts', 'utf8');
const confirmationRoute = readFileSync('app/api/inventory/rentals/holds/[hold-id]/confirm/route.ts', 'utf8');
const cancellationRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/cancel/route.ts', 'utf8');
const rescheduleRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/reschedule/route.ts', 'utf8');
const substitutionRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/unit-substitution/route.ts', 'utf8');
const pickupRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/pickup/route.ts', 'utf8');
const returnRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/return/route.ts', 'utf8');
const earlyReturnReleaseRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/inventory-release/route.ts', 'utf8');
const manualPaymentRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/manual/route.ts', 'utf8');
const refundRoute = readFileSync('app/api/inventory/rentals/bookings/[booking-id]/payments/refunds/route.ts', 'utf8');
const docs = readFileSync('docs/rental-booking-write-failure-handling.md', 'utf8');

const services = [
  confirmation,
  cancellation,
  reschedule,
  substitution,
  fulfillment,
  earlyReturnRelease,
  payment,
];

test('shared classifier recognizes only the expected persistence race and constraint codes', () => {
  assert.match(helper, /code === 'P2034'/);
  assert.match(helper, /code === 'P2002'/);
  assert.match(helper, /code === 'P2003' \|\| code === 'P2004'/);
  assert.match(helper, /retryUniqueConflict \? 'RETRYABLE' : 'CONFLICT'/);
  assert.match(helper, /return 'UNKNOWN'/);
});

test('all durable rental write services use the shared classifier and bounded retries', () => {
  for (const service of services) {
    assert.match(service, /classifyRentalBookingWriteError/);
    assert.doesNotMatch(service, /function prismaErrorCode/);
    assert.match(service, /attempt < 2/);
    assert.match(service, /disposition === 'RETRYABLE'/);
    assert.match(service, /disposition === 'CONFLICT'/);
  }

  for (const replayable of [
    confirmation,
    reschedule,
    substitution,
    fulfillment,
    earlyReturnRelease,
    payment,
  ]) {
    assert.match(replayable, /retryUniqueConflict: true/);
  }
  assert.doesNotMatch(cancellation, /retryUniqueConflict: true/);
});

test('expected persistence failures remain explicit conflicts at every current staff write route', () => {
  assert.match(confirmationRoute, /RentalBookingConflictError/);
  assert.match(confirmationRoute, /return 'conflict'/);
  assert.match(cancellationRoute, /RentalBookingCancellationConflictError/);
  assert.match(cancellationRoute, /return 'conflict'/);
  assert.match(rescheduleRoute, /RentalBookingRescheduleConflictError/);
  assert.match(rescheduleRoute, /return 'conflict'/);
  assert.match(substitutionRoute, /RentalBookingUnitSubstitutionConflictError/);
  assert.match(substitutionRoute, /return 'conflict'/);

  for (const route of [pickupRoute, returnRoute]) {
    assert.match(route, /RentalBookingFulfillmentConflictError/);
    assert.match(route, /return 'conflict'/);
  }

  assert.match(earlyReturnReleaseRoute, /RentalBookingEarlyReturnReleaseConflictError/);
  assert.match(earlyReturnReleaseRoute, /return 'conflict'/);

  for (const route of [manualPaymentRoute, refundRoute]) {
    assert.match(route, /RentalPaymentConflictError/);
    assert.match(route, /return 'payment-conflict'/);
  }
});

test('documentation keeps retries bounded, replay validation explicit, and unknown failures visible', () => {
  assert.match(docs, /seven durable rental write services/);
  assert.match(docs, /three transaction attempts/);
  assert.match(docs, /every other error remains unknown and is rethrown unchanged/);
  assert.match(docs, /Cancellation has no equivalent record-creation replay boundary/);
  assert.match(docs, /Fulfillment replay re-derives/);
  assert.match(docs, /Early-return release replay re-derives/);
  assert.match(docs, /does not relax tenant scope, authorization, advisory locks/);
});
