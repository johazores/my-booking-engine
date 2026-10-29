import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Stripe refund integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

process.env.SF_INTEGRATION_MASTER_KEY = Buffer.alloc(32, 13).toString('base64url');

test('Stripe refunds are tenant-safe, serialized, idempotent, and balance bounded', async (t) => {
  const [{ db }, integrations, refunds] = await Promise.all([
    import('../database.ts'),
    import('../integrations/integration-service.ts'),
    import('./stripe-refund-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const adminAId = crypto.randomUUID();
  const staffAId = crypto.randomUUID();
  const adminBId = crypto.randomUUID();
  const organizationAId = crypto.randomUUID();
  const organizationBId = crypto.randomUUID();
  // Register cleanup before the first write, including partial fixture setup failures.
  t.after(async () => {
    try {
      await db.paymentWebhookEvent.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
      await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
      await db.paymentTransaction.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
      await db.hospitalityBooking.deleteMany({ where: { organizationId: organizationAId } });
      await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationAId } });
      await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationAId } });
      await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationAId } });
      await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationAId } });
      await db.customer.deleteMany({ where: { organizationId: organizationAId } });
      await db.integration.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
      await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } });
      await db.organization.deleteMany({ where: { id: { in: [organizationAId, organizationBId] } } });
      await db.user.deleteMany({ where: { id: { in: [adminAId, staffAId, adminBId] } } });
    } finally {
      await db.$disconnect();
    }
  });

  const originalFetch = globalThis.fetch;
  const adminA = await db.user.create({ data: { id: adminAId, email: `stripe-refund-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { id: staffAId, email: `stripe-refund-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { id: adminBId, email: `stripe-refund-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { id: organizationAId, name: 'Stripe Refund Tenant A', slug: `stripe-refund-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { id: organizationBId, name: 'Stripe Refund Tenant B', slug: `stripe-refund-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });


  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  try {
    await integrations.saveIntegration({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      providerCode: 'stripe',
      displayName: 'Stripe',
      capabilities: ['payment-refund'],
      credentials: { secretKey: 'sk_test_sf_refund_tenant_a' },
    });

    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Refund', lastName: 'Guest' } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Refund Hotel', code: 'REFUND', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });

    const [databaseClock] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
    assert.ok(databaseClock?.now);
    const databaseNow = databaseClock.now;
    const stayDate = (offset: number) => new Date(Date.UTC(
      databaseNow.getUTCFullYear(), databaseNow.getUTCMonth(), databaseNow.getUTCDate() + 30 + offset,
    ));

    async function createPaidBooking(sequence: number) {
      const hold = await db.hospitalityAvailabilityHold.create({ data: {
        organizationId: organizationA.id,
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        idempotencyKey: `stripe-refund-hold-${runId}-${sequence}`,
        arrivalDate: stayDate(sequence),
        departureDate: stayDate(sequence + 1),
        quantity: 1,
        status: 'CONSUMED',
        expiresAt: new Date(databaseNow.getTime() + 3_600_000),
        endedAt: databaseNow,
      } });
      const booking = await db.hospitalityBooking.create({ data: {
        organizationId: organizationA.id,
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        customerId: customer.id,
        holdId: hold.id,
        idempotencyKey: `stripe-refund-booking-${runId}-${sequence}`,
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        arrivalDate: stayDate(sequence),
        departureDate: stayDate(sequence + 1),
        quantity: 1,
        currency: 'USD',
        accommodationSubtotalMinor: 10000n,
        taxTotalMinor: 0n,
        feeTotalMinor: 0n,
        addonTotalMinor: 0n,
        totalMinor: 10000n,
        pricingFingerprint: String(sequence).padStart(64, 'b').slice(-64),
        addonSelections: [],
        confirmedAt: new Date(),
      } });
      await db.paymentTransaction.create({ data: {
        organizationId: organizationA.id,
        bookingId: booking.id,
        idempotencyKey: `stripe:capture:refund-test:${sequence}`,
        requestFingerprint: String(sequence).padStart(64, 'c').slice(-64),
        kind: 'CAPTURE',
        status: 'SUCCEEDED',
        providerCode: 'stripe',
        providerReference: `pi_refund_source_${sequence}_${runId.replaceAll('-', '')}`,
        currency: 'USD',
        amountMinor: 10000n,
      } });
      return booking;
    }

    let refundCalls = 0;
    globalThis.fetch = (async (request, init) => {
      const url = String(request);
      if (!url.endsWith('/refunds')) throw new Error(`Unexpected Stripe refund test request: ${url}`);
      refundCalls += 1;
      const body = new URLSearchParams(String(init?.body ?? ''));
      const amount = Number(body.get('amount'));
      return new Response(JSON.stringify({ id: `re_sf_${refundCalls}`, payment_intent: body.get('payment_intent'), status: 'succeeded', amount, currency: 'usd' }), { status: 200 });
    }) as typeof fetch;

    const booking = await createPaidBooking(1);
    await assert.rejects(
      refunds.refundStripeBookingPayment({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, idempotencyKey: 'stripe:refund:permission', amountMinor: '1000' }),
      /permission/i,
    );
    await assert.rejects(
      refunds.refundStripeBookingPayment({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id, idempotencyKey: 'stripe:refund:cross-tenant', amountMinor: '1000' }),
      /not available/i,
    );
    assert.equal(refundCalls, 0);

    const partial = await refunds.refundStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'stripe:refund:partial',
      amountMinor: '2500',
    });
    assert.equal(partial.status, 'SUCCEEDED');
    assert.equal(partial.amountMinor, 2500n);
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus, 'PARTIALLY_REFUNDED');
    assert.equal(refundCalls, 1);

    const retry = await refunds.refundStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'stripe:refund:partial',
      amountMinor: '2500',
    });
    assert.equal(retry.id, partial.id);
    assert.equal(refundCalls, 1);
    await assert.rejects(
      refunds.refundStripeBookingPayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'stripe:refund:partial', amountMinor: '2501' }),
      /different operation/i,
    );
    await assert.rejects(
      refunds.refundStripeBookingPayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'stripe:refund:over', amountMinor: '7501' }),
      /remaining refundable balance/i,
    );
    assert.equal(refundCalls, 1);

    const full = await refunds.refundStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'stripe:refund:remaining',
    });
    assert.equal(full.status, 'SUCCEEDED');
    assert.equal(full.amountMinor, 7500n);
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus, 'REFUNDED');
    assert.equal(refundCalls, 2);

    const fullRetry = await refunds.refundStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'stripe:refund:remaining',
    });
    assert.equal(fullRetry.id, full.id);
    assert.equal(refundCalls, 2);
    await assert.rejects(
      refunds.refundStripeBookingPayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'stripe:refund:after-full', amountMinor: '1' }),
      /does not accept a refund|fully refunded/i,
    );

    const concurrencyBooking = await createPaidBooking(2);
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = (async (_request, init) => {
      const body = new URLSearchParams(String(init?.body ?? ''));
      refundCalls += 1;
      entered();
      await releasePromise;
      return new Response(JSON.stringify({ id: 're_sf_concurrent', payment_intent: body.get('payment_intent'), status: 'succeeded', amount: Number(body.get('amount')), currency: 'usd' }), { status: 200 });
    }) as typeof fetch;

    const first = refunds.refundStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: concurrencyBooking.id,
      idempotencyKey: 'stripe:refund:concurrent-1',
      amountMinor: '1000',
    });
    await enteredPromise;
    await assert.rejects(
      refunds.refundStripeBookingPayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: concurrencyBooking.id, idempotencyKey: 'stripe:refund:concurrent-2', amountMinor: '1000' }),
      /pending Stripe refund/i,
    );
    release();
    await first;

    // Direct-write fixtures must retain each booking's own captured payment source.
    const concurrencySourceReference = (await db.paymentTransaction.findFirstOrThrow({
      where: {
        organizationId: organizationA.id,
        bookingId: concurrencyBooking.id,
        kind: 'CAPTURE',
        providerCode: 'stripe',
      },
      select: { providerReference: true },
    })).providerReference;

    // The database must reject a reused real Stripe Refund ID even when another
    // write bypasses the service's read-time ownership checks.
    const duplicateRefundCases = [
      { bookingId: booking.id, kind: 'REFUND' as const },
      { bookingId: concurrencyBooking.id, kind: 'REFUND' as const },
      { bookingId: concurrencyBooking.id, kind: 'CAPTURE' as const },
    ];
    for (const [index, candidate] of duplicateRefundCases.entries()) {
      await assert.rejects(
        db.paymentTransaction.create({ data: {
          organizationId: organizationA.id,
          bookingId: candidate.bookingId,
          idempotencyKey: `stripe:refund:reference-collision:${runId}:${index}`,
          kind: candidate.kind,
          status: 'FAILED',
          providerCode: 'stripe',
          providerReference: partial.providerReference,
          sourceProviderReference: candidate.kind === 'REFUND'
            ? (candidate.bookingId === booking.id ? partial.sourceProviderReference : concurrencySourceReference)
            : null,
          currency: 'USD',
          amountMinor: 100n,
        } }),
        (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002',
      );
    }

    // Concurrent direct writes must have one winner even without service-level locks.
    const raceReference = `re_sf_database_race_${runId.replaceAll('-', '')}`;
    const concurrentClaims = await Promise.allSettled(
      [booking.id, concurrencyBooking.id].map((bookingId, index) =>
        db.paymentTransaction.create({ data: {
          organizationId: organizationA.id,
          bookingId,
          idempotencyKey: `stripe:refund:reference-race:${runId}:${index}`,
          kind: 'REFUND',
          status: 'FAILED',
          providerCode: 'stripe',
          providerReference: raceReference,
          sourceProviderReference: bookingId === booking.id ? partial.sourceProviderReference : concurrencySourceReference,
          currency: 'USD',
          amountMinor: 100n,
        } }),
      ),
    );
    assert.equal(concurrentClaims.filter((result) => result.status === 'fulfilled').length, 1);
    const rejectedClaims = concurrentClaims.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    assert.equal(rejectedClaims.length, 1);
    assert.equal((rejectedClaims[0]?.reason as { code?: string }).code, 'P2002');
    assert.equal(await db.paymentTransaction.count({
      where: { organizationId: organizationA.id, providerCode: 'stripe', providerReference: raceReference },
    }), 1);

    // Updating an existing Stripe row must not bypass the same uniqueness boundary.
    const mutableRefund = await db.paymentTransaction.create({ data: {
      organizationId: organizationA.id,
      bookingId: concurrencyBooking.id,
      idempotencyKey: `stripe:refund:reference-update:${runId}`,
      kind: 'REFUND',
      status: 'FAILED',
      providerCode: 'stripe',
      providerReference: `re_sf_mutable_${runId.replaceAll('-', '')}`,
      sourceProviderReference: concurrencySourceReference,
      currency: 'USD',
      amountMinor: 100n,
    } });
    await assert.rejects(
      db.paymentTransaction.update({
        where: { id: mutableRefund.id },
        data: { providerReference: partial.providerReference },
      }),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002',
    );
    assert.equal(
      (await db.paymentTransaction.findUniqueOrThrow({ where: { id: mutableRefund.id } })).providerReference,
      mutableRefund.providerReference,
    );

    // Identical external text from another provider is independent, but changing
    // that row into the Stripe namespace must be rejected without modifying it.
    const manual = await db.paymentTransaction.create({ data: {
      organizationId: organizationA.id,
      bookingId: booking.id,
      idempotencyKey: `manual:refund:reference-namespace:${runId}`,
      kind: 'REFUND',
      status: 'FAILED',
      providerCode: 'manual',
      providerReference: partial.providerReference,
      currency: 'USD',
      amountMinor: 100n,
    } });
    assert.equal(manual.providerReference, partial.providerReference);
    await assert.rejects(
      db.paymentTransaction.update({ where: { id: manual.id }, data: { providerCode: 'stripe' } }),
      (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002',
    );
    assert.equal(
      (await db.paymentTransaction.findUniqueOrThrow({ where: { id: manual.id } })).providerCode,
      'manual',
    );
    await db.paymentTransaction.delete({ where: { id: manual.id } });

    const audits = await db.auditEvent.findMany({
      where: { organizationId: organizationA.id, resourceType: 'payment-transaction', action: { startsWith: 'payment.refund-' } },
      select: { afterData: true },
    });
    const auditText = JSON.stringify(audits);
    assert.equal(auditText.includes('pi_refund_source_'), false);
    assert.equal(auditText.includes('re_sf_'), false);
    assert.equal(auditText.includes('sk_test_'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
