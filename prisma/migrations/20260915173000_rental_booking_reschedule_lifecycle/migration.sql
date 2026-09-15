CREATE TABLE "rental_booking_reschedules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "sourceStartsOn" DATE NOT NULL,
    "sourceEndsOn" DATE NOT NULL,
    "targetStartsOn" DATE NOT NULL,
    "targetEndsOn" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "sourcePricingFingerprint" CHAR(64) NOT NULL,
    "targetPricingFingerprint" CHAR(64) NOT NULL,
    "targetPricingSnapshot" JSONB NOT NULL,
    "authorityFingerprint" CHAR(64) NOT NULL,
    "appliedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_booking_reschedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_booking_reschedules_id_organization_key"
ON "rental_booking_reschedules"("id", "organizationId");

CREATE UNIQUE INDEX "rental_booking_reschedules_org_idempotency_key"
ON "rental_booking_reschedules"("organizationId", "idempotencyKey");

CREATE INDEX "rental_booking_reschedules_booking_applied_idx"
ON "rental_booking_reschedules"("organizationId", "bookingId", "appliedAt");

ALTER TABLE "rental_booking_reschedules"
ADD CONSTRAINT "rental_booking_reschedules_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_reschedules"
ADD CONSTRAINT "rental_booking_reschedules_source_date_check"
CHECK ("sourceStartsOn" < "sourceEndsOn");

ALTER TABLE "rental_booking_reschedules"
ADD CONSTRAINT "rental_booking_reschedules_target_date_check"
CHECK ("targetStartsOn" < "targetEndsOn");

ALTER TABLE "rental_booking_reschedules"
ADD CONSTRAINT "rental_booking_reschedules_change_check"
CHECK ("sourceStartsOn" <> "targetStartsOn" OR "sourceEndsOn" <> "targetEndsOn");

ALTER TABLE "rental_booking_reschedules"
ADD CONSTRAINT "rental_booking_reschedules_money_check"
CHECK ("totalMinor" > 0 AND "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "rental_booking_reschedules"
ADD CONSTRAINT "rental_booking_reschedules_fingerprint_check"
CHECK (
    "sourcePricingFingerprint" ~ '^[a-f0-9]{64}$'
    AND "targetPricingFingerprint" ~ '^[a-f0-9]{64}$'
    AND "authorityFingerprint" ~ '^[a-f0-9]{64}$'
);

CREATE FUNCTION sf_guard_rental_booking_reschedule_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    current_allocation RECORD;
    previous_reschedule RECORD;
    expected_source_pricing_fingerprint CHAR(64);
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
        RAISE EXCEPTION 'rental reschedule requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || parent_booking."unitId"::text,
            0
        )
    );

    SELECT allocation.*
      INTO current_allocation
      FROM "rental_booking_allocations" allocation
     WHERE allocation."organizationId" = NEW."organizationId"
       AND allocation."bookingId" = NEW."bookingId"
       AND allocation."unitId" = parent_booking."unitId";

    IF NOT FOUND
       OR current_allocation."startsOn" <> NEW."sourceStartsOn"
       OR current_allocation."endsOn" <> NEW."sourceEndsOn" THEN
        RAISE EXCEPTION 'rental reschedule source allocation is stale'
            USING ERRCODE = '23514';
    END IF;

    SELECT reschedule."targetPricingFingerprint"
      INTO previous_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_source_pricing_fingerprint :=
        COALESCE(previous_reschedule."targetPricingFingerprint", parent_booking."pricingFingerprint");

    IF NEW."currency" <> parent_booking."currency"
       OR NEW."totalMinor" <> parent_booking."totalMinor"
       OR NEW."sourcePricingFingerprint" <> expected_source_pricing_fingerprint
       OR NEW."appliedAt" < parent_booking."confirmedAt" THEN
        RAISE EXCEPTION 'rental reschedule commercial evidence is stale or inconsistent'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_reschedules_insert_guard
BEFORE INSERT ON "rental_booking_reschedules"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_reschedule_insert();

CREATE FUNCTION sf_guard_rental_booking_reschedule_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rental booking reschedule evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER rental_booking_reschedules_append_only_guard
BEFORE UPDATE OR DELETE ON "rental_booking_reschedules"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_reschedule_append_only();

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    latest_reschedule RECORD;
    expected_starts_on DATE;
    expected_ends_on DATE;
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

    IF NOT FOUND OR parent_booking."status" <> 'CONFIRMED' OR parent_booking."unitId" <> NEW."unitId" THEN
        RAISE EXCEPTION 'rental booking allocation does not match its confirmed booking'
            USING ERRCODE = '23514';
    END IF;

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", parent_booking."startsOn");
    expected_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");

    IF NEW."startsOn" <> expected_starts_on OR NEW."endsOn" <> expected_ends_on THEN
        RAISE EXCEPTION 'rental booking allocation does not match effective booking dates'
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
           AND hold."expiresAt" > CURRENT_TIMESTAMP
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
    expected_starts_on DATE;
    expected_ends_on DATE;
BEGIN
    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."id"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", NEW."startsOn");
    expected_ends_on := COALESCE(latest_reschedule."targetEndsOn", NEW."endsOn");

    IF NEW."status" = 'CONFIRMED' AND NOT EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."bookingId" = NEW."id"
           AND allocation."unitId" = NEW."unitId"
           AND allocation."startsOn" = expected_starts_on
           AND allocation."endsOn" = expected_ends_on
    ) THEN
        RAISE EXCEPTION 'confirmed rental booking requires its effective physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE FUNCTION sf_guard_rental_booking_reschedule_requires_allocation()
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
           AND allocation."unitId" = booking."unitId"
           AND allocation."startsOn" = NEW."targetStartsOn"
           AND allocation."endsOn" = NEW."targetEndsOn"
    ) THEN
        RAISE EXCEPTION 'rental reschedule requires the target physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_booking_reschedules_require_allocation_guard
AFTER INSERT ON "rental_booking_reschedules"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_reschedule_requires_allocation();
