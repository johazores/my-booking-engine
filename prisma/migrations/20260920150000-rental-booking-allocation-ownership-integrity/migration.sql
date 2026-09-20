DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "rental_bookings" booking
         WHERE booking."status" = 'CONFIRMED'
           AND NOT EXISTS (
               SELECT 1
                 FROM "rental_booking_allocations" allocation
                WHERE allocation."organizationId" = booking."organizationId"
                  AND allocation."bookingId" = booking."id"
           )
    ) THEN
        RAISE EXCEPTION 'existing confirmed rental booking is missing physical allocation evidence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION sf_guard_rental_booking_allocation_owner_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId" THEN
        RAISE EXCEPTION 'rental booking allocation ownership is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_allocations_owner_identity_guard
BEFORE UPDATE OF "organizationId", "bookingId"
ON "rental_booking_allocations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_allocation_owner_identity();

CREATE FUNCTION sf_guard_confirmed_rental_booking_allocation_retention()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "rental_bookings" booking
         WHERE booking."organizationId" = OLD."organizationId"
           AND booking."id" = OLD."bookingId"
           AND booking."status" = 'CONFIRMED'
    ) THEN
        RAISE EXCEPTION 'confirmed rental booking must retain physical allocation evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_booking_allocations_confirmed_retention_guard
AFTER DELETE ON "rental_booking_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_confirmed_rental_booking_allocation_retention();
