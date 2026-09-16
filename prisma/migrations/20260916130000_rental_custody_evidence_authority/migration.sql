ALTER TABLE "rental_booking_fulfillment_events"
ADD CONSTRAINT "rental_booking_fulfillment_events_idempotency_authority_check"
CHECK (
    "idempotencyKey" = 'rental-fulfillment:' || "bookingId"::text || ':' || lower("kind"::text)
);

CREATE FUNCTION sf_guard_rental_booking_fulfillment_evidence_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    pickup_event RECORD;
    expected_idempotency_key TEXT;
BEGIN
    expected_idempotency_key :=
        'rental-fulfillment:' || NEW."bookingId"::text || ':' || lower(NEW."kind"::text);

    IF NEW."idempotencyKey" <> expected_idempotency_key THEN
        RAISE EXCEPTION 'rental fulfillment idempotency authority is invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."occurredAt" > clock_timestamp() THEN
        RAISE EXCEPTION 'rental fulfillment event time cannot be in the future'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'RETURNED' THEN
        SELECT event."id", event."unitId", event."startsOn", event."endsOn", event."occurredAt"
          INTO pickup_event
          FROM "rental_booking_fulfillment_events" event
         WHERE event."organizationId" = NEW."organizationId"
           AND event."bookingId" = NEW."bookingId"
           AND event."kind" = 'PICKED_UP'
         LIMIT 1;

        IF pickup_event."id" IS NULL
           OR pickup_event."unitId" <> NEW."unitId"
           OR pickup_event."startsOn" <> NEW."startsOn"
           OR pickup_event."endsOn" <> NEW."endsOn"
           OR NEW."occurredAt" < pickup_event."occurredAt" THEN
            RAISE EXCEPTION 'rental return evidence must match the retained pickup assignment and chronology'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_fulfillment_events_evidence_authority_guard
BEFORE INSERT ON "rental_booking_fulfillment_events"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_fulfillment_evidence_authority();

ALTER TABLE "rental_booking_early_return_releases"
ADD CONSTRAINT "rental_booking_early_return_releases_idempotency_authority_check"
CHECK (
    "idempotencyKey" = 'rental-early-return-release:' || "bookingId"::text
);

CREATE FUNCTION sf_guard_rental_booking_early_return_release_evidence_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    expected_idempotency_key TEXT;
BEGIN
    expected_idempotency_key := 'rental-early-return-release:' || NEW."bookingId"::text;

    IF NEW."idempotencyKey" <> expected_idempotency_key THEN
        RAISE EXCEPTION 'early-return release idempotency authority is invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."releasedAt" > clock_timestamp() THEN
        RAISE EXCEPTION 'early-return inventory release time cannot be in the future'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_early_return_releases_evidence_authority_guard
BEFORE INSERT ON "rental_booking_early_return_releases"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_early_return_release_evidence_authority();
