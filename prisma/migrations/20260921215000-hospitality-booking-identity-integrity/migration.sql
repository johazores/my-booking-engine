CREATE FUNCTION sf_guard_hospitality_booking_identity_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'hospitality booking identity evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_bookings_identity_evidence_guard
BEFORE UPDATE OF "id", "createdAt"
ON "hospitality_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_booking_identity_evidence();

CREATE FUNCTION sf_guard_hospitality_booking_allocation_identity_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
       OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId" THEN
        RAISE EXCEPTION 'hospitality booking allocation identity and ownership evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER hospitality_booking_allocations_identity_evidence_guard
BEFORE UPDATE OF "id", "createdAt", "organizationId", "bookingId"
ON "hospitality_booking_allocations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_hospitality_booking_allocation_identity_evidence();
