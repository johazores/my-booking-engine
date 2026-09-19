-- Keep live rental-hold trigger decisions on PostgreSQL wall-clock time.
-- Transaction-start timestamps can become stale while a transaction waits on
-- the shared physical-unit lock, so live hold expiry is sampled after serialization.

CREATE OR REPLACE FUNCTION sf_guard_rental_hold_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    wall_clock TIMESTAMPTZ;
BEGIN
    IF NEW."status" <> 'ACTIVE' THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."unitId"::text,
            0
        )
    );

    wall_clock := clock_timestamp();

    IF NEW."expiresAt" <= wall_clock THEN
        RETURN NEW;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "rental_availability_blocks" block
        WHERE block."organizationId" = NEW."organizationId"
          AND block."unitId" = NEW."unitId"
          AND block."startsOn" < NEW."endsOn"
          AND block."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental availability hold overlaps an unavailable-date block'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "rental_availability_holds" hold
        WHERE hold."organizationId" = NEW."organizationId"
          AND hold."unitId" = NEW."unitId"
          AND hold."id" <> NEW."id"
          AND hold."status" = 'ACTIVE'
          AND hold."expiresAt" > wall_clock
          AND hold."startsOn" < NEW."endsOn"
          AND hold."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental availability hold overlaps another active hold'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."unitId" = NEW."unitId"
           AND booking."status" <> 'CANCELLED'
           AND allocation."startsOn" < NEW."endsOn"
           AND allocation."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental availability hold overlaps an active booking'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_block_against_holds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    wall_clock TIMESTAMPTZ;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."unitId"::text,
            0
        )
    );

    wall_clock := clock_timestamp();

    IF EXISTS (
        SELECT 1
        FROM "rental_availability_holds" hold
        WHERE hold."organizationId" = NEW."organizationId"
          AND hold."unitId" = NEW."unitId"
          AND hold."status" = 'ACTIVE'
          AND hold."expiresAt" > wall_clock
          AND hold."startsOn" < NEW."endsOn"
          AND hold."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unavailable-date block overlaps an active hold'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."unitId" = NEW."unitId"
           AND booking."status" <> 'CANCELLED'
           AND allocation."startsOn" < NEW."endsOn"
           AND allocation."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unavailable-date block overlaps an active booking'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

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
         WHERE allocation."organizationId" = OLD."organizationId"
           AND allocation."unitId" = OLD."id"
           AND booking."status" <> 'CANCELLED'
           AND allocation."endsOn" > CURRENT_DATE
    ) THEN
        RAISE EXCEPTION 'active or future rental bookings must be resolved before changing this rental unit'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;
