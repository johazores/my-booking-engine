CREATE TABLE "rental_availability_holds" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "AvailabilityHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_availability_holds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rental_availability_holds_id_organizationId_key"
ON "rental_availability_holds"("id", "organizationId");

CREATE UNIQUE INDEX "rental_availability_holds_organizationId_idempotencyKey_key"
ON "rental_availability_holds"("organizationId", "idempotencyKey");

CREATE INDEX "rental_availability_holds_organizationId_unitId_status_startsOn_endsOn_idx"
ON "rental_availability_holds"("organizationId", "unitId", "status", "startsOn", "endsOn");

CREATE INDEX "rental_availability_holds_organizationId_status_expiresAt_idx"
ON "rental_availability_holds"("organizationId", "status", "expiresAt");

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_unitId_organizationId_fkey"
FOREIGN KEY ("unitId", "organizationId") REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_date_range_check"
CHECK ("startsOn" < "endsOn");

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_expiry_check"
CHECK ("expiresAt" > "createdAt");

ALTER TABLE "rental_availability_holds"
ADD CONSTRAINT "rental_availability_holds_state_check"
CHECK (
    ("status" = 'ACTIVE' AND "endedAt" IS NULL)
    OR
    ("status" IN ('RELEASED', 'EXPIRED', 'CONSUMED') AND "endedAt" IS NOT NULL)
);

CREATE FUNCTION sf_guard_rental_hold_overlap()
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

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_availability_holds_overlap_guard
BEFORE INSERT OR UPDATE OF "unitId", "organizationId", "startsOn", "endsOn", "status", "expiresAt"
ON "rental_availability_holds"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_hold_overlap();

CREATE FUNCTION sf_guard_rental_block_against_holds()
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

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_availability_blocks_hold_guard
BEFORE INSERT OR UPDATE OF "unitId", "organizationId", "startsOn", "endsOn"
ON "rental_availability_blocks"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_block_against_holds();

CREATE FUNCTION sf_guard_rental_unit_mutation_against_holds()
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

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_units_active_hold_guard
BEFORE UPDATE OF "locationId", "unitTypeId", "status"
ON "rental_units"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_mutation_against_holds();
