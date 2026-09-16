CREATE TYPE "RentalBookingFulfillmentEventKind" AS ENUM ('PICKED_UP', 'RETURNED');

CREATE TABLE "rental_booking_fulfillment_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "kind" "RentalBookingFulfillmentEventKind" NOT NULL,
    "unitId" UUID NOT NULL,
    "unitCode" VARCHAR(32) NOT NULL,
    "unitName" VARCHAR(160) NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_booking_fulfillment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_booking_fulfillment_events_id_org_key"
ON "rental_booking_fulfillment_events"("id", "organizationId");

CREATE UNIQUE INDEX "rental_booking_fulfillment_events_org_booking_kind_key"
ON "rental_booking_fulfillment_events"("organizationId", "bookingId", "kind");

CREATE UNIQUE INDEX "rental_booking_fulfillment_events_org_idempotency_key"
ON "rental_booking_fulfillment_events"("organizationId", "idempotencyKey");

CREATE INDEX "rental_booking_fulfillment_events_booking_occurred_idx"
ON "rental_booking_fulfillment_events"("organizationId", "bookingId", "occurredAt");

CREATE INDEX "rental_booking_fulfillment_events_unit_occurred_idx"
ON "rental_booking_fulfillment_events"("organizationId", "unitId", "occurredAt");

ALTER TABLE "rental_booking_fulfillment_events"
ADD CONSTRAINT "rental_booking_fulfillment_events_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_fulfillment_events"
ADD CONSTRAINT "rental_booking_fulfillment_events_unit_fkey"
FOREIGN KEY ("unitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_fulfillment_events"
ADD CONSTRAINT "rental_booking_fulfillment_events_date_check"
CHECK ("startsOn" < "endsOn");

CREATE FUNCTION sf_guard_rental_booking_fulfillment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    current_allocation RECORD;
    latest_reschedule RECORD;
    latest_substitution RECORD;
    current_unit RECORD;
    expected_unit_id UUID;
    expected_starts_on DATE;
    expected_ends_on DATE;
    pickup_event RECORD;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    SELECT booking.*
      INTO parent_booking
      FROM "rental_bookings" booking
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR parent_booking."cancelledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'rental fulfillment requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    SELECT substitution."targetUnitId"
      INTO latest_substitution
      FROM "rental_booking_unit_substitutions" substitution
     WHERE substitution."organizationId" = NEW."organizationId"
       AND substitution."bookingId" = NEW."bookingId"
     ORDER BY substitution."appliedAt" DESC, substitution."createdAt" DESC, substitution."id" DESC
     LIMIT 1;

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_unit_id := COALESCE(latest_substitution."targetUnitId", parent_booking."unitId");
    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", parent_booking."startsOn");
    expected_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || expected_unit_id::text,
            0
        )
    );

    SELECT allocation.*
      INTO current_allocation
      FROM "rental_booking_allocations" allocation
     WHERE allocation."organizationId" = NEW."organizationId"
       AND allocation."bookingId" = NEW."bookingId";

    IF NOT FOUND
       OR current_allocation."unitId" <> expected_unit_id
       OR current_allocation."startsOn" <> expected_starts_on
       OR current_allocation."endsOn" <> expected_ends_on
       OR NEW."unitId" <> expected_unit_id
       OR NEW."startsOn" <> expected_starts_on
       OR NEW."endsOn" <> expected_ends_on THEN
        RAISE EXCEPTION 'rental fulfillment evidence does not match the current effective allocation'
            USING ERRCODE = '23514';
    END IF;

    SELECT unit."id", unit."code", unit."name", unit."status", unit."unitTypeId", unit."locationId"
      INTO current_unit
      FROM "rental_units" unit
     WHERE unit."organizationId" = NEW."organizationId"
       AND unit."id" = expected_unit_id;

    IF current_unit."id" IS NULL
       OR current_unit."status" <> 'ACTIVE'
       OR current_unit."unitTypeId" <> parent_booking."unitTypeId"
       OR current_unit."locationId" IS DISTINCT FROM parent_booking."locationId"
       OR NEW."unitCode" <> current_unit."code"
       OR NEW."unitName" <> current_unit."name" THEN
        RAISE EXCEPTION 'rental fulfillment requires the active effective booking unit snapshot'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."occurredAt" < parent_booking."confirmedAt" THEN
        RAISE EXCEPTION 'rental fulfillment cannot predate booking confirmation'
            USING ERRCODE = '23514';
    END IF;

    SELECT event.*
      INTO pickup_event
      FROM "rental_booking_fulfillment_events" event
     WHERE event."organizationId" = NEW."organizationId"
       AND event."bookingId" = NEW."bookingId"
       AND event."kind" = 'PICKED_UP'
     LIMIT 1;

    IF NEW."kind" = 'PICKED_UP' AND pickup_event."id" IS NOT NULL THEN
        RAISE EXCEPTION 'rental pickup evidence already exists'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."kind" = 'RETURNED' THEN
        IF pickup_event."id" IS NULL OR NEW."occurredAt" < pickup_event."occurredAt" THEN
            RAISE EXCEPTION 'rental return requires earlier pickup evidence'
                USING ERRCODE = '23514';
        END IF;
        IF EXISTS (
            SELECT 1
              FROM "rental_booking_fulfillment_events" event
             WHERE event."organizationId" = NEW."organizationId"
               AND event."bookingId" = NEW."bookingId"
               AND event."kind" = 'RETURNED'
        ) THEN
            RAISE EXCEPTION 'rental return evidence already exists'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_fulfillment_events_insert_guard
BEFORE INSERT ON "rental_booking_fulfillment_events"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_fulfillment_insert();

CREATE FUNCTION sf_guard_rental_booking_fulfillment_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rental booking fulfillment evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER rental_booking_fulfillment_events_append_only_guard
BEFORE UPDATE OR DELETE ON "rental_booking_fulfillment_events"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_fulfillment_append_only();

CREATE FUNCTION sf_guard_rental_booking_pre_fulfillment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    guard_organization_id UUID;
    guard_booking_id UUID;
BEGIN
    guard_organization_id := NEW."organizationId";
    IF TG_TABLE_NAME = 'rental_bookings' THEN
        guard_booking_id := NEW."id";
    ELSE
        guard_booking_id := NEW."bookingId";
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || guard_organization_id::text || ':booking:' || guard_booking_id::text,
            0
        )
    );

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" event
         WHERE event."organizationId" = guard_organization_id
           AND event."bookingId" = guard_booking_id
    ) THEN
        RAISE EXCEPTION 'rental booking cannot be cancelled, rescheduled, or reassigned after pickup'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_reschedules_pre_fulfillment_guard
BEFORE INSERT ON "rental_booking_reschedules"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_pre_fulfillment_change();

CREATE TRIGGER rental_booking_unit_substitutions_pre_fulfillment_guard
BEFORE INSERT ON "rental_booking_unit_substitutions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_pre_fulfillment_change();

CREATE TRIGGER rental_bookings_cancellation_pre_fulfillment_guard
BEFORE UPDATE OF "status", "cancelledAt" ON "rental_bookings"
FOR EACH ROW
WHEN (NEW."status" = 'CANCELLED')
EXECUTE FUNCTION sf_guard_rental_booking_pre_fulfillment_change();
