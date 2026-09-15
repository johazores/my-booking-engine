CREATE TABLE "rental_booking_unit_substitutions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "sourceUnitId" UUID NOT NULL,
    "targetUnitId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "pricingFingerprint" CHAR(64) NOT NULL,
    "authorityFingerprint" CHAR(64) NOT NULL,
    "appliedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_booking_unit_substitutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_booking_unit_substitutions_id_organization_key"
ON "rental_booking_unit_substitutions"("id", "organizationId");

CREATE UNIQUE INDEX "rental_booking_unit_substitutions_org_idempotency_key"
ON "rental_booking_unit_substitutions"("organizationId", "idempotencyKey");

CREATE INDEX "rental_booking_unit_substitutions_booking_applied_idx"
ON "rental_booking_unit_substitutions"("organizationId", "bookingId", "appliedAt");

CREATE INDEX "rental_booking_unit_substitutions_source_applied_idx"
ON "rental_booking_unit_substitutions"("organizationId", "sourceUnitId", "appliedAt");

CREATE INDEX "rental_booking_unit_substitutions_target_applied_idx"
ON "rental_booking_unit_substitutions"("organizationId", "targetUnitId", "appliedAt");

ALTER TABLE "rental_booking_unit_substitutions"
ADD CONSTRAINT "rental_booking_unit_substitutions_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_unit_substitutions"
ADD CONSTRAINT "rental_booking_unit_substitutions_source_unit_fkey"
FOREIGN KEY ("sourceUnitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_unit_substitutions"
ADD CONSTRAINT "rental_booking_unit_substitutions_target_unit_fkey"
FOREIGN KEY ("targetUnitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_unit_substitutions"
ADD CONSTRAINT "rental_booking_unit_substitutions_unit_change_check"
CHECK ("sourceUnitId" <> "targetUnitId");

ALTER TABLE "rental_booking_unit_substitutions"
ADD CONSTRAINT "rental_booking_unit_substitutions_date_check"
CHECK ("startsOn" < "endsOn");

ALTER TABLE "rental_booking_unit_substitutions"
ADD CONSTRAINT "rental_booking_unit_substitutions_money_check"
CHECK ("totalMinor" > 0 AND "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "rental_booking_unit_substitutions"
ADD CONSTRAINT "rental_booking_unit_substitutions_fingerprint_check"
CHECK (
    "pricingFingerprint" ~ '^[a-f0-9]{64}$'
    AND "authorityFingerprint" ~ '^[a-f0-9]{64}$'
);

CREATE FUNCTION sf_rental_booking_effective_unit_id(
    organization_id UUID,
    booking_id UUID
)
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT substitution."targetUnitId"
              FROM "rental_booking_unit_substitutions" substitution
             WHERE substitution."organizationId" = organization_id
               AND substitution."bookingId" = booking_id
             ORDER BY substitution."appliedAt" DESC, substitution."createdAt" DESC, substitution."id" DESC
             LIMIT 1
        ),
        (
            SELECT booking."unitId"
              FROM "rental_bookings" booking
             WHERE booking."organizationId" = organization_id
               AND booking."id" = booking_id
        )
    );
$$;

CREATE FUNCTION sf_guard_rental_booking_unit_substitution_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    current_allocation RECORD;
    latest_reschedule RECORD;
    source_unit RECORD;
    target_unit RECORD;
    expected_source_unit_id UUID;
    expected_starts_on DATE;
    expected_ends_on DATE;
    expected_pricing_fingerprint CHAR(64);
    locked_unit_id UUID;
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
        RAISE EXCEPTION 'rental unit substitution requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    expected_source_unit_id := sf_rental_booking_effective_unit_id(
        NEW."organizationId",
        NEW."bookingId"
    );

    IF expected_source_unit_id IS NULL
       OR NEW."sourceUnitId" <> expected_source_unit_id
       OR NEW."targetUnitId" = expected_source_unit_id THEN
        RAISE EXCEPTION 'rental unit substitution source or target unit is stale'
            USING ERRCODE = '23514';
    END IF;

    FOR locked_unit_id IN
        SELECT unit_id
          FROM (
              VALUES (NEW."sourceUnitId"), (NEW."targetUnitId")
          ) AS locked_units(unit_id)
         ORDER BY unit_id::text
    LOOP
        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                'sf:rental-unit:' || NEW."organizationId"::text || ':' || locked_unit_id::text,
                0
            )
        );
    END LOOP;

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn", reschedule."targetPricingFingerprint"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", parent_booking."startsOn");
    expected_ends_on := COALESCE(latest_reschedule."targetEndsOn", parent_booking."endsOn");
    expected_pricing_fingerprint := COALESCE(
        latest_reschedule."targetPricingFingerprint",
        parent_booking."pricingFingerprint"
    );

    SELECT allocation.*
      INTO current_allocation
      FROM "rental_booking_allocations" allocation
     WHERE allocation."organizationId" = NEW."organizationId"
       AND allocation."bookingId" = NEW."bookingId"
       AND allocation."unitId" = expected_source_unit_id;

    IF NOT FOUND
       OR current_allocation."startsOn" <> expected_starts_on
       OR current_allocation."endsOn" <> expected_ends_on THEN
        RAISE EXCEPTION 'rental unit substitution source allocation is stale'
            USING ERRCODE = '23514';
    END IF;

    SELECT unit."id", unit."unitTypeId", unit."locationId", unit."status",
           unit_type."status" AS unit_type_status, location."status" AS location_status
      INTO source_unit
      FROM "rental_units" unit
      JOIN "rental_unit_types" unit_type
        ON unit_type."id" = unit."unitTypeId"
       AND unit_type."organizationId" = unit."organizationId"
      JOIN "rental_locations" location
        ON location."id" = unit."locationId"
       AND location."organizationId" = unit."organizationId"
     WHERE unit."id" = NEW."sourceUnitId"
       AND unit."organizationId" = NEW."organizationId";

    SELECT unit."id", unit."unitTypeId", unit."locationId", unit."status",
           unit_type."status" AS unit_type_status, location."status" AS location_status
      INTO target_unit
      FROM "rental_units" unit
      JOIN "rental_unit_types" unit_type
        ON unit_type."id" = unit."unitTypeId"
       AND unit_type."organizationId" = unit."organizationId"
      JOIN "rental_locations" location
        ON location."id" = unit."locationId"
       AND location."organizationId" = unit."organizationId"
     WHERE unit."id" = NEW."targetUnitId"
       AND unit."organizationId" = NEW."organizationId";

    IF source_unit."id" IS NULL
       OR target_unit."id" IS NULL
       OR source_unit."status" <> 'ACTIVE'
       OR target_unit."status" <> 'ACTIVE'
       OR source_unit.unit_type_status <> 'ACTIVE'
       OR target_unit.unit_type_status <> 'ACTIVE'
       OR source_unit.location_status <> 'ACTIVE'
       OR target_unit.location_status <> 'ACTIVE'
       OR source_unit."unitTypeId" <> parent_booking."unitTypeId"
       OR target_unit."unitTypeId" <> parent_booking."unitTypeId"
       OR source_unit."locationId" <> parent_booking."locationId"
       OR target_unit."locationId" <> parent_booking."locationId" THEN
        RAISE EXCEPTION 'rental unit substitution requires active same-type same-location units'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."startsOn" <> expected_starts_on
       OR NEW."endsOn" <> expected_ends_on
       OR NEW."currency" <> parent_booking."currency"
       OR NEW."totalMinor" <> parent_booking."totalMinor"
       OR NEW."pricingFingerprint" <> expected_pricing_fingerprint
       OR NEW."appliedAt" < parent_booking."confirmedAt" THEN
        RAISE EXCEPTION 'rental unit substitution commercial or effective-period evidence is stale'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_availability_blocks" block
         WHERE block."organizationId" = NEW."organizationId"
           AND block."unitId" = NEW."targetUnitId"
           AND block."startsOn" < NEW."endsOn"
           AND block."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution target overlaps an unavailable-date block'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_availability_holds" hold
         WHERE hold."organizationId" = NEW."organizationId"
           AND hold."unitId" = NEW."targetUnitId"
           AND hold."status" = 'ACTIVE'
           AND hold."expiresAt" > clock_timestamp()
           AND hold."startsOn" < NEW."endsOn"
           AND hold."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution target overlaps an active availability hold'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."unitId" = NEW."targetUnitId"
           AND allocation."bookingId" <> NEW."bookingId"
           AND booking."status" <> 'CANCELLED'
           AND allocation."startsOn" < NEW."endsOn"
           AND allocation."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution target overlaps another active booking'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_unit_substitutions_insert_guard
BEFORE INSERT ON "rental_booking_unit_substitutions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_unit_substitution_insert();

CREATE FUNCTION sf_guard_rental_booking_unit_substitution_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'rental booking unit substitution evidence is append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER rental_booking_unit_substitutions_append_only_guard
BEFORE UPDATE OR DELETE ON "rental_booking_unit_substitutions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_unit_substitution_append_only();

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    latest_reschedule RECORD;
    expected_unit_id UUID;
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
    expected_unit_id UUID;
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

    expected_unit_id := sf_rental_booking_effective_unit_id(NEW."organizationId", NEW."id");
    expected_starts_on := COALESCE(latest_reschedule."targetStartsOn", NEW."startsOn");
    expected_ends_on := COALESCE(latest_reschedule."targetEndsOn", NEW."endsOn");

    IF NEW."status" = 'CONFIRMED' AND NOT EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."bookingId" = NEW."id"
           AND allocation."unitId" = expected_unit_id
           AND allocation."startsOn" = expected_starts_on
           AND allocation."endsOn" = expected_ends_on
    ) THEN
        RAISE EXCEPTION 'confirmed rental booking requires its effective physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_reschedule_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    current_allocation RECORD;
    previous_reschedule RECORD;
    expected_unit_id UUID;
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

    expected_unit_id := sf_rental_booking_effective_unit_id(NEW."organizationId", NEW."bookingId");
    IF expected_unit_id IS NULL THEN
        RAISE EXCEPTION 'rental reschedule effective unit is unavailable'
            USING ERRCODE = '23514';
    END IF;

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
       AND allocation."bookingId" = NEW."bookingId"
       AND allocation."unitId" = expected_unit_id;

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

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_reschedule_requires_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    expected_unit_id UUID;
BEGIN
    expected_unit_id := sf_rental_booking_effective_unit_id(NEW."organizationId", NEW."bookingId");

    IF NOT EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."bookingId" = NEW."bookingId"
           AND booking."status" = 'CONFIRMED'
           AND allocation."unitId" = expected_unit_id
           AND allocation."startsOn" = NEW."targetStartsOn"
           AND allocation."endsOn" = NEW."targetEndsOn"
    ) THEN
        RAISE EXCEPTION 'rental reschedule requires the target effective physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE FUNCTION sf_guard_rental_booking_unit_substitution_requires_allocation()
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
           AND allocation."unitId" = NEW."targetUnitId"
           AND allocation."startsOn" = NEW."startsOn"
           AND allocation."endsOn" = NEW."endsOn"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution requires the target physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_booking_unit_substitutions_require_allocation_guard
AFTER INSERT ON "rental_booking_unit_substitutions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_unit_substitution_requires_allocation();

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    expected_unit_id UUID;
BEGIN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status"
       AND NEW."cancelledAt" IS NOT DISTINCT FROM OLD."cancelledAt" THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || OLD."organizationId"::text || ':booking:' || OLD."id"::text,
            0
        )
    );

    expected_unit_id := sf_rental_booking_effective_unit_id(OLD."organizationId", OLD."id");
    IF expected_unit_id IS NULL THEN
        RAISE EXCEPTION 'rental booking lifecycle effective unit is unavailable'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || OLD."organizationId"::text || ':' || expected_unit_id::text,
            0
        )
    );

    IF OLD."status" = 'CONFIRMED'
       AND OLD."cancelledAt" IS NULL
       AND NEW."status" = 'CANCELLED'
       AND NEW."cancelledAt" IS NOT NULL
       AND NEW."cancelledAt" >= OLD."confirmedAt" THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'unsupported rental booking lifecycle transition'
        USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION sf_guard_rental_unit_active_booking_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" IS NOT DISTINCT FROM OLD."status"
       AND NEW."locationId" IS NOT DISTINCT FROM OLD."locationId"
       AND NEW."unitTypeId" IS NOT DISTINCT FROM OLD."unitTypeId" THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || OLD."organizationId"::text || ':' || OLD."id"::text,
            0
        )
    );

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = OLD."organizationId"
           AND allocation."unitId" = OLD."id"
           AND booking."status" <> 'CANCELLED'
    ) THEN
        RAISE EXCEPTION 'rental unit with an active booking allocation cannot be archived, relocated, or retyped'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_units_active_booking_assignment_guard
BEFORE UPDATE OF "status", "locationId", "unitTypeId"
ON "rental_units"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_active_booking_assignment();
