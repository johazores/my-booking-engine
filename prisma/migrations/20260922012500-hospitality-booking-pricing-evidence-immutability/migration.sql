CREATE FUNCTION sf_guard_hospitality_booking_pricing_evidence_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'hospitality booking pricing evidence is immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER hospitality_booking_pricing_evidence_update_guard
BEFORE UPDATE ON "hospitality_booking_pricing_evidence"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_booking_pricing_evidence_update();

CREATE FUNCTION sf_guard_hospitality_booking_pricing_evidence_deletion()
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
        RAISE EXCEPTION 'hospitality booking pricing evidence is append-only while the booking is retained'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_booking_pricing_evidence_deletion_guard
AFTER DELETE ON "hospitality_booking_pricing_evidence"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_booking_pricing_evidence_deletion();
