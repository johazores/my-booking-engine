CREATE FUNCTION sf_guard_rental_booking_pickup_prepared_amendment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_commercial_amendments" amendment
         WHERE amendment."organizationId" = NEW."organizationId"
           AND amendment."bookingId" = NEW."bookingId"
           AND amendment."status" = 'PREPARED'
    ) THEN
        RAISE EXCEPTION 'rental pickup cannot start while a commercial amendment is prepared'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_fulfillment_events_prepared_amendment_pickup_guard
BEFORE INSERT ON "rental_booking_fulfillment_events"
FOR EACH ROW
WHEN (NEW."kind" = 'PICKED_UP')
EXECUTE FUNCTION sf_guard_rental_booking_pickup_prepared_amendment();
