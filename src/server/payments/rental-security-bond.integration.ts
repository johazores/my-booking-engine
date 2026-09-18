import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Rental security bond integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + (days * 86_400_000));
}

test('rental security bond is tenant-scoped, append-only, pickup/cancellation guarded, and reference-isolated', async () => {
  const [{ db }, holds, bookings, authority, cancellations, fulfillment, bonds, rentalPayments] = await Promise.all([
    import('../database.ts'),
    import('../inventory/rental-hold-service.ts'),
    import('../bookings/rental-booking-service.ts'),
    import('../bookings/rental-booking-authority-service.ts'),
    import('../bookings/rental-booking-cancellation-service.ts'),
    import('../bookings/rental-booking-fulfillment-service.ts'),
    import('./rental-security-bond-service.ts'),
    import('./rental-payment-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `rental-bond-admin-${runId}@example.test`, status: 'ACTIVE' } });
  const otherAdmin = await db.user.create({ data: { email: `rental-bond-other-${runId}@example.test`, status: 'ACTIVE' } });
  const organization = await db.organization.create({
    data: { name: 'Rental Bond Tenant', slug: `rental-bond-${runId}`.slice(0, 63), kind: 'RENTAL_BUSINESS', timezone: 'Asia/Manila', currency: 'PHP' },
  });
  const otherOrganization = await db.organization.create({
    data: { name: 'Other Rental Bond Tenant', slug: `rental-bond-other-${runId}`.slice(0, 63), kind: 'RENTAL_BUSINESS', timezone: 'Asia/Manila', currency: 'PHP' },
  });
  await Promise.all([
    db.organizationMembership.create({ data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' } }),
    db.organizationMembership.create({ data: { organizationId: otherOrganization.id, userId: otherAdmin.id, status: 'ACTIVE', role: 'ADMIN' } }),
  ]);
  const customer = await db.customer.create({
    data: { organizationId: organization.id, firstName: 'Bond', lastName: 'Customer', email: `rental-bond-customer-${runId}@example.test`, status: 'ACTIVE' },
  });
  const location = await db.rentalLocation.create({
    data: { organizationId: organization.id, name: 'Bond Depot', code: `BD-${runId.slice(0, 8)}`.toUpperCase(), addressLine1: '1 Test Street', city: 'Makati', countryCode: 'PH', timeZone: 'Asia/Manila', status: 'ACTIVE' },
  });
  const unitType = await db.rentalUnitType.create({
    data: { organizationId: organization.id, name: 'Bond Bike', code: `BT-${runId.slice(0, 8)}`.toUpperCase(), currency: 'PHP', defaultDailyRateMinor: 100000, status: 'ACTIVE' },
  });
  const [databaseClock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  assert.ok(databaseClock?.now);
  const startsOn = dateKeyInTimeZone(databaseClock.now, location.timeZone);
  const endsOn = dateKeyInTimeZone(addUtcDays(databaseClock.now, 2), location.timeZone);

  async function createBooking(label: string) {
    const unit = await db.rentalUnit.create({
      data: { organizationId: organization.id, unitTypeId: unitType.id, locationId: location.id, name: `Bond Bike ${label}`, code: `BU-${label}-${runId.slice(0, 6)}`.toUpperCase(), status: 'ACTIVE' },
    });
    const hold = await holds.createRentalAvailabilityHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      hold: { unitId: unit.id, startsOn, endsOn, idempotencyKey: `rental-bond-hold:${label}:${runId}` },
    });
    const review = await authority.reviewRentalBookingConversionAuthority({ organizationId: organization.id, actorUserId: admin.id, holdId: hold.id, customerId: customer.id });
    assert.equal(review.ready, true);
    return bookings.confirmRentalBookingFromHold({
      organizationId: organization.id,
      actorUserId: admin.id,
      confirmation: { holdId: hold.id, customerId: customer.id, idempotencyKey: `rental-bond-booking:${label}:${runId}`, authorityFingerprint: review.authorityFingerprint as string },
    });
  }

  const pickupBooking = await createBooking('pickup');
  const requirement = await bonds.createRentalSecurityBondRequirement({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: pickupBooking.booking.id,
    amountMajor: '500.00',
  });
  assert.equal(requirement.idempotent, false);
  assert.equal(requirement.bond.currency, 'PHP');
  assert.equal(requirement.bond.amountMinor, 50000n);
  const requirementReplay = await bonds.createRentalSecurityBondRequirement({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: pickupBooking.booking.id,
    amountMajor: '500.00',
  });
  assert.equal(requirementReplay.idempotent, true);
  assert.equal(requirementReplay.bond.id, requirement.bond.id);

  await assert.rejects(
    bonds.readRentalSecurityBond({ organizationId: otherOrganization.id, actorUserId: otherAdmin.id, bookingId: pickupBooking.booking.id }),
    /not available/i,
  );
  await assert.rejects(
    db.rentalSecurityBondRequirement.update({ where: { id: requirement.bond.id }, data: { amountMinor: 1n } }),
    /append-only/i,
  );
  await assert.rejects(
    fulfillment.recordRentalBookingPickup({ organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id }),
    /fulfillment contract|security bond|actively collected/i,
  );

  const collectionReference = `BOND-COLLECT-${runId.slice(0, 10)}`;
  const collection = await bonds.recordRentalSecurityBondManualCollection({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: pickupBooking.booking.id,
    reference: collectionReference,
  });
  assert.equal(collection.idempotent, false);
  assert.equal(collection.settlement.state, 'COLLECTED');
  assert.match(collection.transaction.requestFingerprint, /^[a-f0-9]{64}$/);
  const collectionReplay = await bonds.recordRentalSecurityBondManualCollection({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: pickupBooking.booking.id,
    reference: collectionReference,
  });
  assert.equal(collectionReplay.idempotent, true);
  assert.equal(collectionReplay.transaction.id, collection.transaction.id);

  await assert.rejects(
    rentalPayments.recordRentalManualOfflinePayment({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: pickupBooking.booking.id,
      reference: collectionReference,
    }),
    /settlement contract|reference|conflict/i,
  );
  await assert.rejects(
    db.rentalSecurityBondTransaction.delete({ where: { id: collection.transaction.id } }),
    /append-only/i,
  );

  const pickedUp = await fulfillment.recordRentalBookingPickup({ organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id });
  assert.equal(pickedUp.fulfillment.state, 'PICKED_UP');

  const cancellationBooking = await createBooking('cancel');
  const cancellationRequirement = await bonds.createRentalSecurityBondRequirement({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: cancellationBooking.booking.id,
    amountMajor: '750.00',
  });
  assert.equal(cancellationRequirement.bond.amountMinor, 75000n);
  const cancellationCollectionReference = `BOND-CANCEL-${runId.slice(0, 10)}`;
  await bonds.recordRentalSecurityBondManualCollection({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: cancellationBooking.booking.id,
    reference: cancellationCollectionReference,
  });
  const cancellationReason = 'Customer requested cancellation during security-bond integration coverage';
  await assert.rejects(
    cancellations.cancelRentalBooking({
      organizationId: organization.id,
      actorUserId: admin.id,
      bookingId: cancellationBooking.booking.id,
      reason: cancellationReason,
    }),
    /cancellation contract|security bond|release/i,
  );

  const releaseReference = `BOND-RELEASE-${runId.slice(0, 10)}`;
  const release = await bonds.recordRentalSecurityBondManualRelease({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: cancellationBooking.booking.id,
    reference: releaseReference,
  });
  assert.equal(release.settlement.state, 'RELEASED');
  assert.equal(release.transaction.sourceProviderReference, cancellationCollectionReference);
  const releaseReplay = await bonds.recordRentalSecurityBondManualRelease({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: cancellationBooking.booking.id,
    reference: releaseReference,
  });
  assert.equal(releaseReplay.idempotent, true);
  assert.equal(releaseReplay.transaction.id, release.transaction.id);

  const cancelled = await cancellations.cancelRentalBooking({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: cancellationBooking.booking.id,
    reason: cancellationReason,
  });
  assert.equal(cancelled.booking.status, 'CANCELLED');
});
