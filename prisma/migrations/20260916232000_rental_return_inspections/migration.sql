CREATE TYPE "RentalReturnInspectionOutcome" AS ENUM ('CLEAR', 'DAMAGE_REPORTED', 'UNSAFE');

CREATE TABLE "rental_return_inspections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "returnEventId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "outcome" "RentalReturnInspectionOutcome" NOT NULL,
    "notes" VARCHAR(2000),
    "inspectedAt" TIMESTAMPTZ(6) NOT NULL,
    "inspectedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_return_inspections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_return_inspections_idempotency_key_check" CHECK (
        "idempotencyKey" = ('rental-return-inspection:' || "bookingId"::text)
    ),
    CONSTRAINT "rental_return_inspections_notes_check" CHECK (
        ("outcome" = 'CLEAR' AND ("notes" IS NULL OR btrim("notes") <> ''))
        OR
        ("outcome" IN ('DAMAGE_REPORTED', 'UNSAFE') AND "notes" IS NOT NULL AND btrim("notes") <> '')
    )
);

CREATE UNIQUE INDEX "rental_return_inspections_id_org_key"
ON "rental_return_inspections"("id", "organizationId");

CREATE UNIQUE INDEX "rental_return_inspections_org_booking_key"
ON "rental_return_inspections"("organizationId", "bookingId");

CREATE UNIQUE INDEX "rental_return_inspections_org_return_event_key"
ON "rental_return_inspections"("organizationId", "returnEventId");

CREATE UNIQUE INDEX "rental_return_inspections_org_idempotency_key"
ON "rental_return_inspections"("organizationId", "idempotencyKey");

CREATE INDEX "rental_return_inspections_org_unit_inspected_idx"
ON "rental_return_inspections"("organizationId", "unitId", "inspectedAt");

ALTER TABLE "rental_return_inspections"
ADD CONSTRAINT "rental_return_inspections_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_return_inspections"
ADD CONSTRAINT "rental_return_inspections_return_event_fkey"
FOREIGN KEY ("returnEventId", "organizationId")
REFERENCES "rental_booking_fulfillment_events"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_return_inspections"
ADD CONSTRAINT "rental_return_inspections_unit_fkey"
FOREIGN KEY ("unitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_return_inspection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'rental return inspection evidence cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'rental return inspection evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM "rental_bookings" booking
         WHERE booking."organizationId" = NEW."organizationId"
           AND booking."id" = NEW."bookingId"
           AND booking."status" = 'CONFIRMED'
    ) THEN
        RAISE EXCEPTION 'rental return inspection requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" returned
         WHERE returned."organizationId" = NEW."organizationId"
           AND returned."id" = NEW."returnEventId"
           AND returned."bookingId" = NEW."bookingId"
           AND returned."unitId" = NEW."unitId"
           AND returned."kind" = 'RETURNED'
    ) THEN
        RAISE EXCEPTION 'rental return inspection requires matching returned custody evidence'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM "rental_units" unit
         WHERE unit."organizationId" = NEW."organizationId"
           AND unit."id" = NEW."unitId"
           AND unit."status" = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'rental return inspection requires an active retained unit'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."outcome" IN ('DAMAGE_REPORTED', 'UNSAFE') AND NOT EXISTS (
        SELECT 1
          FROM "rental_unit_operational_states" operational_state
         WHERE operational_state."organizationId" = NEW."organizationId"
           AND operational_state."unitId" = NEW."unitId"
           AND operational_state."status" = 'OUT_OF_SERVICE'
    ) THEN
        RAISE EXCEPTION 'non-clear rental return inspection requires the unit to be out of service'
            USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();
    NEW."inspectedAt" := authored_at;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_return_inspections_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_return_inspections"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_return_inspection();
