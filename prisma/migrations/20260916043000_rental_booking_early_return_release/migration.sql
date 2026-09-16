CREATE TABLE "rental_booking_early_return_releases" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "returnEventId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "committedStartsOn" DATE NOT NULL,
    "committedEndsOn" DATE NOT NULL,
    "releasedEndsOn" DATE NOT NULL,
    "returnedAt" TIMESTAMPTZ(6) NOT NULL,
    "releasedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_booking_early_return_releases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_booking_early_return_releases_id_org_key"
ON "rental_booking_early_return_releases"("id", "organizationId");

CREATE UNIQUE INDEX "rental_booking_early_return_releases_org_booking_key"
ON "rental_booking_early_return_releases"("organizationId", "bookingId");

CREATE UNIQUE INDEX "rental_booking_early_return_releases_org_return_event_key"
ON "rental_booking_early_return_releases"("organizationId", "returnEventId");

CREATE UNIQUE INDEX "rental_booking_early_return_releases_org_idempotency_key"
ON "rental_booking_early_return_releases"("organizationId", "idempotencyKey");

CREATE INDEX "rental_booking_early_return_releases_unit_released_idx"
ON "rental_booking_early_return_releases"("organizationId", "unitId", "releasedAt");

ALTER TABLE "rental_booking_early_return_releases"
ADD CONSTRAINT "rental_booking_early_return_releases_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_early_return_releases"
ADD CONSTRAINT "rental_booking_early_return_releases_unit_fkey"
FOREIGN KEY ("unitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_early_return_releases"
ADD CONSTRAINT "rental_booking_early_return_releases_return_event_fkey"
FOREIGN KEY ("returnEventId", "organizationId")
REFERENCES "rental_booking_fulfillment_events"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_early_return_releases"
ADD CONSTRAINT "rental_booking_early_return_releases_date_check"
CHECK (
    "committedStartsOn" < "releasedEndsOn"
    AND "releasedEndsOn" < "committedEndsOn"
);

ALTER TABLE "rental_booking_early_return_releases"
ADD CONSTRAINT "rental_booking_early_return_releases_time_check"
CHECK ("returnedAt" <= "releasedAt");

CREATE FUNCTION sf_guard_rental_booking_early_return_release_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    latest_reschedule RECORD;
    return_event RECORD;
    current_allocation RECORD;
    expected_unit_id UUID;
    expected_starts_on DATE;
    expected_ends_on DATE;
    expected_released_ends_on DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    SELECT booking.*, location."timeZone" AS location_time_zone
      INTO parent_booking
      FROM "rental_bookings" booking
      JOIN "rental_locations" location
        ON location."id" = booking."locationId"
       AND location."organizationId" = booking."organizationId"
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR parent_booking."cancelledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'early-return inventory release requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    expected_unit_id := sf_rental_booking_effective_unit_id(
        NEW."organizationId",
        NEW."bookingId"
    );
    IF expected_unit_id IS NULL OR NEW."unitId" <> expected_unit_id THEN
        RAISE EXCEPTION 'early-return inventory release unit authority is stale'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || expected_unit_id::text,
            0
        )
    );

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", parent_booking."startsOn");
    expected_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");

    SELECT event.*
      INTO return_event
      FROM "rental_booking_fulfillment_events" event
     WHERE event."id" = NEW."returnEventId"
       AND event."organizationId" = NEW."organizationId"
       AND event."bookingId" = NEW."bookingId"
       AND event."kind" = 'RETURNED';

    IF NOT FOUND
       OR return_event."unitId" <> expected_unit_id
       OR return_event."startsOn" <> expected_starts_on
       OR return_event."endsOn" <> expected_ends_on
       OR NEW."returnedAt" <> return_event."occurredAt" THEN
        RAISE EXCEPTION 'early-return inventory release requires exact return custody evidence'
            USING ERRCODE = '23514';
    END IF;

    SELECT allocation.*
      INTO current_allocation
      FROM "rental_booking_allocations" allocation
     WHERE allocation."organizationId" = NEW."organizationId"
       AND allocation."bookingId" = NEW."bookingId";

    IF NOT FOUND
       OR current_allocation."unitId" <> expected_unit_id
       OR current_allocation."startsOn" <> expected_starts_on
       OR current_allocation."endsOn" <> expected_ends_on
       OR NEW."committedStartsOn" <> expected_starts_on
       OR NEW."committedEndsOn" <> expected_ends_on THEN
        RAISE EXCEPTION 'early-return inventory release requires the exact committed allocation'
            USING ERRCODE = '23514';
    END IF;

    expected_released_ends_on := GREATEST(
        (NEW."returnedAt" AT TIME ZONE parent_booking.location_time_zone)::date + 1,
        expected_starts_on + 1
    );

    IF expected_released_ends_on >= expected_ends_on
       OR NEW."releasedEndsOn" <> expected_released_ends_on
       OR NEW."releasedAt" < NEW."returnedAt" THEN
        RAISE EXCEPTION 'early-return inventory release does not free a complete remaining rental day'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_early_return_releases_insert_guard
BEFORE INSERT ON "rental_booking_early_return_releases"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_early_return_release_insert();

CREATE FUNCTION sf_guard_rental_booking_early_return_release_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rental booking early-return release evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER rental_booking_early_return_releases_append_only_guard
BEFORE UPDATE OR DELETE ON "rental_booking_early_return_releases"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_early_return_release_append_only();

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    latest_reschedule RECORD;
    early_release RECORD;
    expected_unit_id UUID;
    expected_starts_on DATE;
    expected_committed_ends_on DATE;
    expected_allocation_ends_on DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."unitId"::text,
            0
        )
    );

    SELECT booking."id", booking."unitId", booking."startsOn", booking."endsOn", booking."status"
      INTO parent_booking
      FROM "rental_bookings" booking
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId";

    expected_unit_id := sf_rental_booking_effective_unit_id(
        NEW."organizationId",
        NEW."bookingId"
    );

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR expected_unit_id IS NULL
       OR expected_unit_id <> NEW."unitId" THEN
        RAISE EXCEPTION 'rental booking allocation does not match its effective confirmed unit'
            USING ERRCODE = '23514';
    END IF;

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    SELECT release."releasedEndsOn"
      INTO early_release
      FROM "rental_booking_early_return_releases" release
     WHERE release."organizationId" = NEW."organizationId"
       AND release."bookingId" = NEW."bookingId"
     LIMIT 1;

    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", parent_booking."startsOn");
    expected_committed_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");
    expected_allocation_ends_on := COALESCE(
        early_release."releasedEndsOn",
        expected_committed_ends_on
    );

    IF NEW."startsOn" <> expected_starts_on OR NEW."endsOn" <> expected_allocation_ends_on THEN
        RAISE EXCEPTION 'rental booking allocation does not match effective inventory dates'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "rental_availability_blocks" block
         WHERE block."organizationId" = NEW."organizationId"
           AND block."unitId" = NEW."unitId"
           AND block."startsOn" < NEW."endsOn"
           AND block."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental booking allocation overlaps an unavailable-date block'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "rental_availability_holds" hold
         WHERE hold."organizationId" = NEW."organizationId"
           AND hold."unitId" = NEW."unitId"
           AND hold."status" = 'ACTIVE'
           AND hold."expiresAt" > clock_timestamp()
           AND hold."startsOn" < NEW."endsOn"
           AND hold."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental booking allocation overlaps an active availability hold'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."unitId" = NEW."unitId"
           AND allocation."id" <> NEW."id"
           AND booking."status" <> 'CANCELLED'
           AND allocation."startsOn" < NEW."endsOn"
           AND allocation."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental booking allocation overlaps another active booking'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_requires_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    latest_reschedule RECORD;
    early_release RECORD;
    expected_unit_id UUID;
    expected_starts_on DATE;
    expected_committed_ends_on DATE;
    expected_allocation_ends_on DATE;
BEGIN
    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."id"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    SELECT release."releasedEndsOn"
      INTO early_release
      FROM "rental_booking_early_return_releases" release
     WHERE release."organizationId" = NEW."organizationId"
       AND release."bookingId" = NEW."id"
     LIMIT 1;

    expected_unit_id := sf_rental_booking_effective_unit_id(NEW."organizationId", NEW."id");
    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", NEW."startsOn");
    expected_committed_ends_on := COALESCE(latest_reschedule."targetEndsOn", NEW."endsOn");
    expected_allocation_ends_on := COALESCE(
        early_release."releasedEndsOn",
        expected_committed_ends_on
    );

    IF NEW."status" = 'CONFIRMED' AND NOT EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."bookingId" = NEW."id"
           AND allocation."unitId" = expected_unit_id
           AND allocation."startsOn" = expected_starts_on
           AND allocation."endsOn" = expected_allocation_ends_on
    ) THEN
        RAISE EXCEPTION 'confirmed rental booking requires its effective physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE FUNCTION sf_guard_rental_booking_early_return_release_requires_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."bookingId" = NEW."bookingId"
           AND booking."status" = 'CONFIRMED'
           AND allocation."unitId" = NEW."unitId"
           AND allocation."startsOn" = NEW."committedStartsOn"
           AND allocation."endsOn" = NEW."releasedEndsOn"
    ) THEN
        RAISE EXCEPTION 'early-return inventory release requires the shortened physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_booking_early_return_releases_require_allocation_guard
AFTER INSERT ON "rental_booking_early_return_releases"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_early_return_release_requires_allocation();
