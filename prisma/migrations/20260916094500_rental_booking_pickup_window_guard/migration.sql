CREATE FUNCTION sf_guard_rental_booking_pickup_window()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    latest_reschedule RECORD;
    retained_location RECORD;
    effective_starts_on DATE;
    effective_ends_on DATE;
    pickup_local_date DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    SELECT booking."startsOn", booking."endsOn", booking."locationId", booking."status", booking."cancelledAt"
      INTO parent_booking
      FROM "rental_bookings" booking
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR parent_booking."cancelledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'rental pickup window requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    effective_starts_on := COALESCE(latest_reschedule."targetStartsOn", parent_booking."startsOn");
    effective_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");

    SELECT location."timeZone"
      INTO retained_location
      FROM "rental_locations" location
     WHERE location."id" = parent_booking."locationId"
       AND location."organizationId" = NEW."organizationId";

    IF NOT FOUND OR retained_location."timeZone" IS NULL THEN
        RAISE EXCEPTION 'rental pickup window requires the retained booking location timezone'
            USING ERRCODE = '23514';
    END IF;

    pickup_local_date := (clock_timestamp() AT TIME ZONE retained_location."timeZone")::date;

    IF pickup_local_date < effective_starts_on THEN
        RAISE EXCEPTION 'rental pickup cannot be recorded before the committed rental start date'
            USING ERRCODE = '23514';
    END IF;

    IF pickup_local_date >= effective_ends_on THEN
        RAISE EXCEPTION 'rental pickup cannot be recorded after the exclusive committed rental end date'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_fulfillment_events_pickup_window_guard
BEFORE INSERT ON "rental_booking_fulfillment_events"
FOR EACH ROW
WHEN (NEW."kind" = 'PICKED_UP')
EXECUTE FUNCTION sf_guard_rental_booking_pickup_window();
