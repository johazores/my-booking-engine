CREATE OR REPLACE FUNCTION sf_guard_rental_payment_transaction_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    source_amount_minor BIGINT;
    refunded_minor BIGINT;
    net_settled_minor BIGINT;
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
        IF NEW."sourceProviderReference" IS NOT NULL THEN
            RAISE EXCEPTION 'rental offline payment cannot reference a refund source'
                USING ERRCODE = '23514';
        END IF;

        SELECT COALESCE(SUM(
            CASE
                WHEN payment."kind" = 'OFFLINE_PAYMENT' THEN payment."amountMinor"
                WHEN payment."kind" = 'REFUND' THEN -payment."amountMinor"
                ELSE 0
            END
        ), 0)
          INTO net_settled_minor
          FROM "rental_payment_transactions" payment
         WHERE payment."organizationId" = NEW."organizationId"
           AND payment."bookingId" = NEW."bookingId"
           AND payment."providerCode" = 'manual'
           AND payment."status" = 'SUCCEEDED'
           AND payment."kind" IN ('OFFLINE_PAYMENT', 'REFUND');

        IF net_settled_minor < 0 OR net_settled_minor + NEW."amountMinor" > parent_booking."totalMinor" THEN
            RAISE EXCEPTION 'rental offline payment exceeds the outstanding authoritative booking balance'
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
