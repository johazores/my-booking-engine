CREATE TYPE "PaymentCheckoutSessionStatus" AS ENUM ('OPEN', 'COMPLETED', 'EXPIRED');

CREATE UNIQUE INDEX "payment_transactions_id_organizationId_key"
  ON "payment_transactions"("id", "organizationId");

CREATE TABLE "payment_checkout_sessions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "publicPrincipalId" UUID NOT NULL,
    "paymentTransactionId" UUID NOT NULL,
    "providerCode" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "providerPaymentReference" VARCHAR(160),
    "status" "PaymentCheckoutSessionStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "expiredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "payment_checkout_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_checkout_sessions_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "payment_checkout_sessions_lifecycle_check" CHECK (
      ("status" = 'OPEN' AND "completedAt" IS NULL AND "expiredAt" IS NULL)
      OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "expiredAt" IS NULL)
      OR ("status" = 'EXPIRED' AND "expiredAt" IS NOT NULL AND "completedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "payment_checkout_sessions_org_provider_reference_key"
  ON "payment_checkout_sessions"("organizationId", "providerCode", "providerReference");
CREATE UNIQUE INDEX "payment_checkout_sessions_org_payment_transaction_key"
  ON "payment_checkout_sessions"("organizationId", "paymentTransactionId");
CREATE INDEX "payment_checkout_sessions_org_booking_status_idx"
  ON "payment_checkout_sessions"("organizationId", "bookingId", "status");
CREATE INDEX "payment_checkout_sessions_org_expiry_idx"
  ON "payment_checkout_sessions"("organizationId", "expiresAt");

ALTER TABLE "payment_checkout_sessions"
  ADD CONSTRAINT "payment_checkout_sessions_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_checkout_sessions"
  ADD CONSTRAINT "payment_checkout_sessions_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "hospitality_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_checkout_sessions"
  ADD CONSTRAINT "payment_checkout_sessions_principal_fkey"
  FOREIGN KEY ("publicPrincipalId", "organizationId") REFERENCES "public_booking_principals"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_checkout_sessions"
  ADD CONSTRAINT "payment_checkout_sessions_payment_transaction_fkey"
  FOREIGN KEY ("paymentTransactionId", "organizationId") REFERENCES "payment_transactions"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
