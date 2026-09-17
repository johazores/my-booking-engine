CREATE TYPE "RentalLateReturnAssessmentOutcome" AS ENUM ('FEE_ASSESSED', 'WAIVED');

CREATE TABLE "rental_late_return_assessments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "returnEventId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "outcome" "RentalLateReturnAssessmentOutcome" NOT NULL,
    "committedEndsOn" DATE NOT NULL,
    "returnedAt" TIMESTAMPTZ(6) NOT NULL,
    "lateDays" INTEGER NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "chargeableDays" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "feeMinor" BIGINT,
    "reason" VARCHAR(2000) NOT NULL,
    "assessedAt" TIMESTAMPTZ(6) NOT NULL,
    "assessedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_late_return_assessments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_late_return_assessments_idempotency_check" CHECK (
        "idempotencyKey" = ('rental-late-return-assessment:' || "bookingId"::text)
    ),
    CONSTRAINT "rental_late_return_assessments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_late_return_assessments_days_check" CHECK (
        "lateDays" >= 1 AND "graceDays" BETWEEN 0 AND 30 AND "chargeableDays" = GREATEST(0, "lateDays" - "graceDays")
    ),
    CONSTRAINT "rental_late_return_assessments_reason_check" CHECK (btrim("reason") <> ''),
    CONSTRAINT "rental_late_return_assessments_outcome_check" CHECK (
        ("outcome" = 'FEE_ASSESSED' AND "chargeableDays" > 0 AND "feeMinor" IS NOT NULL AND "feeMinor" > 0)
        OR ("outcome" = 'WAIVED' AND "feeMinor" IS NULL)
    )
);

CREATE UNIQUE INDEX "rental_late_return_assessments_id_org_key" ON "rental_late_return_assessments"("id", "organizationId");
CREATE UNIQUE INDEX "rental_late_return_assessments_org_booking_key" ON "rental_late_return_assessments"("organizationId", "bookingId");
CREATE UNIQUE INDEX "rental_late_return_assessments_org_idempotency_key" ON "rental_late_return_assessments"("organizationId", "idempotencyKey");
CREATE INDEX "rental_late_return_assessments_org_outcome_assessed_idx" ON "rental_late_return_assessments"("organizationId", "outcome", "assessedAt");

ALTER TABLE "rental_late_return_assessments" ADD CONSTRAINT "rental_late_return_assessments_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId") REFERENCES "rental_bookings"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rental_late_return_assessments" ADD CONSTRAINT "rental_late_return_assessments_return_event_fkey"
FOREIGN KEY ("returnEventId", "organizationId") REFERENCES "rental_booking_fulfillment_events"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_late_return_assessment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    booking_currency CHAR(3);
    booking_timezone VARCHAR(80);
    return_kind "RentalBookingFulfillmentEventKind";
    return_booking_id UUID;
    return_unit_id UUID;
    return_starts_on DATE;
    return_ends_on DATE;
    return_occurred_at TIMESTAMPTZ;
    pickup_starts_on DATE;
    pickup_ends_on DATE;
    pickup_occurred_at TIMESTAMPTZ;
    actual_late_days INTEGER;
    authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental late-return assessments are append-only' USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text, 0
    ));

    SELECT booking."currency", location."timeZone"
      INTO booking_currency, booking_timezone
      FROM "rental_bookings" booking
      JOIN "rental_locations" location
        ON location."organizationId" = booking."organizationId"
       AND location."id" = booking."locationId"
     WHERE booking."organizationId" = NEW."organizationId"
       AND booking."id" = NEW."bookingId"
       AND booking."status" = 'CONFIRMED';
    IF booking_currency IS NULL OR booking_timezone IS NULL THEN
        RAISE EXCEPTION 'late-return assessment requires a confirmed tenant booking' USING ERRCODE = '23514';
    END IF;

    SELECT event."kind", event."bookingId", event."unitId", event."startsOn", event."endsOn", event."occurredAt"
      INTO return_kind, return_booking_id, return_unit_id, return_starts_on, return_ends_on, return_occurred_at
      FROM "rental_booking_fulfillment_events" event
     WHERE event."organizationId" = NEW."organizationId"
       AND event."id" = NEW."returnEventId";
    IF return_kind IS NULL OR return_kind <> 'RETURNED' OR return_booking_id <> NEW."bookingId" OR return_unit_id <> NEW."unitId" THEN
        RAISE EXCEPTION 'late-return assessment requires exact retained return evidence' USING ERRCODE = '23514';
    END IF;

    SELECT event."startsOn", event."endsOn", event."occurredAt"
      INTO pickup_starts_on, pickup_ends_on, pickup_occurred_at
      FROM "rental_booking_fulfillment_events" event
     WHERE event."organizationId" = NEW."organizationId"
       AND event."bookingId" = NEW."bookingId"
       AND event."kind" = 'PICKED_UP'
       AND event."unitId" = NEW."unitId";
    IF pickup_occurred_at IS NULL
       OR pickup_starts_on <> return_starts_on
       OR pickup_ends_on <> return_ends_on
       OR return_occurred_at < pickup_occurred_at THEN
        RAISE EXCEPTION 'late-return assessment requires consistent pickup and return custody evidence' USING ERRCODE = '23514';
    END IF;

    actual_late_days := ((return_occurred_at AT TIME ZONE booking_timezone)::date - return_ends_on) + 1;
    IF actual_late_days < 1 THEN
        RAISE EXCEPTION 'late-return assessment requires a return after the committed rental period' USING ERRCODE = '23514';
    END IF;
    IF NEW."committedEndsOn" <> return_ends_on
       OR NEW."returnedAt" <> return_occurred_at
       OR NEW."lateDays" <> actual_late_days
       OR NEW."chargeableDays" <> GREATEST(0, actual_late_days - NEW."graceDays")
       OR NEW."currency" <> booking_currency
       OR NEW."idempotencyKey" <> ('rental-late-return-assessment:' || NEW."bookingId"::text) THEN
        RAISE EXCEPTION 'late-return assessment does not match retained booking and custody authority' USING ERRCODE = '23514';
    END IF;
    IF NEW."outcome" = 'FEE_ASSESSED' AND (NEW."chargeableDays" <= 0 OR NEW."feeMinor" IS NULL OR NEW."feeMinor" <= 0) THEN
        RAISE EXCEPTION 'late-return fee requires chargeable days and a positive amount' USING ERRCODE = '23514';
    ELSIF NEW."outcome" = 'WAIVED' AND NEW."feeMinor" IS NOT NULL THEN
        RAISE EXCEPTION 'waived late-return assessment cannot retain a fee amount' USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();
    NEW."assessedAt" := authored_at;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_late_return_assessments_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_late_return_assessments"
FOR EACH ROW EXECUTE FUNCTION sf_author_rental_late_return_assessment();
