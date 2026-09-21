CREATE FUNCTION sf_guard_cancelled_hospitality_booking_allocation_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (
        NEW."propertyId" IS DISTINCT FROM OLD."propertyId"
        OR NEW."roomTypeId" IS DISTINCT FROM OLD."roomTypeId"
        OR NEW."arrivalDate" IS DISTINCT FROM OLD."arrivalDate"
        OR NEW."departureDate" IS DISTINCT FROM OLD."departureDate"
        OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
    ) AND EXISTS (
        SELECT 1
          FROM "hospitality_bookings" booking
         WHERE booking."organizationId" = OLD."organizationId"
           AND booking."id" = OLD."bookingId"
           AND booking."status" = 'CANCELLED'
    ) THEN
        RAISE EXCEPTION 'cancelled hospitality booking allocation history is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_booking_allocations_cancelled_history_guard
BEFORE UPDATE OF "propertyId", "roomTypeId", "arrivalDate", "departureDate", "quantity"
ON "hospitality_booking_allocations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_cancelled_hospitality_booking_allocation_history();
