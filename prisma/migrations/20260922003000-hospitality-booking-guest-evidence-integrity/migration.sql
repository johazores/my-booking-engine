DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "hospitality_bookings" booking
         WHERE NOT EXISTS (
               SELECT 1
                 FROM "hospitality_booking_guests" guest
                WHERE guest."organizationId" = booking."organizationId"
                  AND guest."bookingId" = booking."id"
           )
    ) THEN
        RAISE EXCEPTION 'existing hospitality booking is missing retained guest evidence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION sf_require_hospitality_booking_guest_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM "hospitality_booking_guests" guest
         WHERE guest."organizationId" = NEW."organizationId"
           AND guest."bookingId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'hospitality booking must retain guest evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_bookings_guest_evidence_guard
AFTER INSERT ON "hospitality_bookings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_require_hospitality_booking_guest_evidence();

CREATE FUNCTION sf_guard_hospitality_booking_guest_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'hospitality booking guest rows are replace-only through the controlled traveler workflow'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER hospitality_booking_guests_update_guard
BEFORE UPDATE ON "hospitality_booking_guests"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_booking_guest_update();

CREATE FUNCTION sf_guard_cancelled_hospitality_booking_guest_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "hospitality_bookings" booking
         WHERE booking."organizationId" = NEW."organizationId"
           AND booking."id" = NEW."bookingId"
           AND booking."status" = 'CANCELLED'
    ) THEN
        RAISE EXCEPTION 'cancelled hospitality booking guest history is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_booking_guests_cancelled_insert_guard
BEFORE INSERT ON "hospitality_booking_guests"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_cancelled_hospitality_booking_guest_insert();

CREATE FUNCTION sf_guard_hospitality_booking_guest_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    booking_status TEXT;
BEGIN
    SELECT booking."status"::text
      INTO booking_status
      FROM "hospitality_bookings" booking
     WHERE booking."organizationId" = OLD."organizationId"
       AND booking."id" = OLD."bookingId";

    IF booking_status IS NULL THEN
        RETURN NULL;
    END IF;

    IF booking_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'cancelled hospitality booking guest history is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM "hospitality_booking_guests" guest
         WHERE guest."organizationId" = OLD."organizationId"
           AND guest."bookingId" = OLD."bookingId"
    ) THEN
        RAISE EXCEPTION 'hospitality booking must retain guest evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_booking_guests_deletion_guard
AFTER DELETE ON "hospitality_booking_guests"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_booking_guest_deletion();
