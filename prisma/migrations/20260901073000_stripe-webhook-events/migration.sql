CREATE TYPE "PaymentWebhookEventStatus" AS ENUM ('PROCESSED', 'IGNORED');

CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "providerCode" VARCHAR(40) NOT NULL,
    "providerEventId" VARCHAR(160) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "providerReference" VARCHAR(160),
    "bookingId" UUID,
    "status" "PaymentWebhookEventStatus" NOT NULL,
    "processingNote" VARCHAR(80) NOT NULL,
    "providerCreatedAt" TIMESTAMPTZ(6) NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_webhook_events_org_provider_event_key"
ON "payment_webhook_events"("organizationId", "providerCode", "providerEventId");

CREATE INDEX "payment_webhook_events_booking_received_idx"
ON "payment_webhook_events"("organizationId", "bookingId", "receivedAt");

CREATE INDEX "payment_webhook_events_provider_reference_idx"
ON "payment_webhook_events"("organizationId", "providerCode", "providerReference");

CREATE INDEX "payment_webhook_events_status_received_idx"
ON "payment_webhook_events"("organizationId", "status", "receivedAt");
