CREATE TYPE "RentalBookingCommercialAmendmentSettlementPurpose" AS ENUM ('ADJUSTMENT', 'COMPENSATION');

CREATE UNIQUE INDEX "rental_booking_commercial_amendments_id_booking_org_key"
  ON "rental_booking_commercial_amendments"("id", "bookingId", "organizationId");

CREATE TABLE "rental_booking_commercial_amendment_settlement_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "amendmentId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "purpose" "RentalBookingCommercialAmendmentSettlementPurpose" NOT NULL,
    "kind" "PaymentTransactionKind" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "providerCode" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "sourceProviderReference" VARCHAR(160),
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_amendment_settlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_amendment_settlement_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_amendment_settlement_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_amendment_settlement_fingerprint_check" CHECK ("requestFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "rental_amendment_settlement_provider_check" CHECK (btrim("providerCode") <> '' AND btrim("providerReference") <> '')
);

CREATE UNIQUE INDEX "rental_amendment_settlement_id_org_key"
  ON "rental_booking_commercial_amendment_settlement_transactions"("id", "organizationId");
CREATE UNIQUE INDEX "rental_amendment_settlement_org_idempotency_key"
  ON "rental_booking_commercial_amendment_settlement_transactions"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "rental_amendment_settlement_org_provider_reference_key"
  ON "rental_booking_commercial_amendment_settlement_transactions"("organizationId", "providerCode", "providerReference");
CREATE UNIQUE INDEX "rental_amendment_settlement_org_amendment_purpose_key"
  ON "rental_booking_commercial_amendment_settlement_transactions"("organizationId", "amendmentId", "purpose");
CREATE INDEX "rental_amendment_settlement_booking_amendment_created_idx"
  ON "rental_booking_commercial_amendment_settlement_transactions"("organizationId", "bookingId", "amendmentId", "createdAt");

ALTER TABLE "rental_booking_commercial_amendment_settlement_transactions"
  ADD CONSTRAINT "rental_amendment_settlement_booking_fkey"
  FOREIGN KEY ("bookingId", "organizationId") REFERENCES "rental_bookings"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_commercial_amendment_settlement_transactions"
  ADD CONSTRAINT "rental_amendment_settlement_amendment_fkey"
  FOREIGN KEY ("amendmentId", "bookingId", "organizationId")
  REFERENCES "rental_booking_commercial_amendments"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION sf_author_rental_booking_commercial_amendment_settlement_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
    amendment_status "RentalBookingCommercialAmendmentStatus";
    amendment_direction "RentalBookingCommercialAmendmentDirection";
    amendment_currency CHAR(3);
    amendment_delta BIGINT;
    amendment_expires_at TIMESTAMPTZ;
    adjustment_kind "PaymentTransactionKind";
    adjustment_reference VARCHAR(160);
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental commercial amendment settlement evidence is append-only'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
        0
    ));
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'sf:rental-commercial-amendment-settlement:' || NEW."organizationId"::text || ':' || NEW."amendmentId"::text,
        0
    ));

    SELECT amendment."status", amendment."direction", amendment."currency", amendment."deltaMinor", amendment."expiresAt"
      INTO amendment_status, amendment_direction, amendment_currency, amendment_delta, amendment_expires_at
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."id" = NEW."amendmentId"
       AND amendment."bookingId" = NEW."bookingId"
       AND amendment."organizationId" = NEW."organizationId"
     FOR UPDATE;

    IF amendment_status IS NULL OR amendment_status <> 'PREPARED' THEN
        RAISE EXCEPTION 'rental commercial amendment settlement requires a tenant-owned prepared amendment'
            USING ERRCODE = '23514';
    END IF;
    IF NEW."status" <> 'SUCCEEDED' OR NEW."providerCode" <> 'manual' THEN
        RAISE EXCEPTION 'rental commercial amendment settlement only accepts successful manual evidence'
            USING ERRCODE = '23514';
    END IF;
    IF NEW."currency" <> amendment_currency OR NEW."amountMinor" <> amendment_delta THEN
        RAISE EXCEPTION 'rental commercial amendment settlement must match the exact retained delta'
            USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();
    IF NEW."purpose" = 'ADJUSTMENT' THEN
        IF authored_at >= amendment_expires_at THEN
            RAISE EXCEPTION 'expired rental commercial amendment authority cannot receive new adjustment money'
                USING ERRCODE = '23514';
        END IF;
        IF NEW."idempotencyKey" !~ '^rental-amendment-settlement:adjustment:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental commercial amendment adjustment idempotency evidence is invalid'
                USING ERRCODE = '23514';
        END IF;
        IF amendment_direction = 'ADDITIONAL_CHARGE' THEN
            IF NEW."kind" <> 'OFFLINE_PAYMENT' OR NEW."sourceProviderReference" IS NOT NULL THEN
                RAISE EXCEPTION 'rental commercial amendment increase requires exact manual payment evidence'
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            IF NEW."kind" <> 'REFUND'
               OR NEW."sourceProviderReference" IS NULL
               OR btrim(NEW."sourceProviderReference") = ''
               OR NEW."sourceProviderReference" = NEW."providerReference" THEN
                RAISE EXCEPTION 'rental commercial amendment decrease requires an exact source-attributed manual refund'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSE
        IF NEW."idempotencyKey" !~ '^rental-amendment-settlement:compensation:[a-f0-9]{48}$' THEN
            RAISE EXCEPTION 'rental commercial amendment compensation idempotency evidence is invalid'
                USING ERRCODE = '23514';
        END IF;
        SELECT row."kind", row."providerReference"
          INTO adjustment_kind, adjustment_reference
          FROM "rental_booking_commercial_amendment_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."bookingId" = NEW."bookingId"
           AND row."amendmentId" = NEW."amendmentId"
           AND row."purpose" = 'ADJUSTMENT'
           AND row."status" = 'SUCCEEDED'
           AND row."providerCode" = 'manual';
        IF adjustment_reference IS NULL THEN
            RAISE EXCEPTION 'rental commercial amendment compensation requires retained adjustment evidence'
                USING ERRCODE = '23514';
        END IF;
        IF amendment_direction = 'ADDITIONAL_CHARGE' THEN
            IF adjustment_kind <> 'OFFLINE_PAYMENT'
               OR NEW."kind" <> 'REFUND'
               OR NEW."sourceProviderReference" IS DISTINCT FROM adjustment_reference
               OR NEW."providerReference" = adjustment_reference THEN
                RAISE EXCEPTION 'rental commercial amendment increase compensation must refund its retained adjustment payment'
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            IF adjustment_kind <> 'REFUND'
               OR NEW."kind" <> 'OFFLINE_PAYMENT'
               OR NEW."sourceProviderReference" IS NOT NULL THEN
                RAISE EXCEPTION 'rental commercial amendment refund compensation must retain an exact replacement payment'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_amendment_settlement_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_booking_commercial_amendment_settlement_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_booking_commercial_amendment_settlement_transaction();

CREATE OR REPLACE FUNCTION sf_guard_rental_commercial_amendment_terminal_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    adjustment_count INTEGER;
    compensation_count INTEGER;
BEGIN
    IF OLD."status" = 'PREPARED' AND NEW."status" IN ('CANCELLED', 'EXPIRED') THEN
        SELECT
          count(*) FILTER (WHERE row."purpose" = 'ADJUSTMENT'),
          count(*) FILTER (WHERE row."purpose" = 'COMPENSATION')
          INTO adjustment_count, compensation_count
          FROM "rental_booking_commercial_amendment_settlement_transactions" row
         WHERE row."organizationId" = OLD."organizationId"
           AND row."bookingId" = OLD."bookingId"
           AND row."amendmentId" = OLD."id"
           AND row."status" = 'SUCCEEDED';

        IF adjustment_count > 0 AND compensation_count = 0 THEN
            RAISE EXCEPTION 'rental commercial amendment with uncompensated adjustment money cannot terminate'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_commercial_amendments_terminal_settlement_guard
BEFORE UPDATE ON "rental_booking_commercial_amendments"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_commercial_amendment_terminal_settlement();

CREATE OR REPLACE FUNCTION sf_guard_rental_manual_reference_cross_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."providerCode" <> 'manual' THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-manual-reference:' || NEW."organizationId"::text || ':' || NEW."providerReference",
            0
        )
    );

    IF TG_TABLE_NAME <> 'rental_payment_transactions' AND EXISTS (
        SELECT 1 FROM "rental_payment_transactions" row
         WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference"
    ) THEN RAISE EXCEPTION 'manual rental provider reference is already retained as booking settlement evidence in this tenant' USING ERRCODE = '23514'; END IF;

    IF TG_TABLE_NAME <> 'rental_damage_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_damage_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference"
    ) THEN RAISE EXCEPTION 'manual rental provider reference is already retained as damage settlement evidence in this tenant' USING ERRCODE = '23514'; END IF;

    IF TG_TABLE_NAME <> 'rental_security_bond_transactions' AND EXISTS (
        SELECT 1 FROM "rental_security_bond_transactions" row
         WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference"
    ) THEN RAISE EXCEPTION 'manual rental provider reference is already retained as security bond evidence in this tenant' USING ERRCODE = '23514'; END IF;

    IF TG_TABLE_NAME <> 'rental_late_return_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_late_return_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference"
    ) THEN RAISE EXCEPTION 'manual rental provider reference is already retained as late-return settlement evidence in this tenant' USING ERRCODE = '23514'; END IF;

    IF TG_TABLE_NAME <> 'rental_booking_commercial_amendment_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_booking_commercial_amendment_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId" AND row."providerCode" = 'manual' AND row."providerReference" = NEW."providerReference"
    ) THEN RAISE EXCEPTION 'manual rental provider reference is already retained as commercial amendment settlement evidence in this tenant' USING ERRCODE = '23514'; END IF;

    IF TG_TABLE_NAME NOT IN (
        'rental_payment_transactions',
        'rental_damage_settlement_transactions',
        'rental_security_bond_transactions',
        'rental_late_return_settlement_transactions',
        'rental_booking_commercial_amendment_settlement_transactions'
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference guard is attached to an unexpected table' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_commercial_amendment_settlement_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_booking_commercial_amendment_settlement_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();
