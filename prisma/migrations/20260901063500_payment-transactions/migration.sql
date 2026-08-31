CREATE TYPE "PaymentTransactionKind" AS ENUM ('OFFLINE_PAYMENT', 'AUTHORIZATION', 'CAPTURE', 'REFUND');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS');

CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "kind" "PaymentTransactionKind" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL,
    "providerCode" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_transactions_amount_check" CHECK ("amountMinor" >= 0),
    CONSTRAINT "payment_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "payment_transactions_provider_code_check" CHECK (length(btrim("providerCode")) >= 1 AND "providerCode" = lower(btrim("providerCode"))),
    CONSTRAINT "payment_transactions_provider_reference_check" CHECK (length(btrim("providerReference")) >= 1 AND "providerReference" = btrim("providerReference"))
);

CREATE UNIQUE INDEX "payment_transactions_org_idempotency_key" ON "payment_transactions"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "payment_transactions_org_provider_reference_key" ON "payment_transactions"("organizationId", "providerCode", "providerReference");
CREATE INDEX "payment_transactions_booking_created_idx" ON "payment_transactions"("organizationId", "bookingId", "createdAt");
CREATE INDEX "payment_transactions_status_created_idx" ON "payment_transactions"("organizationId", "status", "createdAt");

ALTER TABLE "payment_transactions"
ADD CONSTRAINT "payment_transactions_organization_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_transactions"
ADD CONSTRAINT "payment_transactions_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "hospitality_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;
