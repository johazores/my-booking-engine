DROP TRIGGER hospitality_bookings_guest_evidence_guard ON "hospitality_bookings";
DROP FUNCTION sf_require_hospitality_booking_guest_evidence();

CREATE FUNCTION sf_require_hospitality_booking_guest_evidence_for_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'CANCELLED'
       AND OLD."status" IS DISTINCT FROM NEW."status"
       AND NOT EXISTS (
           SELECT 1
             FROM "hospitality_booking_guests" guest
            WHERE guest."organizationId" = NEW."organizationId"
              AND guest."bookingId" = NEW."id"
       ) THEN
        RAISE EXCEPTION 'hospitality booking cancellation requires retained guest evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_bookings_guest_cancellation_guard
BEFORE UPDATE OF "status" ON "hospitality_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_require_hospitality_booking_guest_evidence_for_cancellation();
