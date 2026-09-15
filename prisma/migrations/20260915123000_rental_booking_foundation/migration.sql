CREATE TABLE "rental_bookings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerFirstName" VARCHAR(80) NOT NULL,
    "customerLastName" VARCHAR(80) NOT NULL,
    "customerEmail" VARCHAR(320),
    "customerPhone" VARCHAR(40),
    "holdId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "unitTypeId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "pricingFingerprint" CHAR(64) NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "pricingObservedAt" TIMESTAMPTZ(6) NOT NULL,
    "authorityFingerprint" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL,
    "cancelledAt" TIMESTAMPTZ(6),
    CONSTRAINT "rental_bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rental_booking_allocations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_booking_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_bookings_id_organization_key"
ON "rental_bookings"("id", "organizationId");

CREATE UNIQUE INDEX "rental_bookings_org_idempotency_key"
ON "rental_bookings"("organizationId", "idempotencyKey");

CREATE UNIQUE INDEX "rental_bookings_org_hold_key"
ON "rental_bookings"("organizationId", "holdId");

CREATE INDEX "rental_bookings_org_status_created_idx"
ON "rental_bookings"("organizationId", "status", "createdAt");

CREATE INDEX "rental_bookings_customer_created_idx"
ON "rental_bookings"("organizationId", "customerId", "createdAt");

CREATE INDEX "rental_bookings_unit_dates_idx"
ON "rental_bookings"("organizationId", "unitId", "startsOn", "endsOn");

CREATE UNIQUE INDEX "rental_booking_allocations_org_booking_key"
ON "rental_booking_allocations"("organizationId", "bookingId");

CREATE INDEX "rental_booking_allocations_unit_dates_idx"
ON "rental_booking_allocations"("organizationId", "unitId", "startsOn", "endsOn");

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_hold_fkey"
FOREIGN KEY ("holdId", "organizationId") REFERENCES "rental_availability_holds"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_unit_fkey"
FOREIGN KEY ("unitId", "organizationId") REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_unit_type_fkey"
FOREIGN KEY ("unitTypeId", "organizationId") REFERENCES "rental_unit_types"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_location_fkey"
FOREIGN KEY ("locationId", "organizationId") REFERENCES "rental_locations"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_allocations"
ADD CONSTRAINT "rental_booking_allocations_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId") REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_booking_allocations"
ADD CONSTRAINT "rental_booking_allocations_unit_fkey"
FOREIGN KEY ("unitId", "organizationId") REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_date_range_check"
CHECK ("startsOn" < "endsOn");

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_total_check"
CHECK ("totalMinor" > 0);

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_currency_check"
CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_pricing_fingerprint_check"
CHECK ("pricingFingerprint" ~ '^[a-f0-9]{64}$');

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_authority_fingerprint_check"
CHECK ("authorityFingerprint" ~ '^[a-f0-9]{64}$');

ALTER TABLE "rental_bookings"
ADD CONSTRAINT "rental_bookings_state_check"
CHECK (
    ("status" = 'CONFIRMED' AND "cancelledAt" IS NULL)
    OR
    ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
);

ALTER TABLE "rental_booking_allocations"
ADD CONSTRAINT "rental_booking_allocations_date_range_check"
CHECK ("startsOn" < "endsOn");

CREATE FUNCTION sf_guard_rental_booking_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    source_hold RECORD;
    current_unit RECORD;
    current_customer RECORD;
BEGIN
    IF NEW."status" <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'new rental bookings must enter as confirmed'
            USING ERRCODE = '23514';
    END IF;

    SELECT customer."id", customer."firstName", customer."lastName", customer."email", customer."phone"
      INTO current_customer
      FROM "customers" customer
     WHERE customer."id" = NEW."customerId"
       AND customer."organizationId" = NEW."organizationId"
       AND customer."status" = 'ACTIVE';

    IF NOT FOUND
       OR current_customer."firstName" IS DISTINCT FROM NEW."customerFirstName"
       OR current_customer."lastName" IS DISTINCT FROM NEW."customerLastName"
       OR current_customer."email" IS DISTINCT FROM NEW."customerEmail"
       OR current_customer."phone" IS DISTINCT FROM NEW."customerPhone" THEN
        RAISE EXCEPTION 'rental booking customer ownership or snapshot is invalid'
            USING ERRCODE = '23514';
    END IF;

    SELECT hold.*
      INTO source_hold
      FROM "rental_availability_holds" hold
     WHERE hold."id" = NEW."holdId"
       AND hold."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR source_hold."status" <> 'CONSUMED'
       OR source_hold."unitId" <> NEW."unitId"
       OR source_hold."startsOn" <> NEW."startsOn"
       OR source_hold."endsOn" <> NEW."endsOn"
       OR source_hold."quotedCurrency" IS DISTINCT FROM NEW."currency"
       OR source_hold."quotedTotalMinor" IS DISTINCT FROM NEW."totalMinor"
       OR source_hold."pricingFingerprint" IS DISTINCT FROM NEW."pricingFingerprint" THEN
        RAISE EXCEPTION 'rental booking source hold evidence is invalid'
            USING ERRCODE = '23514';
    END IF;

    SELECT unit."id", unit."unitTypeId", unit."locationId", unit."status" AS unit_status,
           unit_type."status" AS unit_type_status, location."status" AS location_status
      INTO current_unit
      FROM "rental_units" unit
      JOIN "rental_unit_types" unit_type
        ON unit_type."id" = unit."unitTypeId"
       AND unit_type."organizationId" = unit."organizationId"
      JOIN "rental_locations" location
        ON location."id" = unit."locationId"
       AND location."organizationId" = unit."organizationId"
     WHERE unit."id" = NEW."unitId"
       AND unit."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR current_unit."unitTypeId" <> NEW."unitTypeId"
       OR current_unit."locationId" <> NEW."locationId"
       OR current_unit.unit_status <> 'ACTIVE'
       OR current_unit.unit_type_status <> 'ACTIVE'
       OR current_unit.location_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'rental booking unit ownership or operating assignment is invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_bookings_insert_guard
BEFORE INSERT ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_insert();

CREATE FUNCTION sf_guard_rental_booking_immutable_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
       OR NEW."customerFirstName" IS DISTINCT FROM OLD."customerFirstName"
       OR NEW."customerLastName" IS DISTINCT FROM OLD."customerLastName"
       OR NEW."customerEmail" IS DISTINCT FROM OLD."customerEmail"
       OR NEW."customerPhone" IS DISTINCT FROM OLD."customerPhone"
       OR NEW."holdId" IS DISTINCT FROM OLD."holdId"
       OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
       OR NEW."unitTypeId" IS DISTINCT FROM OLD."unitTypeId"
       OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."startsOn" IS DISTINCT FROM OLD."startsOn"
       OR NEW."endsOn" IS DISTINCT FROM OLD."endsOn"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."totalMinor" IS DISTINCT FROM OLD."totalMinor"
       OR NEW."pricingFingerprint" IS DISTINCT FROM OLD."pricingFingerprint"
       OR NEW."pricingSnapshot" IS DISTINCT FROM OLD."pricingSnapshot"
       OR NEW."pricingObservedAt" IS DISTINCT FROM OLD."pricingObservedAt"
       OR NEW."authorityFingerprint" IS DISTINCT FROM OLD."authorityFingerprint"
       OR NEW."confirmedAt" IS DISTINCT FROM OLD."confirmedAt" THEN
        RAISE EXCEPTION 'rental booking commercial and ownership evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_bookings_immutable_evidence_guard
BEFORE UPDATE ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_immutable_evidence();

CREATE FUNCTION sf_guard_rental_booking_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
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

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR parent_booking."unitId" <> NEW."unitId"
       OR parent_booking."startsOn" <> NEW."startsOn"
       OR parent_booking."endsOn" <> NEW."endsOn" THEN
        RAISE EXCEPTION 'rental booking allocation does not match its confirmed booking'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_availability_blocks" block
         WHERE block."organizationId" = NEW."organizationId"
           AND block."unitId" = NEW."unitId"
           AND block."startsOn" < NEW."endsOn"
           AND block."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental booking allocation overlaps an unavailable-date block'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_availability_holds" hold
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

CREATE TRIGGER rental_booking_allocations_guard
BEFORE INSERT OR UPDATE OF "organizationId", "bookingId", "unitId", "startsOn", "endsOn"
ON "rental_booking_allocations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_allocation();

CREATE FUNCTION sf_guard_rental_booking_requires_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'CONFIRMED' AND NOT EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."bookingId" = NEW."id"
           AND allocation."unitId" = NEW."unitId"
           AND allocation."startsOn" = NEW."startsOn"
           AND allocation."endsOn" = NEW."endsOn"
    ) THEN
        RAISE EXCEPTION 'confirmed rental booking requires an exact physical-unit allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rental_bookings_require_allocation_guard
AFTER INSERT OR UPDATE OF "status", "unitId", "startsOn", "endsOn"
ON "rental_bookings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_requires_allocation();

CREATE OR REPLACE FUNCTION sf_guard_rental_hold_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" <> 'ACTIVE' OR NEW."expiresAt" <= CURRENT_TIMESTAMP THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."unitId"::text,
            0
        )
    );

    IF EXISTS (
        SELECT 1
        FROM "rental_availability_blocks" block
        WHERE block."organizationId" = NEW."organizationId"
          AND block."unitId" = NEW."unitId"
          AND block."startsOn" < NEW."endsOn"
          AND block."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental availability hold overlaps an unavailable-date block'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "rental_availability_holds" hold
        WHERE hold."organizationId" = NEW."organizationId"
          AND hold."unitId" = NEW."unitId"
          AND hold."id" <> NEW."id"
          AND hold."status" = 'ACTIVE'
          AND hold."expiresAt" > CURRENT_TIMESTAMP
          AND hold."startsOn" < NEW."endsOn"
          AND hold."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental availability hold overlaps another active hold'
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
           AND booking."status" <> 'CANCELLED'
           AND allocation."startsOn" < NEW."endsOn"
           AND allocation."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental availability hold overlaps an active booking'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_block_against_holds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || NEW."unitId"::text,
            0
        )
    );

    IF EXISTS (
        SELECT 1
        FROM "rental_availability_holds" hold
        WHERE hold."organizationId" = NEW."organizationId"
          AND hold."unitId" = NEW."unitId"
          AND hold."status" = 'ACTIVE'
          AND hold."expiresAt" > CURRENT_TIMESTAMP
          AND hold."startsOn" < NEW."endsOn"
          AND hold."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unavailable-date block overlaps an active hold'
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
           AND booking."status" <> 'CANCELLED'
           AND allocation."startsOn" < NEW."endsOn"
           AND allocation."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unavailable-date block overlaps an active booking'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_unit_mutation_against_holds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."locationId" IS NOT DISTINCT FROM OLD."locationId"
       AND NEW."unitTypeId" IS NOT DISTINCT FROM OLD."unitTypeId"
       AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
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
        FROM "rental_availability_holds" hold
        WHERE hold."organizationId" = OLD."organizationId"
          AND hold."unitId" = OLD."id"
          AND hold."status" = 'ACTIVE'
          AND hold."expiresAt" > CURRENT_TIMESTAMP
    ) THEN
        RAISE EXCEPTION 'release active rental availability holds before changing this rental unit'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = OLD."organizationId"
           AND allocation."unitId" = OLD."id"
           AND booking."status" <> 'CANCELLED'
           AND allocation."endsOn" > CURRENT_DATE
    ) THEN
        RAISE EXCEPTION 'active or future rental bookings must be resolved before changing this rental unit'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;
