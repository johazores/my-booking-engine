DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "rental_availability_holds" hold
         WHERE hold."status" = 'CONSUMED'
           AND NOT EXISTS (
               SELECT 1
                 FROM "rental_bookings" booking
                WHERE booking."organizationId" = hold."organizationId"
                  AND booking."holdId" = hold."id"
           )
    ) THEN
        RAISE EXCEPTION 'existing consumed rental hold is missing retained booking evidence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION sf_guard_rental_hold_consumption_booking_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    current_status TEXT;
BEGIN
    SELECT hold."status"::text
      INTO current_status
      FROM "rental_availability_holds" hold
     WHERE hold."id" = NEW."id"
       AND hold."organizationId" = NEW."organizationId";

    IF NOT FOUND OR current_status <> 'CONSUMED' THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM "rental_bookings" booking
         WHERE booking."organizationId" = NEW."organizationId"
           AND booking."holdId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'consumed rental hold must be retained by a rental booking'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_availability_holds_consumed_booking_guard
AFTER INSERT OR UPDATE ON "rental_availability_holds"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_hold_consumption_booking_integrity();
