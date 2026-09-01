import assert from 'node:assert/strict';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Stripe refund integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

process.env.SF_INTEGRATION_MASTER_KEY = Buffer.alloc(32, 13).toString('base64url');

test('Stripe refunds are tenant-safe, serialized, idempotent, and balance bounded', async () => {
  const [{ db }, integrations, refunds] = await Promise.all([
    import('../database.ts'),
    import('../integrations/integration-service.ts'),
    import('./stripe-refund-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const originalFetch = globalThis.fetch;
  const adminA = await db.user.create({ data: { email: `stripe-refund-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `stripe-refund-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `stripe-refund-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Stripe Refund Tenant A', slug: `stripe-refund-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Stripe Refund Tenant B', slug: `stripe-refund-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
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

    async function createPaidBooking(sequence: number) {
      const hold = await db.hospitalityAvailabilityHold.create({ data: {
        organizationId: organizationA.id,
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        idempotencyKey: `stripe-refund-hold-${runId}-${sequence}`,
        arrivalDate: new Date(`2026-10-${10 + sequence}T00:00:00.000Z`),
        departureDate: new Date(`2026-10-${11 + sequence}T00:00:00.000Z`),
        quantity: 1,
        status: 'CONSUMED',
        expiresAt: new Date(`2026-10-${10 + sequence}T01:00:00.000Z`),
        endedAt: new Date(`2026-10-${10 + sequence}T00:01:00.000Z`),
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
        arrivalDate: new Date(`2026-10-${10 + sequence}T00:00:00.000Z`),
        departureDate: new Date(`2026-10-${11 + sequence}T00:00:00.000Z`),
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
    globalThis.fetch = (async (request) => {
      const url = String(request);
      if (!url.endsWith('/refunds')) throw new Error(`Unexpected Stripe refund test request: ${url}`);
      refundCalls += 1;
      const body = new URLSearchParams(String((request as Request).body ?? ''));
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
    globalThis.fetch = (async (request) => {
      const body = new URLSearchParams(String((request as Request).body ?? ''));
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
