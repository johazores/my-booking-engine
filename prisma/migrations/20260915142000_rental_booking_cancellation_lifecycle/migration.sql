ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_cancelled_after_confirmed_check"
CHECK ("cancelledAt" IS NULL OR "cancelledAt" >= "confirmedAt");

CREATE FUNCTION sf_guard_rental_booking_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status"
       AND NEW."cancelledAt" IS NOT DISTINCT FROM OLD."cancelledAt" THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || OLD."organizationId"::text || ':' || OLD."unitId"::text,
            0
        )
    );

    IF OLD."status" = 'CONFIRMED'
       AND OLD."cancelledAt" IS NULL
       AND NEW."status" = 'CANCELLED'
       AND NEW."cancelledAt" IS NOT NULL
       AND NEW."cancelledAt" >= OLD."confirmedAt" THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'unsupported rental booking lifecycle transition'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER rental_bookings_lifecycle_guard
BEFORE UPDATE OF "status", "cancelledAt"
ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_lifecycle_transition();
