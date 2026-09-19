-- A prepared commercial amendment owns unresolved commercial authority for the
-- booking. Cancellation must not terminalize the booking while that workflow
-- can still contain uncompensated adjustment evidence or be finalized later.
--
-- This trigger is deliberately independent from the effective-settlement
-- cancellation guard. The effective-settlement guard handles ordinary and
-- APPLIED money; this guard makes PREPARED ownership explicit at the database
-- boundary even for direct SQL writes.

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_cancellation_prepared_amendment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT (
        OLD."status" = 'CONFIRMED'
        AND OLD."cancelledAt" IS NULL
        AND NEW."status" = 'CANCELLED'
        AND NEW."cancelledAt" IS NOT NULL
    ) THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || OLD."organizationId"::text || ':booking:' || OLD."id"::text,
            0
        )
    );

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_commercial_amendments" amendment
         WHERE amendment."organizationId" = OLD."organizationId"
           AND amendment."bookingId" = OLD."id"
           AND amendment."status" = 'PREPARED'
    ) THEN
        RAISE EXCEPTION 'rental booking cancellation is blocked by a prepared commercial amendment'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rental_bookings_prepared_commercial_amendment_cancellation_guard
ON "rental_bookings";

CREATE TRIGGER rental_bookings_prepared_commercial_amendment_cancellation_guard
BEFORE UPDATE OF "status", "cancelledAt"
ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_cancellation_prepared_amendment();
