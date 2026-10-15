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
  const [{ db }, holds, bookings, authority, cancellations, fulfillment, bonds, rentalPayments, inspections, damageCases, liabilities, forfeitures, damagePayments, bondGuards] = await Promise.all([
    import('../database.ts'),
    import('../inventory/rental-hold-service.ts'),
    import('../bookings/rental-booking-service.ts'),
    import('../bookings/rental-booking-authority-service.ts'),
    import('../bookings/rental-booking-cancellation-service.ts'),
    import('../bookings/rental-booking-fulfillment-service.ts'),
    import('./rental-security-bond-service.ts'),
    import('./rental-payment-service.ts'),
    import('../bookings/rental-return-inspection-service.ts'),
    import('../bookings/rental-damage-case-service.ts'),
    import('../bookings/rental-damage-liability-service.ts'),
    import('./rental-security-bond-forfeiture-service.ts'),
    import('./rental-damage-settlement-service.ts'),
    import('../bookings/rental-booking-security-bond-guard-service.ts'),
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

  // Real custody -> inspection -> assessed damage -> liability -> forfeiture.
  // This exercises the applied PostgreSQL trigger, not just source regexes.
  const returned = await fulfillment.recordRentalBookingReturn({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
  });
  assert.equal(returned.fulfillment.state, 'RETURNED');
  const inspection = await inspections.recordRentalReturnInspection({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
    inspection: { outcome: 'DAMAGE_REPORTED', notes: 'Damage found on return' },
  });
  const damageCase = await damageCases.openRentalDamageCase({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
    damageCase: { summary: 'Returned bike requires repair' },
  });
  await damageCases.assessRentalDamageCase({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
    damageCaseId: damageCase.damageCase.id,
    assessment: { estimatedRepairCostMajor: '500.00', notes: 'Verified repair estimate' },
  });
  await damageCases.closeRentalDamageCase({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
    damageCaseId: damageCase.damageCase.id,
    closure: { notes: 'Assessment complete and responsibility reviewed' },
  });
  const decision = await liabilities.decideRentalDamageLiability({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
    damageCaseId: damageCase.damageCase.id,
    decision: { outcome: 'CUSTOMER_LIABLE', liableAmountMajor: '500.00', reason: 'Damage attributable to customer use' },
  });
  assert.equal(inspection.inspection.unitId, returned.event.unitId);
  assert.ok(returned.event.occurredAt.getTime() <= decision.decision.decidedAt.getTime());

  // Ensure the new migration was applied and its guard is enabled on the
  // disposable database. A checked-in SQL file alone does not prove this.
  const chronologyTriggers = await db.$queryRaw<Array<{ enabled: string }>>`
    SELECT t.tgenabled::text AS "enabled"
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'rental_security_bond_forfeitures'
       AND t.tgname = 'rental_security_bond_forfeitures_chronology_guard'
       AND NOT t.tgisinternal
  `;
  assert.deepEqual(chronologyTriggers, [{ enabled: 'O' }]);

  const forfeiture = await forfeitures.forfeitRentalSecurityBondAgainstDamageLiability({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
  });
  assert.equal(forfeiture.idempotent, false);
  assert.equal(forfeiture.settlement.state, 'FORFEITED');
  assert.equal(forfeiture.forfeiture.liabilityDecisionId, decision.decision.id);
  assert.equal(forfeiture.forfeiture.collectionTransactionId, collection.transaction.id);
  const forfeitureReplay = await forfeitures.forfeitRentalSecurityBondAgainstDamageLiability({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
  });
  assert.equal(forfeitureReplay.idempotent, true);
  assert.equal(forfeitureReplay.forfeiture.id, forfeiture.forfeiture.id);
  const retainedBond = await bonds.readRentalSecurityBond({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
  });
  assert.equal(retainedBond.settlement?.state, 'FORFEITED');

  await assert.rejects(
    forfeitures.readRentalSecurityBondForfeiture({
      organizationId: otherOrganization.id, actorUserId: otherAdmin.id, bookingId: pickupBooking.booking.id,
    }),
    /not available/i,
  );
  await assert.rejects(
    bonds.recordRentalSecurityBondManualRelease({
      organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
      reference: `BOND-AFTER-FORFEIT-${runId.slice(0, 10)}`,
    }),
    /forfeit|settlement|release|contract/i,
  );
  await assert.rejects(
    damagePayments.recordRentalDamageManualOfflinePayment({
      organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
      damageCaseId: damageCase.damageCase.id,
      reference: `DAMAGE-AFTER-FORFEIT-${runId.slice(0, 10)}`,
    }),
    /forfeit|settlement|conflict|contract/i,
  );
  await assert.rejects(
    db.rentalSecurityBondForfeiture.delete({ where: { id: forfeiture.forfeiture.id } }),
    /append-only/i,
  );


  // The same immutable forfeiture must reconcile in every authorized reader.
  // Booking-only callers must not receive financial evidence.
  const damageSettlement = await damagePayments.readRentalDamageSettlement({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
    damageCaseId: damageCase.damageCase.id,
  });
  assert.equal(damageSettlement.forfeitureId, forfeiture.forfeiture.id);
  assert.equal(damageSettlement.transactions.length, 0);
  const operationalGuard = await bondGuards.readRentalBookingSecurityBondGuard({
    organizationId: organization.id, actorUserId: admin.id, bookingId: pickupBooking.booking.id,
  });
  assert.deepEqual(operationalGuard, {
    required: true, state: 'FORFEITED', blocksPickup: true, blocksCancellation: false,
  });
  await assert.rejects(
    bondGuards.readRentalBookingSecurityBondGuard({
      organizationId: otherOrganization.id, actorUserId: otherAdmin.id, bookingId: pickupBooking.booking.id,
    }),
    /not available/i,
  );
  await assert.rejects(
    damagePayments.readRentalDamageSettlement({
      organizationId: otherOrganization.id, actorUserId: otherAdmin.id, bookingId: pickupBooking.booking.id,
      damageCaseId: damageCase.damageCase.id,
    }),
    /retained customer-liable damage decision/i,
  );
  await assert.rejects(
    forfeitures.forfeitRentalSecurityBondAgainstDamageLiability({
      organizationId: otherOrganization.id, actorUserId: otherAdmin.id, bookingId: pickupBooking.booking.id,
    }),
    /not available|confirmed tenant rental booking/i,
  );

  // A direct database insert must not bind Tenant B to Tenant A bond,
  // collection, booking or liability evidence, even with otherwise valid IDs.
  await assert.rejects(
    db.rentalSecurityBondForfeiture.create({
      data: {
        organizationId: otherOrganization.id,
        bookingId: pickupBooking.booking.id,
        bondId: requirement.bond.id,
        liabilityDecisionId: decision.decision.id,
        collectionTransactionId: collection.transaction.id,
        idempotencyKey: forfeiture.forfeiture.idempotencyKey,
        currency: 'PHP',
        amountMinor: 50000n,
        forfeitedByUserId: otherAdmin.id,
      },
    }),
    /retained bond requirement|foreign key/i,
  );
  await assert.rejects(
    db.rentalSecurityBondForfeiture.update({
      where: { id: forfeiture.forfeiture.id },
      data: { amountMinor: 1n },
    }),
    /append-only/i,
  );

  // Replays and rejected competing actions must not produce another
  // financial disposition, damage payment, or forfeiture audit event.
  const [forfeitureCount, bondTransactions, damagePaymentsCount, forfeitureAudits] = await Promise.all([
    db.rentalSecurityBondForfeiture.count({
      where: { organizationId: organization.id, bookingId: pickupBooking.booking.id },
    }),
    db.rentalSecurityBondTransaction.count({
      where: { organizationId: organization.id, bookingId: pickupBooking.booking.id, bondId: requirement.bond.id },
    }),
    db.rentalDamageSettlementTransaction.count({
      where: { organizationId: organization.id, liabilityDecisionId: decision.decision.id },
    }),
    db.auditEvent.count({
      where: {
        organizationId: organization.id,
        action: 'payment.rental.security-bond-forfeited',
        resourceType: 'rental-security-bond-forfeiture',
        resourceId: forfeiture.forfeiture.id,
      },
    }),
  ]);
  assert.equal(forfeitureCount, 1);
  assert.equal(bondTransactions, 1);
  assert.equal(damagePaymentsCount, 0);
  assert.equal(forfeitureAudits, 1);

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

  const cancelledRequirementReplay = await bonds.createRentalSecurityBondRequirement({
    organizationId: organization.id,
    actorUserId: admin.id,
    bookingId: cancellationBooking.booking.id,
    amountMajor: '750.00',
  });
  assert.equal(cancelledRequirementReplay.idempotent, true);
  assert.equal(cancelledRequirementReplay.bond.id, cancellationRequirement.bond.id);
});
