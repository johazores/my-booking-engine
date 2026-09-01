import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!testDatabaseUrl || databaseUrl !== testDatabaseUrl) throw new Error('Stripe payment integration tests must run through npm run test:database with TEST_DATABASE_URL.');

const integrationMasterKey = Buffer.alloc(32, 7).toString('base64url');
const webhookSecretA = 'whsec_sf_integration_test_a';
const webhookSecretB = 'whsec_sf_integration_test_b';
process.env.SF_INTEGRATION_MASTER_KEY = integrationMasterKey;

function stripeSignature(payload: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function paymentIntentEvent(input: {
  eventId: string;
  organizationId: string;
  bookingId: string;
  providerReference: string;
  status: string;
  amountMinor?: number;
  amountReceivedMinor?: number;
}) {
  return JSON.stringify({
    id: input.eventId,
    type: input.status === 'succeeded' ? 'payment_intent.succeeded' : 'payment_intent.amount_capturable_updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: input.providerReference,
        status: input.status,
        amount: input.amountMinor ?? 12345,
        amount_received: input.amountReceivedMinor ?? 0,
        currency: 'usd',
        metadata: {
          sf_organization_id: input.organizationId,
          sf_booking_id: input.bookingId,
        },
      },
    },
  });
}

test('Stripe payment persistence serializes provider calls and reconciles verified provider truth', async () => {
  const [{ db }, integrations, stripePayments, reconciliation, webhooks] = await Promise.all([
    import('../database.ts'),
    import('../integrations/integration-service.ts'),
    import('./stripe-payment-service.ts'),
    import('./stripe-reconciliation-service.ts'),
    import('./stripe-webhook-service.ts'),
  ]);

  const runId = crypto.randomUUID();
  const originalFetch = globalThis.fetch;
  const adminA = await db.user.create({ data: { email: `stripe-admin-a-${runId}@example.test`, status: 'ACTIVE' } });
  const staffA = await db.user.create({ data: { email: `stripe-staff-a-${runId}@example.test`, status: 'ACTIVE' } });
  const adminB = await db.user.create({ data: { email: `stripe-admin-b-${runId}@example.test`, status: 'ACTIVE' } });
  const organizationA = await db.organization.create({ data: { name: 'Stripe Tenant A', slug: `stripe-a-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  const organizationB = await db.organization.create({ data: { name: 'Stripe Tenant B', slug: `stripe-b-${runId}`.slice(0, 63), kind: 'HOTEL', currency: 'USD' } });
  await db.organizationMembership.createMany({ data: [
    { organizationId: organizationA.id, userId: adminA.id, status: 'ACTIVE', role: 'ADMIN' },
    { organizationId: organizationA.id, userId: staffA.id, status: 'ACTIVE', role: 'STAFF' },
    { organizationId: organizationB.id, userId: adminB.id, status: 'ACTIVE', role: 'ADMIN' },
  ] });

  const bookingIds: string[] = [];
  try {
    await integrations.saveIntegration({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      providerCode: 'stripe',
      displayName: 'Stripe',
      capabilities: ['payment-authorize', 'payment-capture', 'webhooks'],
      credentials: { secretKey: 'sk_test_sf_tenant_a', webhookSecret: webhookSecretA },
    });
    await integrations.saveIntegration({
      organizationId: organizationB.id,
      actorUserId: adminB.id,
      providerCode: 'stripe',
      displayName: 'Stripe',
      capabilities: ['payment-authorize', 'payment-capture', 'webhooks'],
      credentials: { secretKey: 'sk_test_sf_tenant_b', webhookSecret: webhookSecretB },
    });

    const integrationRow = await db.integration.findUniqueOrThrow({
      where: { organizationId_providerCode: { organizationId: organizationA.id, providerCode: 'stripe' } },
    });
    assert.equal(integrationRow.encryptedCredentials.includes('sk_test_sf_tenant_a'), false);
    assert.equal(integrationRow.encryptedCredentials.includes(webhookSecretA), false);
    const visibleIntegrations = await integrations.listIntegrations({ organizationId: organizationA.id, actorUserId: adminA.id });
    assert.equal(JSON.stringify(visibleIntegrations).includes('encryptedCredentials'), false);
    await assert.rejects(
      integrations.listIntegrations({ organizationId: organizationA.id, actorUserId: staffA.id }),
      /permission/i,
    );

    const customer = await db.customer.create({ data: { organizationId: organizationA.id, firstName: 'Stripe', lastName: 'Guest' } });
    const property = await db.hospitalityProperty.create({ data: { organizationId: organizationA.id, name: 'Stripe Hotel', code: 'STRIPE', timezone: 'UTC', countryCode: 'US' } });
    const roomType = await db.hospitalityRoomType.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Room', code: 'ROOM', maxOccupancy: 2 } });
    const ratePlan = await db.hospitalityRatePlan.create({ data: { organizationId: organizationA.id, propertyId: property.id, name: 'Flexible', code: 'FLEX' } });

    async function createBooking(sequence: number) {
      const hold = await db.hospitalityAvailabilityHold.create({ data: {
        organizationId: organizationA.id,
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        idempotencyKey: `stripe-test-hold-${sequence}`,
        arrivalDate: new Date(`2026-09-${10 + sequence}T00:00:00.000Z`),
        departureDate: new Date(`2026-09-${11 + sequence}T00:00:00.000Z`),
        quantity: 1,
        status: 'CONSUMED',
        expiresAt: new Date(`2026-09-${10 + sequence}T01:00:00.000Z`),
        endedAt: new Date(`2026-09-${10 + sequence}T00:01:00.000Z`),
      } });
      const booking = await db.hospitalityBooking.create({ data: {
        organizationId: organizationA.id,
        propertyId: property.id,
        roomTypeId: roomType.id,
        ratePlanId: ratePlan.id,
        customerId: customer.id,
        holdId: hold.id,
        idempotencyKey: `stripe-test-booking-${sequence}`,
        status: 'CONFIRMED',
        paymentStatus: 'UNPAID',
        arrivalDate: new Date(`2026-09-${10 + sequence}T00:00:00.000Z`),
        departureDate: new Date(`2026-09-${11 + sequence}T00:00:00.000Z`),
        quantity: 1,
        currency: 'USD',
        accommodationSubtotalMinor: 12345n,
        taxTotalMinor: 0n,
        feeTotalMinor: 0n,
        addonTotalMinor: 0n,
        totalMinor: 12345n,
        pricingFingerprint: String(sequence).padStart(64, 'a').slice(-64),
        addonSelections: [],
        confirmedAt: new Date(`2026-09-${10 + sequence}T00:01:00.000Z`),
      } });
      bookingIds.push(booking.id);
      return booking;
    }

    const booking = await createBooking(1);
    let authorizeFetchCalls = 0;
    let releaseAuthorization!: () => void;
    let providerEntered!: () => void;
    const providerEnteredPromise = new Promise<void>((resolve) => { providerEntered = resolve; });
    const providerReleasePromise = new Promise<void>((resolve) => { releaseAuthorization = resolve; });
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith('/payment_intents')) {
        authorizeFetchCalls += 1;
        providerEntered();
        await providerReleasePromise;
        return new Response(JSON.stringify({ id: 'pi_sf_authorized_1', status: 'requires_capture', amount: 12345, amount_received: 0, currency: 'usd' }), { status: 200 });
      }
      if (url.endsWith('/payment_intents/pi_sf_authorized_1/capture')) {
        return new Response(JSON.stringify({ id: 'pi_sf_authorized_1', status: 'succeeded', amount: 12345, amount_received: 12345, currency: 'usd' }), { status: 200 });
      }
      throw new Error(`Unexpected Stripe test request: ${url}`);
    }) as typeof fetch;

    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({ organizationId: organizationA.id, actorUserId: staffA.id, bookingId: booking.id, idempotencyKey: 'stripe:auth:permission', paymentMethodReference: 'pm_sf_1' }),
      /permission/i,
    );
    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({ organizationId: organizationB.id, actorUserId: adminB.id, bookingId: booking.id, idempotencyKey: 'stripe:auth:cross-tenant', paymentMethodReference: 'pm_sf_1' }),
      /not available/i,
    );
    assert.equal(authorizeFetchCalls, 0);

    const firstAuthorizationPromise = stripePayments.authorizeStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'stripe:auth:1',
      paymentMethodReference: 'pm_sf_1',
    });
    await providerEnteredPromise;

    const pendingClaim = await db.paymentTransaction.findUniqueOrThrow({
      where: { organizationId_idempotencyKey: { organizationId: organizationA.id, idempotencyKey: 'stripe:auth:1' } },
    });
    assert.equal(pendingClaim.status, 'PENDING');
    assert.match(pendingClaim.providerReference, /^sf_claim_[0-9a-f]{64}$/);

    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'stripe:auth:parallel', paymentMethodReference: 'pm_sf_parallel' }),
      /active or successful Stripe authorization/i,
    );
    assert.equal(authorizeFetchCalls, 1);

    releaseAuthorization();
    const authorization = await firstAuthorizationPromise;
    assert.equal(authorization.status, 'SUCCEEDED');
    assert.equal(authorization.providerReference, 'pi_sf_authorized_1');
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus, 'AUTHORIZED');

    const exactAuthorizationRetry = await stripePayments.authorizeStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'stripe:auth:1',
      paymentMethodReference: 'pm_sf_1',
    });
    assert.equal(exactAuthorizationRetry.id, authorization.id);
    assert.equal(authorizeFetchCalls, 1);
    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: booking.id, idempotencyKey: 'stripe:auth:1', paymentMethodReference: 'pm_sf_changed' }),
      /different operation/i,
    );

    const capture = await stripePayments.captureStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: booking.id,
      idempotencyKey: 'stripe:capture:1',
    });
    assert.equal(capture.kind, 'CAPTURE');
    assert.equal(capture.status, 'SUCCEEDED');
    assert.equal(capture.providerReference, authorization.providerReference);
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: booking.id } })).paymentStatus, 'PAID');

    const bookingForReconciliation = await createBooking(2);
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith('/payment_intents')) {
        return new Response(JSON.stringify({ id: 'pi_sf_pending_2', status: 'processing', amount: 12345, amount_received: 0, currency: 'usd' }), { status: 200 });
      }
      if (url.endsWith('/payment_intents/pi_sf_pending_2')) {
        return new Response(JSON.stringify({ id: 'pi_sf_pending_2', status: 'requires_capture', amount: 12345, amount_received: 0, amount_capturable: 12345, currency: 'usd' }), { status: 200 });
      }
      throw new Error(`Unexpected Stripe reconciliation request: ${url}`);
    }) as typeof fetch;

    const pendingAuthorization = await stripePayments.authorizeStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: bookingForReconciliation.id,
      idempotencyKey: 'stripe:auth:reconcile',
      paymentMethodReference: 'pm_sf_reconcile',
    });
    assert.equal(pendingAuthorization.status, 'PENDING');
    assert.equal(pendingAuthorization.providerReference, 'pi_sf_pending_2');

    await assert.rejects(
      reconciliation.reconcileStripePaymentTransaction({ organizationId: organizationB.id, actorUserId: adminB.id, transactionId: pendingAuthorization.id }),
      /not available/i,
    );
    const reconciledAuthorization = await reconciliation.reconcileStripePaymentTransaction({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      transactionId: pendingAuthorization.id,
    });
    assert.equal(reconciledAuthorization.status, 'SUCCEEDED');
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: bookingForReconciliation.id } })).paymentStatus, 'AUTHORIZED');

    const bookingForAmbiguousRetry = await createBooking(3);
    let ambiguousAttempts = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (!url.endsWith('/payment_intents')) throw new Error(`Unexpected Stripe ambiguous-retry request: ${url}`);
      ambiguousAttempts += 1;
      if (ambiguousAttempts === 1) {
        return new Response(JSON.stringify({ error: { message: 'temporary provider outage' } }), { status: 503 });
      }
      return new Response(JSON.stringify({ id: 'pi_sf_ambiguous_retry_3', status: 'requires_capture', amount: 12345, amount_received: 0, currency: 'usd' }), { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        bookingId: bookingForAmbiguousRetry.id,
        idempotencyKey: 'stripe:auth:ambiguous',
        paymentMethodReference: 'pm_sf_ambiguous',
      }),
      /provider outage/i,
    );
    const ambiguousClaim = await db.paymentTransaction.findUniqueOrThrow({
      where: { organizationId_idempotencyKey: { organizationId: organizationA.id, idempotencyKey: 'stripe:auth:ambiguous' } },
    });
    assert.equal(ambiguousClaim.status, 'PENDING');
    assert.match(ambiguousClaim.providerReference, /^sf_claim_[0-9a-f]{64}$/);
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: bookingForAmbiguousRetry.id } })).paymentStatus, 'UNPAID');
    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({ organizationId: organizationA.id, actorUserId: adminA.id, bookingId: bookingForAmbiguousRetry.id, idempotencyKey: 'stripe:auth:ambiguous-other', paymentMethodReference: 'pm_sf_other' }),
      /active or successful Stripe authorization/i,
    );
    const recoveredAmbiguousClaim = await stripePayments.authorizeStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: bookingForAmbiguousRetry.id,
      idempotencyKey: 'stripe:auth:ambiguous',
      paymentMethodReference: 'pm_sf_ambiguous',
    });
    assert.equal(recoveredAmbiguousClaim.id, ambiguousClaim.id);
    assert.equal(recoveredAmbiguousClaim.status, 'SUCCEEDED');
    assert.equal(recoveredAmbiguousClaim.providerReference, 'pi_sf_ambiguous_retry_3');
    assert.equal(ambiguousAttempts, 2);

    const bookingForDefinitiveRetry = await createBooking(4);
    let definitiveAttempts = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (!url.endsWith('/payment_intents')) throw new Error(`Unexpected Stripe definitive-retry request: ${url}`);
      definitiveAttempts += 1;
      if (definitiveAttempts === 1) {
        return new Response(JSON.stringify({ error: { type: 'card_error', code: 'card_declined', message: 'Card declined' } }), { status: 402 });
      }
      return new Response(JSON.stringify({ id: 'pi_sf_decline_retry_4', status: 'requires_capture', amount: 12345, amount_received: 0, currency: 'usd' }), { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        bookingId: bookingForDefinitiveRetry.id,
        idempotencyKey: 'stripe:auth:declined',
        paymentMethodReference: 'pm_sf_declined',
      }),
      /Card declined/i,
    );
    const failedClaim = await db.paymentTransaction.findUniqueOrThrow({
      where: { organizationId_idempotencyKey: { organizationId: organizationA.id, idempotencyKey: 'stripe:auth:declined' } },
    });
    assert.equal(failedClaim.status, 'FAILED');
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: bookingForDefinitiveRetry.id } })).paymentStatus, 'FAILED');
    const recoveredDecline = await stripePayments.authorizeStripeBookingPayment({
      organizationId: organizationA.id,
      actorUserId: adminA.id,
      bookingId: bookingForDefinitiveRetry.id,
      idempotencyKey: 'stripe:auth:declined-retry',
      paymentMethodReference: 'pm_sf_replacement',
    });
    assert.equal(recoveredDecline.status, 'SUCCEEDED');
    assert.equal(recoveredDecline.providerReference, 'pi_sf_decline_retry_4');
    assert.equal(definitiveAttempts, 2);

    const bookingOwningProviderReference = await createBooking(5);
    await db.paymentTransaction.create({ data: {
      organizationId: organizationA.id,
      bookingId: bookingOwningProviderReference.id,
      idempotencyKey: 'stripe:auth:historical-owner',
      kind: 'AUTHORIZATION',
      status: 'FAILED',
      providerCode: 'stripe',
      providerReference: 'pi_sf_owned_reference_5',
      currency: 'USD',
      amountMinor: 12345n,
    } });
    const bookingForProviderReferenceConflict = await createBooking(6);
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (!url.endsWith('/payment_intents')) throw new Error(`Unexpected Stripe provider-reference request: ${url}`);
      return new Response(JSON.stringify({ id: 'pi_sf_owned_reference_5', status: 'requires_capture', amount: 12345, amount_received: 0, currency: 'usd' }), { status: 200 });
    }) as typeof fetch;
    await assert.rejects(
      stripePayments.authorizeStripeBookingPayment({
        organizationId: organizationA.id,
        actorUserId: adminA.id,
        bookingId: bookingForProviderReferenceConflict.id,
        idempotencyKey: 'stripe:auth:provider-reference-conflict',
        paymentMethodReference: 'pm_sf_provider_reference_conflict',
      }),
      /belongs to another booking/i,
    );
    const conflictedClaim = await db.paymentTransaction.findUniqueOrThrow({
      where: { organizationId_idempotencyKey: { organizationId: organizationA.id, idempotencyKey: 'stripe:auth:provider-reference-conflict' } },
    });
    assert.equal(conflictedClaim.status, 'PENDING');
    assert.match(conflictedClaim.providerReference, /^sf_claim_[0-9a-f]{64}$/);

    const bookingForWebhook = await createBooking(7);
    const fingerprint = stripePayments.paymentRequestFingerprint([
      'stripe',
      'authorize',
      bookingForWebhook.id,
      bookingForWebhook.currency,
      bookingForWebhook.totalMinor.toString(),
      'pm_sf_webhook',
    ]);
    const webhookClaim = await db.paymentTransaction.create({ data: {
      organizationId: organizationA.id,
      bookingId: bookingForWebhook.id,
      idempotencyKey: 'stripe:auth:webhook',
      requestFingerprint: fingerprint,
      kind: 'AUTHORIZATION',
      status: 'PENDING',
      providerCode: 'stripe',
      providerReference: stripePayments.paymentOperationClaimReference(fingerprint),
      currency: 'USD',
      amountMinor: 12345n,
    } });

    const webhookPayload = paymentIntentEvent({
      eventId: 'evt_sf_auth_webhook_1',
      organizationId: organizationA.id,
      bookingId: bookingForWebhook.id,
      providerReference: 'pi_sf_webhook_3',
      status: 'requires_capture',
    });
    const webhookSignature = stripeSignature(webhookPayload, webhookSecretA);
    const webhookResult = await webhooks.ingestStripePaymentWebhook({ organizationId: organizationA.id, signature: webhookSignature, payload: webhookPayload });
    assert.equal(webhookResult.status, 'PROCESSED');
    const resolvedClaim = await db.paymentTransaction.findUniqueOrThrow({ where: { id: webhookClaim.id } });
    assert.equal(resolvedClaim.status, 'SUCCEEDED');
    assert.equal(resolvedClaim.providerReference, 'pi_sf_webhook_3');
    assert.equal((await db.hospitalityBooking.findUniqueOrThrow({ where: { id: bookingForWebhook.id } })).paymentStatus, 'AUTHORIZED');

    const exactWebhookRetry = await webhooks.ingestStripePaymentWebhook({ organizationId: organizationA.id, signature: webhookSignature, payload: webhookPayload });
    assert.equal(exactWebhookRetry.id, webhookResult.id);
    assert.equal(await db.paymentWebhookEvent.count({ where: { organizationId: organizationA.id, providerEventId: 'evt_sf_auth_webhook_1' } }), 1);

    const alteredWebhookPayload = paymentIntentEvent({
      eventId: 'evt_sf_auth_webhook_1',
      organizationId: organizationA.id,
      bookingId: bookingForWebhook.id,
      providerReference: 'pi_sf_webhook_3',
      status: 'requires_capture',
      amountMinor: 12344,
    });
    await assert.rejects(
      webhooks.ingestStripePaymentWebhook({ organizationId: organizationA.id, signature: stripeSignature(alteredWebhookPayload, webhookSecretA), payload: alteredWebhookPayload }),
      /different content/i,
    );

    const moneyMismatchPayload = paymentIntentEvent({
      eventId: 'evt_sf_money_mismatch',
      organizationId: organizationA.id,
      bookingId: bookingForWebhook.id,
      providerReference: 'pi_sf_wrong_money',
      status: 'requires_capture',
      amountMinor: 1,
    });
    const moneyMismatch = await webhooks.ingestStripePaymentWebhook({
      organizationId: organizationA.id,
      signature: stripeSignature(moneyMismatchPayload, webhookSecretA),
      payload: moneyMismatchPayload,
    });
    assert.equal(moneyMismatch.status, 'IGNORED');
    assert.equal(moneyMismatch.processingNote, 'booking-money-mismatch');

    const crossTenantPayload = paymentIntentEvent({
      eventId: 'evt_sf_cross_tenant',
      organizationId: organizationA.id,
      bookingId: bookingForWebhook.id,
      providerReference: 'pi_sf_cross_tenant',
      status: 'requires_capture',
    });
    const crossTenantEvent = await webhooks.ingestStripePaymentWebhook({
      organizationId: organizationB.id,
      signature: stripeSignature(crossTenantPayload, webhookSecretB),
      payload: crossTenantPayload,
    });
    assert.equal(crossTenantEvent.status, 'IGNORED');
    assert.equal(crossTenantEvent.processingNote, 'tenant-metadata-mismatch');

    const auditPayload = JSON.stringify(await db.auditEvent.findMany({
      where: { organizationId: organizationA.id, action: { in: ['payment.authorization-recorded', 'payment.capture-recorded', 'payment.stripe-reconciled'] } },
      select: { afterData: true },
    }));
    assert.equal(auditPayload.includes('pm_sf_'), false);
    assert.equal(auditPayload.includes('sk_test_'), false);
    assert.equal(auditPayload.includes('whsec_'), false);
    assert.equal(auditPayload.includes('sf_claim_'), false);
  } finally {
    globalThis.fetch = originalFetch;
    await db.paymentWebhookEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.auditEvent.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.paymentTransaction.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    if (bookingIds.length > 0) await db.hospitalityBooking.deleteMany({ where: { id: { in: bookingIds } } });
    await db.hospitalityAvailabilityHold.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRatePlan.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityRoomType.deleteMany({ where: { organizationId: organizationA.id } });
    await db.hospitalityProperty.deleteMany({ where: { organizationId: organizationA.id } });
    await db.customer.deleteMany({ where: { organizationId: organizationA.id } });
    await db.integration.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organizationMembership.deleteMany({ where: { organizationId: { in: [organizationA.id, organizationB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [organizationA.id, organizationB.id] } } });
    await db.user.deleteMany({ where: { id: { in: [adminA.id, staffA.id, adminB.id] } } });
  }
});
