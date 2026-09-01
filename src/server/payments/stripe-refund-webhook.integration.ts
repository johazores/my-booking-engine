import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) {
  throw new Error('Stripe refund webhook integration tests must run through npm run test:database with TEST_DATABASE_URL.');
}

process.env.SF_INTEGRATION_MASTER_KEY = Buffer.alloc(32, 17).toString('base64url');

const webhookSecret = 'whsec_sf_refund_webhook_integration_secret';

function signStripePayload(payload: string, timestamp: number) {
  const digest = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

test('verified Stripe refund webhooks bind pending claims and finalize refund state idempotently', async () => {
  const [{ db }, integrations, payments, webhooks] = await Promise.all([
    import('../database.ts'),
    import('../integrations/integration-service.ts'),
    import('./stripe-payment-service.ts'),
    import('./stripe-webhook-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const admin = await db.user.create({ data: { email: `stripe-refund-webhook-${runId}@example.test`, status: 'ACTIVE' } });
  const organization = await db.organization.create({ data: { name: 'Stripe Refund Webhook Tenant', slug: `stripe-refund-webhook-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.create({ data: { organizationId: organization.id, userId: admin.id, status: 'ACTIVE', role: 'ADMIN' } });
  await integrations.saveIntegration({
    organizationId: organization.id,
    actorUserId: admin.id,
    providerCode: 'stripe',
    displayName: 'Stripe',
    capabilities: ['payment-refund', 'webhooks'],
    credentials: { secretKey: 'sk_test_sf_refund_webhook', webhookSecret },
  });

  const customer = await db.customer.create({ data: { organizationId: organization.id, firstName: 'Webhook', lastName: 'Guest' } });
  const property = await db.hospitalityProperty.create({ data: { organizationId: organization.id, name: 'Webhook Hotel', code: 'WEBHOOK', timezone: 'UTC', countryCode: 'US' } });
  const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organization.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
  const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organization.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });
  const hold = await db.hospitalityAvailabilityHold.create({ data: {
    organizationId: organization.id,
    propertyId: property.id,
    roomTypeId: roomType.id,
    ratePlanId: ratePlan.id,
    idempotencyKey: `stripe-refund-webhook-hold-${runId}`,
    arrivalDate: new Date('2026-10-20T00:00:00.000Z'),
    departureDate: new Date('2026-10-21T00:00:00.000Z'),
    quantity: 1,
    status: 'CONSUMED',
    expiresAt: new Date('2026-10-20T01:00:00.000Z'),
    endedAt: new Date('2026-10-20T00:01:00.000Z'),
  } });
  const booking = await db.hospitalityBooking.create({ data: {
    organizationId: organization.id,
    propertyId: property.id,
    roomTypeId: roomType.id,
    ratePlanId: ratePlan.id,
    customerId: customer.id,
    holdId: hold.id,
    idempotencyKey: `stripe-refund-webhook-booking-${runId}`,
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    arrivalDate: new Date('2026-10-20T00:00:00.000Z'),
    departureDate: new Date('2026-10-21T00:00:00.000Z'),
    quantity: 1,
    currency: 'USD',
    accommodationSubtotalMinor: 10000n,
    taxTotalMinor: 0n,
    feeTotalMinor: 0n,
    addonTotalMinor: 0n,
    totalMinor: 10000n,
    pricingFingerprint: '9'.repeat(64),
    addonSelections: [],
    confirmedAt: new Date(),
  } });
  const paymentIntentReference = `pi_refund_webhook_${runId.replaceAll('-', '')}`;
  await db.paymentTransaction.create({ data: {
    organizationId: organization.id,
    bookingId: booking.id,
    idempotencyKey: `stripe:capture:webhook:${runId}`,
    requestFingerprint: '8'.repeat(64),
    kind: 'CAPTURE',
    status: 'SUCCEEDED',
    providerCode: 'stripe',
    providerReference: paymentIntentReference,
    currency: 'USD',
    amountMinor: 10000n,
  } });

  const refundFingerprint = payments.paymentRequestFingerprint([
    'stripe',
    'refund',
    booking.id,
    'USD',
    '2500',
    paymentIntentReference,
    'explicit',
  ]);
  const refund = await db.paymentTransaction.create({ data: {
    organizationId: organization.id,
    bookingId: booking.id,
    idempotencyKey: `stripe:refund:webhook:${runId}`,
    requestFingerprint: refundFingerprint,
    kind: 'REFUND',
    status: 'PENDING',
    providerCode: 'stripe',
    providerReference: payments.paymentOperationClaimReference(refundFingerprint),
    currency: 'USD',
    amountMinor: 2500n,
  } });

  const timestamp = Math.floor(Date.now() / 1000);
  const providerEventId = `evt_refund_webhook_${runId.replaceAll('-', '')}`;
  const refundReference = `re_refund_webhook_${runId.replaceAll('-', '')}`;
  const payload = JSON.stringify({
    id: providerEventId,
    type: 'refund.updated',
    created: timestamp,
    data: { object: {
      id: refundReference,
      payment_intent: paymentIntentReference,
      status: 'succeeded',
      currency: 'usd',
      amount: 2500,
    } },
  });

  const processed = await webhooks.ingestStripePaymentWebhook({
    organizationId: organization.id,
    payload,
    signature: signStripePayload(payload, timestamp),
  });
  assert.equal(processed.status, 'PROCESSED');
  assert.equal(processed.processingNote, 'refund-state-applied');
  assert.equal(processed.providerReference, refundReference);
  assert.equal(processed.bookingId, booking.id);

  const persistedRefund = await db.paymentTransaction.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(persistedRefund.providerReference, refundReference);
  assert.equal(persistedRefund.status, 'SUCCEEDED');
  assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus, 'PARTIALLY_REFUNDED');

  const duplicate = await webhooks.ingestStripePaymentWebhook({
    organizationId: organization.id,
    payload,
    signature: signStripePayload(payload, timestamp),
  });
  assert.equal(duplicate.id, processed.id);
  assert.equal(await db.paymentWebhookEvent.count({ where: { organizationId: organization.id, providerEventId } }), 1);

  const alteredPayload = JSON.stringify({
    id: providerEventId,
    type: 'refund.updated',
    created: timestamp,
    data: { object: {
      id: refundReference,
      payment_intent: paymentIntentReference,
      status: 'succeeded',
      currency: 'usd',
      amount: 2600,
    } },
  });
  await assert.rejects(
    webhooks.ingestStripePaymentWebhook({
      organizationId: organization.id,
      payload: alteredPayload,
      signature: signStripePayload(alteredPayload, timestamp),
    }),
    /different content/i,
  );
});
