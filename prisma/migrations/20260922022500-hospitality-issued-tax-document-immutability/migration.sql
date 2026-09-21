CREATE FUNCTION sf_guard_hospitality_issued_invoice_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'hospitality issued tax invoice is immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER hospitality_issued_invoice_update_guard
BEFORE UPDATE ON "hospitality_issued_invoices"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_issued_invoice_update();

CREATE FUNCTION sf_guard_hospitality_issued_invoice_deletion()
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
        RAISE EXCEPTION 'hospitality issued tax invoice cannot be deleted while the booking is retained'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_issued_invoice_deletion_guard
AFTER DELETE ON "hospitality_issued_invoices"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_issued_invoice_deletion();

CREATE FUNCTION sf_guard_hospitality_issued_adjustment_note_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'hospitality issued adjustment note is immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER hospitality_issued_adjustment_note_update_guard
BEFORE UPDATE ON "hospitality_issued_adjustment_notes"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_issued_adjustment_note_update();

CREATE FUNCTION sf_guard_hospitality_issued_adjustment_note_deletion()
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
        RAISE EXCEPTION 'hospitality issued adjustment note cannot be deleted while the booking is retained'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER hospitality_issued_adjustment_note_deletion_guard
AFTER DELETE ON "hospitality_issued_adjustment_notes"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_issued_adjustment_note_deletion();
