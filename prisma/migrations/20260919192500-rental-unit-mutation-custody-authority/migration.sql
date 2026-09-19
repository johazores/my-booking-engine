-- Keep physical rental-unit lifecycle mutations aligned with live booking and custody authority.
-- The shared unit lock is acquired before sampling wall-clock time so a transaction that
-- waits across a rental boundary cannot use transaction-start date authority.

CREATE OR REPLACE FUNCTION sf_guard_rental_unit_mutation_against_holds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    wall_clock TIMESTAMPTZ;
BEGIN
    IF NEW."locationId" IS NOT DISTINCT FROM OLD."locationId"
       AND NEW."unitTypeId" IS NOT DISTINCT FROM OLD."unitTypeId"
       AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || OLD."organizationId"::text || ':' || OLD."id"::text,
            0
        )
    );

    wall_clock := clock_timestamp();

    IF EXISTS (
        SELECT 1
          FROM "rental_availability_holds" hold
         WHERE hold."organizationId" = OLD."organizationId"
           AND hold."unitId" = OLD."id"
           AND hold."status" = 'ACTIVE'
           AND hold."expiresAt" > wall_clock
    ) THEN
        RAISE EXCEPTION 'release active rental availability holds before changing this rental unit'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
          JOIN "rental_locations" location
            ON location."id" = booking."locationId"
           AND location."organizationId" = booking."organizationId"
         WHERE allocation."organizationId" = OLD."organizationId"
           AND allocation."unitId" = OLD."id"
           AND booking."status" <> 'CANCELLED'
           AND allocation."endsOn" > (wall_clock AT TIME ZONE location."timeZone")::date
    ) THEN
        RAISE EXCEPTION 'active or future rental bookings must be resolved before changing this rental unit'
            USING ERRCODE = '23P01';
    END IF;

    IF sf_rental_unit_has_overdue_custody(
        OLD."organizationId",
        OLD."id",
        wall_clock,
        NULL
    ) THEN
        RAISE EXCEPTION 'record the outstanding rental return before changing this rental unit'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;
