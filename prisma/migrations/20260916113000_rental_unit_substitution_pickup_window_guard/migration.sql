CREATE FUNCTION sf_guard_rental_booking_unit_substitution_pickup_window()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    latest_reschedule RECORD;
    expected_starts_on DATE;
    expected_ends_on DATE;
    observed_local_date DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    SELECT booking."id",
           booking."status",
           booking."cancelledAt",
           booking."startsOn",
           booking."endsOn",
           location."timeZone"
      INTO parent_booking
      FROM "rental_bookings" booking
      JOIN "rental_locations" location
        ON location."id" = booking."locationId"
       AND location."organizationId" = booking."organizationId"
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId"
       AND location."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR parent_booking."cancelledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'rental unit substitution requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", parent_booking."startsOn");
    expected_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");

    IF NEW."startsOn" <> expected_starts_on
       OR NEW."endsOn" <> expected_ends_on THEN
        RAISE EXCEPTION 'rental unit substitution effective period is stale'
            USING ERRCODE = '23514';
    END IF;

    observed_local_date := (clock_timestamp() AT TIME ZONE parent_booking."timeZone")::date;

    IF observed_local_date >= expected_ends_on THEN
        RAISE EXCEPTION 'rental unit substitution is not allowed after the committed pickup window closes'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_unit_substitutions_pickup_window_guard
BEFORE INSERT ON "rental_booking_unit_substitutions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_unit_substitution_pickup_window();
