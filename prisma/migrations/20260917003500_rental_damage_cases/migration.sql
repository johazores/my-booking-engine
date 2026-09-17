CREATE TYPE "RentalDamageCaseStatus" AS ENUM ('OPEN', 'ASSESSED', 'WAIVED', 'CLOSED');

CREATE TABLE "rental_damage_cases" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "status" "RentalDamageCaseStatus" NOT NULL DEFAULT 'OPEN',
    "summary" VARCHAR(1000) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "estimatedRepairCostMinor" BIGINT,
    "assessmentNotes" VARCHAR(2000),
    "assessedAt" TIMESTAMPTZ(6),
    "assessedByUserId" UUID,
    "waivedAt" TIMESTAMPTZ(6),
    "waivedByUserId" UUID,
    "waiverReason" VARCHAR(1000),
    "closedAt" TIMESTAMPTZ(6),
    "closedByUserId" UUID,
    "resolutionNotes" VARCHAR(2000),
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rental_damage_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_damage_cases_idempotency_key_check" CHECK (
        "idempotencyKey" = ('rental-damage-case:' || "bookingId"::text)
    ),
    CONSTRAINT "rental_damage_cases_summary_check" CHECK (btrim("summary") <> ''),
    CONSTRAINT "rental_damage_cases_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_damage_cases_estimated_repair_cost_check" CHECK (
        "estimatedRepairCostMinor" IS NULL OR "estimatedRepairCostMinor" >= 0
    ),
    CONSTRAINT "rental_damage_cases_assessment_evidence_check" CHECK (
        ("assessedAt" IS NULL) = ("assessedByUserId" IS NULL)
        AND ("assessmentNotes" IS NULL OR btrim("assessmentNotes") <> '')
    ),
    CONSTRAINT "rental_damage_cases_waiver_evidence_check" CHECK (
        ("waivedAt" IS NULL) = ("waivedByUserId" IS NULL)
        AND ("waiverReason" IS NULL OR btrim("waiverReason") <> '')
    ),
    CONSTRAINT "rental_damage_cases_closure_evidence_check" CHECK (
        ("closedAt" IS NULL) = ("closedByUserId" IS NULL)
        AND ("resolutionNotes" IS NULL OR btrim("resolutionNotes") <> '')
    ),
    CONSTRAINT "rental_damage_cases_lifecycle_check" CHECK (
        ("status" = 'OPEN'
            AND "estimatedRepairCostMinor" IS NULL
            AND "assessmentNotes" IS NULL
            AND "assessedAt" IS NULL
            AND "waivedAt" IS NULL
            AND "waiverReason" IS NULL
            AND "closedAt" IS NULL
            AND "resolutionNotes" IS NULL)
        OR
        ("status" = 'ASSESSED'
            AND "estimatedRepairCostMinor" IS NOT NULL
            AND "assessmentNotes" IS NOT NULL
            AND "assessedAt" IS NOT NULL
            AND "waivedAt" IS NULL
            AND "waiverReason" IS NULL
            AND "closedAt" IS NULL
            AND "resolutionNotes" IS NULL)
        OR
        ("status" = 'WAIVED'
            AND "waivedAt" IS NOT NULL
            AND "waiverReason" IS NOT NULL
            AND "closedAt" IS NULL
            AND "resolutionNotes" IS NULL)
        OR
        ("status" = 'CLOSED'
            AND "estimatedRepairCostMinor" IS NOT NULL
            AND "assessmentNotes" IS NOT NULL
            AND "assessedAt" IS NOT NULL
            AND "closedAt" IS NOT NULL
            AND "resolutionNotes" IS NOT NULL
            AND "waivedAt" IS NULL
            AND "waiverReason" IS NULL)
    )
);

CREATE UNIQUE INDEX "rental_damage_cases_id_org_key"
ON "rental_damage_cases"("id", "organizationId");
CREATE UNIQUE INDEX "rental_damage_cases_org_booking_key"
ON "rental_damage_cases"("organizationId", "bookingId");
CREATE UNIQUE INDEX "rental_damage_cases_org_inspection_key"
ON "rental_damage_cases"("organizationId", "inspectionId");
CREATE UNIQUE INDEX "rental_damage_cases_org_idempotency_key"
ON "rental_damage_cases"("organizationId", "idempotencyKey");
CREATE INDEX "rental_damage_cases_org_unit_status_opened_idx"
ON "rental_damage_cases"("organizationId", "unitId", "status", "openedAt");
CREATE INDEX "rental_damage_cases_org_status_opened_idx"
ON "rental_damage_cases"("organizationId", "status", "openedAt");

ALTER TABLE "rental_damage_cases"
ADD CONSTRAINT "rental_damage_cases_booking_fkey"
FOREIGN KEY ("bookingId", "organizationId")
REFERENCES "rental_bookings"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_damage_cases"
ADD CONSTRAINT "rental_damage_cases_inspection_fkey"
FOREIGN KEY ("inspectionId", "organizationId")
REFERENCES "rental_return_inspections"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rental_damage_cases"
ADD CONSTRAINT "rental_damage_cases_unit_fkey"
FOREIGN KEY ("unitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_damage_case()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'rental damage cases cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();

    IF TG_OP = 'INSERT' THEN
        IF NEW."idempotencyKey" <> ('rental-damage-case:' || NEW."bookingId"::text) THEN
            RAISE EXCEPTION 'rental damage case idempotency evidence is invalid'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."status" <> 'OPEN'
           OR NEW."estimatedRepairCostMinor" IS NOT NULL
           OR NEW."assessmentNotes" IS NOT NULL
           OR NEW."assessedAt" IS NOT NULL
           OR NEW."assessedByUserId" IS NOT NULL
           OR NEW."waivedAt" IS NOT NULL
           OR NEW."waivedByUserId" IS NOT NULL
           OR NEW."waiverReason" IS NOT NULL
           OR NEW."closedAt" IS NOT NULL
           OR NEW."closedByUserId" IS NOT NULL
           OR NEW."resolutionNotes" IS NOT NULL THEN
            RAISE EXCEPTION 'rental damage cases must start open without assessment or resolution evidence'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM "rental_bookings" booking
             WHERE booking."organizationId" = NEW."organizationId"
               AND booking."id" = NEW."bookingId"
               AND booking."status" = 'CONFIRMED'
               AND booking."currency" = NEW."currency"
        ) THEN
            RAISE EXCEPTION 'rental damage case requires matching confirmed booking currency authority'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM "rental_return_inspections" inspection
             WHERE inspection."organizationId" = NEW."organizationId"
               AND inspection."id" = NEW."inspectionId"
               AND inspection."bookingId" = NEW."bookingId"
               AND inspection."unitId" = NEW."unitId"
               AND inspection."outcome" IN ('DAMAGE_REPORTED', 'UNSAFE')
        ) THEN
            RAISE EXCEPTION 'rental damage case requires matching non-clear return inspection evidence'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM "rental_units" unit
             WHERE unit."organizationId" = NEW."organizationId"
               AND unit."id" = NEW."unitId"
               AND unit."status" = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'rental damage case requires an active retained unit'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM "rental_unit_operational_states" operational_state
             WHERE operational_state."organizationId" = NEW."organizationId"
               AND operational_state."unitId" = NEW."unitId"
               AND operational_state."status" = 'OUT_OF_SERVICE'
        ) THEN
            RAISE EXCEPTION 'rental damage case requires the unit to be out of service'
                USING ERRCODE = '23514';
        END IF;

        NEW."openedAt" := authored_at;
        NEW."createdAt" := authored_at;
        NEW."updatedAt" := authored_at;
        RETURN NEW;
    END IF;

    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
       OR NEW."inspectionId" IS DISTINCT FROM OLD."inspectionId"
       OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."summary" IS DISTINCT FROM OLD."summary"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."openedAt" IS DISTINCT FROM OLD."openedAt"
       OR NEW."openedByUserId" IS DISTINCT FROM OLD."openedByUserId"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'rental damage case source evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."status" IN ('WAIVED', 'CLOSED') THEN
        RAISE EXCEPTION 'terminal rental damage cases are immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = OLD."status" THEN
        RAISE EXCEPTION 'rental damage case updates require a lifecycle transition'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'ASSESSED' THEN
        IF OLD."status" <> 'OPEN'
           OR NEW."estimatedRepairCostMinor" IS NULL
           OR NEW."estimatedRepairCostMinor" < 0
           OR NEW."assessmentNotes" IS NULL
           OR btrim(NEW."assessmentNotes") = ''
           OR NEW."assessedByUserId" IS NULL THEN
            RAISE EXCEPTION 'assessing rental damage requires open status, estimate, notes, and actor evidence'
                USING ERRCODE = '23514';
        END IF;
        NEW."assessedAt" := authored_at;
        NEW."waivedAt" := NULL;
        NEW."waivedByUserId" := NULL;
        NEW."waiverReason" := NULL;
        NEW."closedAt" := NULL;
        NEW."closedByUserId" := NULL;
        NEW."resolutionNotes" := NULL;
    ELSIF NEW."status" = 'WAIVED' THEN
        IF OLD."status" NOT IN ('OPEN', 'ASSESSED')
           OR NEW."waivedByUserId" IS NULL
           OR NEW."waiverReason" IS NULL
           OR btrim(NEW."waiverReason") = '' THEN
            RAISE EXCEPTION 'waiving rental damage requires active status, actor, and reason evidence'
                USING ERRCODE = '23514';
        END IF;
        IF OLD."status" = 'OPEN' THEN
            NEW."estimatedRepairCostMinor" := NULL;
            NEW."assessmentNotes" := NULL;
            NEW."assessedAt" := NULL;
            NEW."assessedByUserId" := NULL;
        ELSE
            NEW."estimatedRepairCostMinor" := OLD."estimatedRepairCostMinor";
            NEW."assessmentNotes" := OLD."assessmentNotes";
            NEW."assessedAt" := OLD."assessedAt";
            NEW."assessedByUserId" := OLD."assessedByUserId";
        END IF;
        NEW."waivedAt" := authored_at;
        NEW."closedAt" := NULL;
        NEW."closedByUserId" := NULL;
        NEW."resolutionNotes" := NULL;
    ELSIF NEW."status" = 'CLOSED' THEN
        IF OLD."status" <> 'ASSESSED'
           OR NEW."closedByUserId" IS NULL
           OR NEW."resolutionNotes" IS NULL
           OR btrim(NEW."resolutionNotes") = '' THEN
            RAISE EXCEPTION 'closing rental damage requires assessed status, actor, and resolution evidence'
                USING ERRCODE = '23514';
        END IF;
        NEW."estimatedRepairCostMinor" := OLD."estimatedRepairCostMinor";
        NEW."assessmentNotes" := OLD."assessmentNotes";
        NEW."assessedAt" := OLD."assessedAt";
        NEW."assessedByUserId" := OLD."assessedByUserId";
        NEW."waivedAt" := NULL;
        NEW."waivedByUserId" := NULL;
        NEW."waiverReason" := NULL;
        NEW."closedAt" := authored_at;
    ELSE
        RAISE EXCEPTION 'rental damage case lifecycle transition is invalid'
            USING ERRCODE = '23514';
    END IF;

    NEW."updatedAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_damage_cases_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_damage_cases"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_damage_case();

CREATE FUNCTION sf_guard_rental_unit_available_with_active_damage_case()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'AVAILABLE' AND OLD."status" IS DISTINCT FROM NEW."status" AND EXISTS (
        SELECT 1
          FROM "rental_damage_cases" damage_case
         WHERE damage_case."organizationId" = NEW."organizationId"
           AND damage_case."unitId" = NEW."unitId"
           AND damage_case."status" IN ('OPEN', 'ASSESSED')
    ) THEN
        RAISE EXCEPTION 'rental unit has an unresolved damage case'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_unit_operational_states_active_damage_guard
BEFORE UPDATE OF "status" ON "rental_unit_operational_states"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_available_with_active_damage_case();

CREATE FUNCTION sf_guard_rental_unit_archive_with_active_damage_case()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'ARCHIVED' AND OLD."status" IS DISTINCT FROM NEW."status" AND EXISTS (
        SELECT 1
          FROM "rental_damage_cases" damage_case
         WHERE damage_case."organizationId" = NEW."organizationId"
           AND damage_case."unitId" = NEW."id"
           AND damage_case."status" IN ('OPEN', 'ASSESSED')
    ) THEN
        RAISE EXCEPTION 'rental unit has an unresolved damage case and cannot be archived'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_units_active_damage_archive_guard
BEFORE UPDATE OF "status" ON "rental_units"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_archive_with_active_damage_case();
