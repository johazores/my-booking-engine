CREATE FUNCTION sf_rental_unit_has_overdue_custody(
    organization_id UUID,
    unit_id UUID,
    observed_at TIMESTAMPTZ,
    excluded_booking_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" pickup
          JOIN "rental_bookings" booking
            ON booking."id" = pickup."bookingId"
           AND booking."organizationId" = pickup."organizationId"
          JOIN "rental_locations" location
            ON location."id" = booking."locationId"
           AND location."organizationId" = booking."organizationId"
         WHERE pickup."organizationId" = organization_id
           AND pickup."unitId" = unit_id
           AND pickup."kind" = 'PICKED_UP'
           AND booking."status" = 'CONFIRMED'
           AND (excluded_booking_id IS NULL OR booking."id" <> excluded_booking_id)
           AND NOT EXISTS (
                SELECT 1
                  FROM "rental_booking_fulfillment_events" returned
                 WHERE returned."organizationId" = pickup."organizationId"
                   AND returned."bookingId" = pickup."bookingId"
                   AND returned."kind" = 'RETURNED'
           )
           AND (observed_at AT TIME ZONE location."timeZone")::date >= pickup."endsOn"
    );
$$;

CREATE FUNCTION sf_guard_rental_hold_overdue_custody()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" <> 'ACTIVE' OR NEW."expiresAt" <= clock_timestamp() THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."unitId"::text,
            0
        )
    );

    IF sf_rental_unit_has_overdue_custody(
        NEW."organizationId",
        NEW."unitId",
        clock_timestamp(),
        NULL
    ) THEN
        RAISE EXCEPTION 'rental availability hold cannot use a unit with overdue open custody'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_availability_holds_overdue_custody_guard
BEFORE INSERT OR UPDATE OF "organizationId", "unitId", "status", "expiresAt"
ON "rental_availability_holds"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_hold_overdue_custody();

CREATE FUNCTION sf_guard_rental_allocation_overdue_custody()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."unitId"::text,
            0
        )
    );

    IF sf_rental_unit_has_overdue_custody(
        NEW."organizationId",
        NEW."unitId",
        clock_timestamp(),
        NEW."bookingId"
    ) THEN
        RAISE EXCEPTION 'rental booking allocation cannot use a unit with overdue open custody'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_allocations_overdue_custody_guard
BEFORE INSERT OR UPDATE OF "organizationId", "bookingId", "unitId", "startsOn", "endsOn"
ON "rental_booking_allocations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_allocation_overdue_custody();

CREATE FUNCTION sf_guard_rental_substitution_overdue_custody()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."targetUnitId"::text,
            0
        )
    );

    IF sf_rental_unit_has_overdue_custody(
        NEW."organizationId",
        NEW."targetUnitId",
        clock_timestamp(),
        NEW."bookingId"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution cannot target a unit with overdue open custody'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_unit_substitutions_overdue_custody_guard
BEFORE INSERT ON "rental_booking_unit_substitutions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_substitution_overdue_custody();
