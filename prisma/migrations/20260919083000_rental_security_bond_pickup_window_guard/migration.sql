CREATE FUNCTION sf_guard_rental_security_bond_fresh_write_window()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    latest_reschedule RECORD;
    retained_location RECORD;
    effective_ends_on DATE;
    observed_local_date DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    SELECT booking."endsOn", booking."locationId", booking."status", booking."cancelledAt"
      INTO parent_booking
      FROM "rental_bookings" booking
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR parent_booking."cancelledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'fresh rental security bond authority requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" event
         WHERE event."organizationId" = NEW."organizationId"
           AND event."bookingId" = NEW."bookingId"
    ) THEN
        RAISE EXCEPTION 'fresh rental security bond authority closes after physical custody begins'
            USING ERRCODE = '23514';
    END IF;

    SELECT reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    effective_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");

    SELECT location."timeZone"
      INTO retained_location
      FROM "rental_locations" location
     WHERE location."id" = parent_booking."locationId"
       AND location."organizationId" = NEW."organizationId";

    IF NOT FOUND OR retained_location."timeZone" IS NULL THEN
        RAISE EXCEPTION 'fresh rental security bond authority requires the retained booking location timezone'
            USING ERRCODE = '23514';
    END IF;

    observed_local_date := (clock_timestamp() AT TIME ZONE retained_location."timeZone")::date;

    IF observed_local_date >= effective_ends_on THEN
        RAISE EXCEPTION 'fresh rental security bond authority closes at the exclusive committed rental end date'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_security_bond_requirements_pickup_window_guard
BEFORE INSERT ON "rental_security_bond_requirements"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_security_bond_fresh_write_window();

CREATE TRIGGER rental_security_bond_transactions_pickup_window_guard
BEFORE INSERT ON "rental_security_bond_transactions"
FOR EACH ROW
WHEN (NEW."kind" = 'OFFLINE_PAYMENT')
EXECUTE FUNCTION sf_guard_rental_security_bond_fresh_write_window();
