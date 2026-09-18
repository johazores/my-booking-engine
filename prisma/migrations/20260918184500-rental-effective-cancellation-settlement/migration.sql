-- Replace the legacy booking-price-only cancellation settlement guard with one
-- that understands the single supported applied rental commercial amendment.
-- The shared booking advisory lock serializes this decision with post-apply
-- effective-refund writes and all other rental booking commercial mutations.

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_cancellation_payment_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    original_net_settled_minor BIGINT;
    applied_amendment RECORD;
    applied_amendment_count INTEGER;
    settlement_row_count INTEGER;
    adjustment_count INTEGER;
    compensation_count INTEGER;
    adjustment_kind "PaymentTransactionKind";
    adjustment_provider_code VARCHAR(40);
    adjustment_source_reference VARCHAR(160);
    adjustment_currency CHAR(3);
    adjustment_amount BIGINT;
    post_apply_refunded_minor NUMERIC;
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
      INTO original_net_settled_minor
      FROM "rental_payment_transactions" payment
     WHERE payment."organizationId" = OLD."organizationId"
       AND payment."bookingId" = OLD."id";

    SELECT COUNT(*)
      INTO applied_amendment_count
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."organizationId" = OLD."organizationId"
       AND amendment."bookingId" = OLD."id"
       AND amendment."status" = 'APPLIED';

    IF applied_amendment_count = 0 THEN
        IF original_net_settled_minor <> 0 THEN
            RAISE EXCEPTION 'rental booking cancellation requires all settled money to be refunded first'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF applied_amendment_count <> 1 THEN
        RAISE EXCEPTION 'rental booking cancellation requires exactly one supported applied commercial amendment'
            USING ERRCODE = '23514';
    END IF;

    SELECT amendment.*
      INTO applied_amendment
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."organizationId" = OLD."organizationId"
       AND amendment."bookingId" = OLD."id"
       AND amendment."status" = 'APPLIED'
     FOR SHARE;

    IF NOT FOUND
       OR applied_amendment."appliedAt" IS NULL
       OR applied_amendment."appliedRescheduleId" IS NULL
       OR applied_amendment."currency" IS DISTINCT FROM OLD."currency"
       OR applied_amendment."beforeTotalMinor" IS DISTINCT FROM OLD."totalMinor"
       OR applied_amendment."afterTotalMinor" <= 0
       OR applied_amendment."deltaMinor" <= 0
       OR (
            applied_amendment."direction" = 'ADDITIONAL_CHARGE'
            AND applied_amendment."beforeTotalMinor" + applied_amendment."deltaMinor"
                <> applied_amendment."afterTotalMinor"
          )
       OR (
            applied_amendment."direction" = 'REFUND'
            AND applied_amendment."afterTotalMinor" + applied_amendment."deltaMinor"
                <> applied_amendment."beforeTotalMinor"
          )
    THEN
        RAISE EXCEPTION 'rental booking cancellation requires valid retained applied commercial amendment evidence'
            USING ERRCODE = '23514';
    END IF;

    -- Final apply requires the original immutable booking-price ledger to be
    -- fully settled. That ledger is frozen after apply, so the condition must
    -- still hold before combined effective settlement can be trusted.
    IF original_net_settled_minor IS DISTINCT FROM applied_amendment."beforeTotalMinor" THEN
        RAISE EXCEPTION 'rental booking cancellation original settlement no longer matches applied commercial amendment authority'
            USING ERRCODE = '23514';
    END IF;

    SELECT
      COUNT(*),
      COUNT(*) FILTER (
        WHERE row."purpose" = 'ADJUSTMENT'
          AND row."status" = 'SUCCEEDED'
      ),
      COUNT(*) FILTER (
        WHERE row."purpose" = 'COMPENSATION'
          AND row."status" = 'SUCCEEDED'
      )
      INTO
      settlement_row_count,
      adjustment_count,
      compensation_count
      FROM "rental_booking_commercial_amendment_settlement_transactions" row
     WHERE row."organizationId" = OLD."organizationId"
       AND row."bookingId" = OLD."id"
       AND row."amendmentId" = applied_amendment."id";

    IF settlement_row_count <> 1 OR adjustment_count <> 1 OR compensation_count <> 0 THEN
        RAISE EXCEPTION 'rental booking cancellation requires exactly one uncompensated applied amendment adjustment'
            USING ERRCODE = '23514';
    END IF;

    SELECT
      row."kind",
      row."providerCode",
      row."sourceProviderReference",
      row."currency",
      row."amountMinor"
      INTO
      adjustment_kind,
      adjustment_provider_code,
      adjustment_source_reference,
      adjustment_currency,
      adjustment_amount
      FROM "rental_booking_commercial_amendment_settlement_transactions" row
     WHERE row."organizationId" = OLD."organizationId"
       AND row."bookingId" = OLD."id"
       AND row."amendmentId" = applied_amendment."id"
       AND row."purpose" = 'ADJUSTMENT'
       AND row."status" = 'SUCCEEDED';

    IF adjustment_provider_code IS DISTINCT FROM 'manual'
       OR adjustment_currency IS DISTINCT FROM applied_amendment."currency"
       OR adjustment_amount IS DISTINCT FROM applied_amendment."deltaMinor"
       OR (
            applied_amendment."direction" = 'ADDITIONAL_CHARGE'
            AND (
              adjustment_kind IS DISTINCT FROM 'OFFLINE_PAYMENT'
              OR adjustment_source_reference IS NOT NULL
            )
          )
       OR (
            applied_amendment."direction" = 'REFUND'
            AND (
              adjustment_kind IS DISTINCT FROM 'REFUND'
              OR adjustment_source_reference IS NULL
            )
          )
    THEN
        RAISE EXCEPTION 'rental booking cancellation requires exact uncompensated applied amendment settlement evidence'
            USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(SUM(refund."amountMinor"), 0)
      INTO post_apply_refunded_minor
      FROM "rental_booking_effective_refund_transactions" refund
     WHERE refund."organizationId" = OLD."organizationId"
       AND refund."bookingId" = OLD."id"
       AND refund."amendmentId" = applied_amendment."id"
       AND refund."status" = 'SUCCEEDED'
       AND refund."providerCode" = 'manual'
       AND refund."currency" = applied_amendment."currency";

    -- The applied adjustment changes accepted money from beforeTotal to
    -- afterTotal. Every later effective refund subtracts from that amount.
    -- Per-source refund guards independently prevent source over-refunds.
    IF post_apply_refunded_minor IS DISTINCT FROM applied_amendment."afterTotalMinor"::NUMERIC THEN
        RAISE EXCEPTION 'rental booking cancellation requires effective settlement to be fully refunded first'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- The older commercial-amendment migration installed a blanket cancellation
-- block. Effective-settlement-aware cancellation is now enforced by the
-- unified payment-settlement guard above, so remove the obsolete duplicate.
DROP TRIGGER IF EXISTS rental_bookings_post_commercial_apply_cancellation_guard
ON "rental_bookings";

DROP FUNCTION IF EXISTS sf_guard_rental_booking_cancellation_after_commercial_amendment();
