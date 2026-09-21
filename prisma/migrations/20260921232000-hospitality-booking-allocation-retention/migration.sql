DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "hospitality_bookings" booking
         WHERE NOT EXISTS (
               SELECT 1
                 FROM "hospitality_booking_allocations" allocation
                WHERE allocation."organizationId" = booking."organizationId"
                  AND allocation."bookingId" = booking."id"
           )
    ) THEN
        RAISE EXCEPTION 'existing hospitality booking is missing retained allocation evidence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION sf_guard_hospitality_booking_allocation_retention()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "hospitality_bookings" booking
         WHERE booking."organizationId" = OLD."organizationId"
           AND booking."id" = OLD."bookingId"
    ) THEN
        RAISE EXCEPTION 'hospitality booking must retain allocation evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_booking_allocations_booking_retention_guard
AFTER DELETE ON "hospitality_booking_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_booking_allocation_retention();
