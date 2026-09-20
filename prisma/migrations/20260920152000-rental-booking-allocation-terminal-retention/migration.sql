DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "rental_bookings" booking
         WHERE NOT EXISTS (
               SELECT 1
                 FROM "rental_booking_allocations" allocation
                WHERE allocation."organizationId" = booking."organizationId"
                  AND allocation."bookingId" = booking."id"
           )
    ) THEN
        RAISE EXCEPTION 'existing rental booking is missing retained physical allocation evidence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS rental_booking_allocations_confirmed_retention_guard
ON "rental_booking_allocations";

DROP FUNCTION IF EXISTS sf_guard_confirmed_rental_booking_allocation_retention();

CREATE FUNCTION sf_guard_rental_booking_allocation_retention()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "rental_bookings" booking
         WHERE booking."organizationId" = OLD."organizationId"
           AND booking."id" = OLD."bookingId"
    ) THEN
        RAISE EXCEPTION 'rental booking must retain physical allocation evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_booking_allocations_booking_retention_guard
AFTER DELETE ON "rental_booking_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_allocation_retention();
