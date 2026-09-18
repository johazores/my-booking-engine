CREATE TYPE "RentalBookingEffectiveRefundSourceLedger" AS ENUM ('BOOKING_PRICE', 'COMMERCIAL_AMENDMENT');

CREATE TABLE "rental_booking_effective_refund_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "amendmentId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "sourceLedger" "RentalBookingEffectiveRefundSourceLedger" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "providerCode" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "sourceProviderReference" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_booking_effective_refund_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_booking_effective_refund_transactions_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_booking_effective_refund_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_booking_effective_refund_transactions_fingerprint_check" CHECK ("requestFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "rental_booking_effective_refund_transactions_idempotency_check" CHECK ("idempotencyKey" ~ '^rental-effective-refund:[a-f0-9]{48}$'),
    CONSTRAINT "rental_booking_effective_refund_transactions_provider_check" CHECK (
      "providerCode" = 'manual'
      AND btrim("providerReference") <> ''
      AND btrim("sourceProviderReference") <> ''
      AND "providerReference" <> "sourceProviderReference"
      AND "status" = 'SUCCEEDED'
    )
);

CREATE UNIQUE INDEX "rental_booking_effective_refund_transactions_id_org_key"
  ON "rental_booking_effective_refund_transactions"("id", "organizationId");
CREATE UNIQUE INDEX "rental_booking_effective_refund_transactions_org_idempotency_key"
  ON "rental_booking_effective_refund_transactions"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "rental_booking_effective_refund_transactions_org_provider_reference_key"
  ON "rental_booking_effective_refund_transactions"("organizationId", "providerCode", "providerReference");
CREATE INDEX "rental_booking_effective_refund_transactions_booking_created_idx"
  ON "rental_booking_effective_refund_transactions"("organizationId", "bookingId", "amendmentId", "createdAt");
CREATE INDEX "rental_booking_effective_refund_transactions_source_reference_idx"
  ON "rental_booking_effective_refund_transactions"("organizationId", "providerCode", "sourceProviderReference");

ALTER TABLE "rental_booking_effective_refund_transactions"
  ADD CONSTRAINT "rental_booking_effective_refund_transactions_amendment_fkey"
  FOREIGN KEY ("amendmentId", "bookingId", "organizationId")
  REFERENCES "rental_booking_commercial_amendments"("id", "bookingId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION sf_author_rental_booking_effective_refund_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
    amendment_status "RentalBookingCommercialAmendmentStatus";
    amendment_direction "RentalBookingCommercialAmendmentDirection";
    amendment_currency CHAR(3);
    amendment_delta BIGINT;
    amendment_applied_at TIMESTAMPTZ;
    adjustment_kind "PaymentTransactionKind";
    adjustment_reference VARCHAR(160);
    adjustment_source_reference VARCHAR(160);
    adjustment_amount BIGINT;
    source_amount BIGINT;
    already_refunded BIGINT;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'post-apply rental refund evidence is append-only'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
      0
    ));

    SELECT
      amendment."status",
      amendment."direction",
      amendment."currency",
      amendment."deltaMinor",
      amendment."appliedAt"
      INTO
      amendment_status,
      amendment_direction,
      amendment_currency,
      amendment_delta,
      amendment_applied_at
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."id" = NEW."amendmentId"
       AND amendment."bookingId" = NEW."bookingId"
       AND amendment."organizationId" = NEW."organizationId"
     FOR UPDATE;

    IF amendment_status IS NULL OR amendment_status <> 'APPLIED' OR amendment_applied_at IS NULL THEN
        RAISE EXCEPTION 'post-apply rental refund requires a tenant-owned applied commercial amendment'
            USING ERRCODE = '23514';
    END IF;
    IF NEW."status" <> 'SUCCEEDED'
       OR NEW."providerCode" <> 'manual'
       OR NEW."currency" <> amendment_currency
       OR NEW."amountMinor" <= 0
       OR btrim(NEW."providerReference") = ''
       OR btrim(NEW."sourceProviderReference") = ''
       OR NEW."providerReference" = NEW."sourceProviderReference"
    THEN
        RAISE EXCEPTION 'post-apply rental refund evidence is outside the supported manual contract'
            USING ERRCODE = '23514';
    END IF;

    SELECT
      row."kind",
      row."providerReference",
      row."sourceProviderReference",
      row."amountMinor"
      INTO
      adjustment_kind,
      adjustment_reference,
      adjustment_source_reference,
      adjustment_amount
      FROM "rental_booking_commercial_amendment_settlement_transactions" row
     WHERE row."organizationId" = NEW."organizationId"
       AND row."bookingId" = NEW."bookingId"
       AND row."amendmentId" = NEW."amendmentId"
       AND row."purpose" = 'ADJUSTMENT'
       AND row."status" = 'SUCCEEDED'
       AND row."providerCode" = 'manual';

    IF adjustment_reference IS NULL OR adjustment_amount IS DISTINCT FROM amendment_delta THEN
        RAISE EXCEPTION 'post-apply rental refund requires exact retained amendment adjustment evidence'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."sourceLedger" = 'BOOKING_PRICE' THEN
        SELECT row."amountMinor"
          INTO source_amount
          FROM "rental_payment_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."bookingId" = NEW."bookingId"
           AND row."kind" = 'OFFLINE_PAYMENT'
           AND row."status" = 'SUCCEEDED'
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."sourceProviderReference"
           AND row."currency" = NEW."currency";

        IF source_amount IS NULL THEN
            RAISE EXCEPTION 'post-apply booking-price refund source is not retained successful manual payment evidence'
                USING ERRCODE = '23514';
        END IF;

        SELECT COALESCE(sum(row."amountMinor"), 0)
          INTO already_refunded
          FROM "rental_payment_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."bookingId" = NEW."bookingId"
           AND row."kind" = 'REFUND'
           AND row."status" = 'SUCCEEDED'
           AND row."providerCode" = 'manual'
           AND row."sourceProviderReference" = NEW."sourceProviderReference"
           AND row."currency" = NEW."currency";

        IF amendment_direction = 'REFUND'
           AND adjustment_kind = 'REFUND'
           AND adjustment_source_reference IS NOT DISTINCT FROM NEW."sourceProviderReference"
        THEN
            already_refunded := already_refunded + adjustment_amount;
        END IF;

        SELECT already_refunded + COALESCE(sum(row."amountMinor"), 0)
          INTO already_refunded
          FROM "rental_booking_effective_refund_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."bookingId" = NEW."bookingId"
           AND row."amendmentId" = NEW."amendmentId"
           AND row."sourceLedger" = 'BOOKING_PRICE'
           AND row."status" = 'SUCCEEDED'
           AND row."providerCode" = 'manual'
           AND row."sourceProviderReference" = NEW."sourceProviderReference"
           AND row."currency" = NEW."currency";

        IF already_refunded + NEW."amountMinor" > source_amount THEN
            RAISE EXCEPTION 'post-apply booking-price refund exceeds the retained source payment balance'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF amendment_direction <> 'ADDITIONAL_CHARGE'
           OR adjustment_kind <> 'OFFLINE_PAYMENT'
           OR adjustment_source_reference IS NOT NULL
           OR NEW."sourceProviderReference" IS DISTINCT FROM adjustment_reference
        THEN
            RAISE EXCEPTION 'post-apply amendment-charge refund source does not match the applied adjustment payment'
                USING ERRCODE = '23514';
        END IF;

        SELECT COALESCE(sum(row."amountMinor"), 0)
          INTO already_refunded
          FROM "rental_booking_effective_refund_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."bookingId" = NEW."bookingId"
           AND row."amendmentId" = NEW."amendmentId"
           AND row."sourceLedger" = 'COMMERCIAL_AMENDMENT'
           AND row."status" = 'SUCCEEDED'
           AND row."providerCode" = 'manual'
           AND row."sourceProviderReference" = adjustment_reference
           AND row."currency" = NEW."currency";

        IF already_refunded + NEW."amountMinor" > adjustment_amount THEN
            RAISE EXCEPTION 'post-apply amendment-charge refund exceeds the retained adjustment payment balance'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    authored_at := clock_timestamp();
    IF authored_at < amendment_applied_at THEN
        RAISE EXCEPTION 'post-apply rental refund cannot predate commercial amendment apply'
            USING ERRCODE = '23514';
    END IF;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_effective_refund_transactions_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_booking_effective_refund_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_booking_effective_refund_transaction();

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
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as booking settlement evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_damage_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_damage_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as damage settlement evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_security_bond_transactions' AND EXISTS (
        SELECT 1 FROM "rental_security_bond_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as security bond evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_late_return_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_late_return_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as late-return settlement evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_booking_commercial_amendment_settlement_transactions' AND EXISTS (
        SELECT 1 FROM "rental_booking_commercial_amendment_settlement_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as commercial amendment settlement evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME <> 'rental_booking_effective_refund_transactions' AND EXISTS (
        SELECT 1 FROM "rental_booking_effective_refund_transactions" row
         WHERE row."organizationId" = NEW."organizationId"
           AND row."providerCode" = 'manual'
           AND row."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference is already retained as post-apply effective refund evidence in this tenant'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME NOT IN (
        'rental_payment_transactions',
        'rental_damage_settlement_transactions',
        'rental_security_bond_transactions',
        'rental_late_return_settlement_transactions',
        'rental_booking_commercial_amendment_settlement_transactions',
        'rental_booking_effective_refund_transactions'
    ) THEN
        RAISE EXCEPTION 'manual rental provider reference guard is attached to an unexpected table'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_effective_refund_transactions_cross_scope_reference_guard
BEFORE INSERT ON "rental_booking_effective_refund_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_manual_reference_cross_scope();
