CREATE TABLE "rental_payment_transactions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "requestFingerprint" CHAR(64),
    "kind" "PaymentTransactionKind" NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "providerCode" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160) NOT NULL,
    "sourceProviderReference" VARCHAR(160),
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_payment_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_payment_transactions_amount_check" CHECK ("amountMinor" > 0),
    CONSTRAINT "rental_payment_transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_payment_transactions_request_fingerprint_check" CHECK ("requestFingerprint" IS NULL OR "requestFingerprint" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "rental_payment_transactions_provider_code_check" CHECK (length(btrim("providerCode")) >= 1 AND "providerCode" = lower(btrim("providerCode"))),
    CONSTRAINT "rental_payment_transactions_provider_reference_check" CHECK (length(btrim("providerReference")) >= 1 AND "providerReference" = btrim("providerReference")),
    CONSTRAINT "rental_payment_transactions_source_reference_check" CHECK (
        ("kind" = 'REFUND' AND "sourceProviderReference" IS NOT NULL AND length(btrim("sourceProviderReference")) >= 1 AND "sourceProviderReference" = btrim("sourceProviderReference"))
        OR ("kind" <> 'REFUND' AND "sourceProviderReference" IS NULL)
    )
);

CREATE UNIQUE INDEX "rental_payment_transactions_id_organization_key"
ON "rental_payment_transactions"("id", "organizationId");

CREATE UNIQUE INDEX "rental_payment_transactions_org_idempotency_key"
ON "rental_payment_transactions"("organizationId", "idempotencyKey");

CREATE UNIQUE INDEX "rental_payment_transactions_org_provider_reference_key"
ON "rental_payment_transactions"("organizationId", "providerCode", "providerReference");

CREATE INDEX "rental_payment_transactions_org_provider_source_reference_idx"
ON "rental_payment_transactions"("organizationId", "providerCode", "sourceProviderReference");

CREATE INDEX "rental_payment_transactions_booking_created_idx"
ON "rental_payment_transactions"("organizationId", "bookingId", "createdAt");

CREATE INDEX "rental_payment_transactions_status_created_idx"
ON "rental_payment_transactions"("organizationId", "status", "createdAt");

ALTER TABLE "rental_payment_transactions"
ADD CONSTRAINT "rental_payment_transactions_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_guard_rental_payment_transaction_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    source_amount_minor BIGINT;
    refunded_minor BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    SELECT booking."id", booking."status", booking."currency", booking."totalMinor"
      INTO parent_booking
      FROM "rental_bookings" booking
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId";

    IF NOT FOUND OR parent_booking."status" <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'rental payment transaction requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."currency" <> parent_booking."currency" THEN
        RAISE EXCEPTION 'rental payment currency does not match authoritative booking currency'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."providerCode" <> 'manual' OR NEW."status" <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'rental payment provider/status contract is not enabled'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'OFFLINE_PAYMENT' THEN
        IF NEW."amountMinor" <> parent_booking."totalMinor" OR NEW."sourceProviderReference" IS NOT NULL THEN
            RAISE EXCEPTION 'rental offline payment must equal the full authoritative booking amount'
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
            SELECT 1
              FROM "rental_payment_transactions" payment
             WHERE payment."organizationId" = NEW."organizationId"
               AND payment."bookingId" = NEW."bookingId"
               AND payment."status" = 'SUCCEEDED'
               AND payment."kind" IN ('OFFLINE_PAYMENT', 'AUTHORIZATION', 'CAPTURE')
        ) THEN
            RAISE EXCEPTION 'rental booking already has successful settlement evidence'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW."kind" = 'REFUND' THEN
        SELECT payment."amountMinor"
          INTO source_amount_minor
          FROM "rental_payment_transactions" payment
         WHERE payment."organizationId" = NEW."organizationId"
           AND payment."bookingId" = NEW."bookingId"
           AND payment."providerCode" = 'manual'
           AND payment."providerReference" = NEW."sourceProviderReference"
           AND payment."kind" = 'OFFLINE_PAYMENT'
           AND payment."status" = 'SUCCEEDED'
         LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'rental refund source payment is unavailable'
                USING ERRCODE = '23514';
        END IF;

        SELECT COALESCE(SUM(payment."amountMinor"), 0)
          INTO refunded_minor
          FROM "rental_payment_transactions" payment
         WHERE payment."organizationId" = NEW."organizationId"
           AND payment."bookingId" = NEW."bookingId"
           AND payment."providerCode" = 'manual'
           AND payment."sourceProviderReference" = NEW."sourceProviderReference"
           AND payment."kind" = 'REFUND'
           AND payment."status" = 'SUCCEEDED';

        IF refunded_minor + NEW."amountMinor" > source_amount_minor THEN
            RAISE EXCEPTION 'rental refund exceeds its settled source payment'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'rental payment kind is not enabled'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_payment_transactions" payment
         WHERE payment."organizationId" = NEW."organizationId"
           AND payment."providerCode" = NEW."providerCode"
           AND payment."providerReference" = NEW."providerReference"
    ) THEN
        RAISE EXCEPTION 'rental payment provider reference is already used in this tenant'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_payment_transactions_insert_guard
BEFORE INSERT ON "rental_payment_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_payment_transaction_insert();

CREATE FUNCTION sf_guard_rental_payment_transaction_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rental payment transaction evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER rental_payment_transactions_append_only_guard
BEFORE UPDATE OR DELETE ON "rental_payment_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_payment_transaction_append_only();

CREATE FUNCTION sf_guard_rental_booking_cancellation_payment_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    net_settled_minor BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || OLD."organizationId"::text || ':booking:' || OLD."id"::text,
            0
        )
    );

    IF NOT (
        OLD."status" = 'CONFIRMED'
        AND OLD."cancelledAt" IS NULL
        AND NEW."status" = 'CANCELLED'
        AND NEW."cancelledAt" IS NOT NULL
    ) THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_payment_transactions" payment
         WHERE payment."organizationId" = OLD."organizationId"
           AND payment."bookingId" = OLD."id"
           AND payment."status" IN ('PENDING', 'AMBIGUOUS')
    ) THEN
        RAISE EXCEPTION 'rental booking cancellation requires reconciled payment history'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_payment_transactions" payment
         WHERE payment."organizationId" = OLD."organizationId"
           AND payment."bookingId" = OLD."id"
           AND payment."status" = 'SUCCEEDED'
           AND (payment."providerCode" <> 'manual' OR payment."kind" NOT IN ('OFFLINE_PAYMENT', 'REFUND'))
    ) THEN
        RAISE EXCEPTION 'rental booking cancellation payment history uses an unsupported settlement contract'
            USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(SUM(
        CASE
            WHEN payment."status" = 'SUCCEEDED' AND payment."kind" = 'OFFLINE_PAYMENT' THEN payment."amountMinor"
            WHEN payment."status" = 'SUCCEEDED' AND payment."kind" = 'REFUND' THEN -payment."amountMinor"
            ELSE 0
        END
    ), 0)
      INTO net_settled_minor
      FROM "rental_payment_transactions" payment
     WHERE payment."organizationId" = OLD."organizationId"
       AND payment."bookingId" = OLD."id";

    IF net_settled_minor <> 0 THEN
        RAISE EXCEPTION 'rental booking cancellation requires all settled money to be refunded first'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_bookings_cancellation_payment_settlement_guard
BEFORE UPDATE OF "status", "cancelledAt"
ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_cancellation_payment_settlement();
