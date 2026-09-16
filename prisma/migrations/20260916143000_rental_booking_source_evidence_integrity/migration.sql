CREATE FUNCTION sf_guard_rental_booking_source_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    source_hold RECORD;
BEGIN
    SELECT hold."pricingSnapshot", hold."pricingObservedAt"
      INTO source_hold
      FROM "rental_availability_holds" hold
     WHERE hold."id" = NEW."holdId"
       AND hold."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR source_hold."pricingObservedAt" IS NULL
       OR source_hold."pricingSnapshot" IS DISTINCT FROM NEW."pricingSnapshot" THEN
        RAISE EXCEPTION 'rental booking pricing snapshot must match retained source hold evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_bookings_source_snapshot_guard
BEFORE INSERT ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_source_snapshot();

CREATE FUNCTION sf_guard_booked_rental_hold_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    referenced_booking_id UUID;
BEGIN
    SELECT booking."id"
      INTO referenced_booking_id
      FROM "rental_bookings" booking
     WHERE booking."organizationId" = OLD."organizationId"
       AND booking."holdId" = OLD."id"
     LIMIT 1;

    IF NOT FOUND THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'rental booking source hold evidence is retained and cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
       OR NEW."startsOn" IS DISTINCT FROM OLD."startsOn"
       OR NEW."endsOn" IS DISTINCT FROM OLD."endsOn"
       OR NEW."status" IS DISTINCT FROM OLD."status"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
       OR NEW."endedAt" IS DISTINCT FROM OLD."endedAt"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."quotedCurrency" IS DISTINCT FROM OLD."quotedCurrency"
       OR NEW."quotedTotalMinor" IS DISTINCT FROM OLD."quotedTotalMinor"
       OR NEW."pricingFingerprint" IS DISTINCT FROM OLD."pricingFingerprint"
       OR NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot"
       OR NEW."pricingObservedAt" IS DISTINCT FROM OLD."pricingObservedAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'rental booking source hold evidence is immutable after confirmation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_availability_holds_booked_evidence_guard
BEFORE UPDATE OR DELETE ON "rental_availability_holds"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_booked_rental_hold_immutable();
