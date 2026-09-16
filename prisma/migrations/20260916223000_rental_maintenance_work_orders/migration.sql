CREATE TYPE "RentalMaintenanceWorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "rental_maintenance_work_orders" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "status" "RentalMaintenanceWorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedByUserId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(6),
    "startedByUserId" UUID,
    "completedAt" TIMESTAMPTZ(6),
    "completedByUserId" UUID,
    "completionNotes" VARCHAR(2000),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledByUserId" UUID,
    "cancellationReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_maintenance_work_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_maintenance_work_orders_idempotency_key_check" CHECK (
        "idempotencyKey" ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$'
    ),
    CONSTRAINT "rental_maintenance_work_orders_title_check" CHECK (btrim("title") <> ''),
    CONSTRAINT "rental_maintenance_work_orders_description_check" CHECK (
        "description" IS NULL OR btrim("description") <> ''
    ),
    CONSTRAINT "rental_maintenance_work_orders_started_evidence_check" CHECK (
        ("startedAt" IS NULL) = ("startedByUserId" IS NULL)
    ),
    CONSTRAINT "rental_maintenance_work_orders_completed_evidence_check" CHECK (
        ("completedAt" IS NULL) = ("completedByUserId" IS NULL)
        AND ("completionNotes" IS NULL OR btrim("completionNotes") <> '')
    ),
    CONSTRAINT "rental_maintenance_work_orders_cancelled_evidence_check" CHECK (
        ("cancelledAt" IS NULL) = ("cancelledByUserId" IS NULL)
        AND ("cancellationReason" IS NULL OR btrim("cancellationReason") <> '')
    ),
    CONSTRAINT "rental_maintenance_work_orders_lifecycle_check" CHECK (
        ("status" = 'OPEN'
            AND "startedAt" IS NULL
            AND "completedAt" IS NULL
            AND "cancelledAt" IS NULL
            AND "completionNotes" IS NULL
            AND "cancellationReason" IS NULL)
        OR
        ("status" = 'IN_PROGRESS'
            AND "startedAt" IS NOT NULL
            AND "completedAt" IS NULL
            AND "cancelledAt" IS NULL
            AND "completionNotes" IS NULL
            AND "cancellationReason" IS NULL)
        OR
        ("status" = 'COMPLETED'
            AND "completedAt" IS NOT NULL
            AND "cancelledAt" IS NULL
            AND "cancellationReason" IS NULL)
        OR
        ("status" = 'CANCELLED'
            AND "cancelledAt" IS NOT NULL
            AND "cancellationReason" IS NOT NULL
            AND "completedAt" IS NULL
            AND "completionNotes" IS NULL)
    )
);

CREATE UNIQUE INDEX "rental_maintenance_work_orders_id_organization_key"
ON "rental_maintenance_work_orders"("id", "organizationId");

CREATE UNIQUE INDEX "rental_maintenance_work_orders_org_idempotency_key"
ON "rental_maintenance_work_orders"("organizationId", "idempotencyKey");

CREATE INDEX "rental_maintenance_work_orders_unit_status_opened_idx"
ON "rental_maintenance_work_orders"("organizationId", "unitId", "status", "openedAt");

CREATE INDEX "rental_maintenance_work_orders_org_status_opened_idx"
ON "rental_maintenance_work_orders"("organizationId", "status", "openedAt");

ALTER TABLE "rental_maintenance_work_orders"
ADD CONSTRAINT "rental_maintenance_work_orders_unit_fkey"
FOREIGN KEY ("unitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_maintenance_work_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'rental maintenance work orders cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'OPEN'
           OR NEW."startedAt" IS NOT NULL
           OR NEW."startedByUserId" IS NOT NULL
           OR NEW."completedAt" IS NOT NULL
           OR NEW."completedByUserId" IS NOT NULL
           OR NEW."completionNotes" IS NOT NULL
           OR NEW."cancelledAt" IS NOT NULL
           OR NEW."cancelledByUserId" IS NOT NULL
           OR NEW."cancellationReason" IS NOT NULL THEN
            RAISE EXCEPTION 'rental maintenance work orders must start open without lifecycle evidence'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM "rental_units" unit
             WHERE unit."organizationId" = NEW."organizationId"
               AND unit."id" = NEW."unitId"
               AND unit."status" = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'rental maintenance work order requires an active tenant unit'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
              FROM "rental_unit_operational_states" operational_state
             WHERE operational_state."organizationId" = NEW."organizationId"
               AND operational_state."unitId" = NEW."unitId"
               AND operational_state."status" = 'OUT_OF_SERVICE'
        ) THEN
            RAISE EXCEPTION 'rental maintenance work order requires the unit to be out of service'
                USING ERRCODE = '23514';
        END IF;

        NEW."openedAt" := authored_at;
        NEW."createdAt" := authored_at;
        NEW."updatedAt" := authored_at;
        RETURN NEW;
    END IF;

    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
       OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."title" IS DISTINCT FROM OLD."title"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."openedAt" IS DISTINCT FROM OLD."openedAt"
       OR NEW."openedByUserId" IS DISTINCT FROM OLD."openedByUserId"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'rental maintenance source evidence is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."status" IN ('COMPLETED', 'CANCELLED') THEN
        RAISE EXCEPTION 'terminal rental maintenance work orders are immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = OLD."status" THEN
        RAISE EXCEPTION 'rental maintenance updates require a lifecycle transition'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."status" = 'IN_PROGRESS' AND NEW."status" = 'OPEN' THEN
        RAISE EXCEPTION 'rental maintenance work orders cannot return to open'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."status" = 'IN_PROGRESS' THEN
        IF OLD."status" <> 'OPEN' OR NEW."startedByUserId" IS NULL THEN
            RAISE EXCEPTION 'starting rental maintenance requires an open work order and actor evidence'
                USING ERRCODE = '23514';
        END IF;
        NEW."startedAt" := authored_at;
        NEW."completedAt" := NULL;
        NEW."completedByUserId" := NULL;
        NEW."completionNotes" := NULL;
        NEW."cancelledAt" := NULL;
        NEW."cancelledByUserId" := NULL;
        NEW."cancellationReason" := NULL;
    ELSIF NEW."status" = 'COMPLETED' THEN
        IF NEW."completedByUserId" IS NULL THEN
            RAISE EXCEPTION 'completing rental maintenance requires actor evidence'
                USING ERRCODE = '23514';
        END IF;
        NEW."startedAt" := OLD."startedAt";
        NEW."startedByUserId" := OLD."startedByUserId";
        NEW."completedAt" := authored_at;
        NEW."cancelledAt" := NULL;
        NEW."cancelledByUserId" := NULL;
        NEW."cancellationReason" := NULL;
    ELSIF NEW."status" = 'CANCELLED' THEN
        IF NEW."cancelledByUserId" IS NULL
           OR NEW."cancellationReason" IS NULL
           OR btrim(NEW."cancellationReason") = '' THEN
            RAISE EXCEPTION 'cancelling rental maintenance requires actor and reason evidence'
                USING ERRCODE = '23514';
        END IF;
        NEW."startedAt" := OLD."startedAt";
        NEW."startedByUserId" := OLD."startedByUserId";
        NEW."completedAt" := NULL;
        NEW."completedByUserId" := NULL;
        NEW."completionNotes" := NULL;
        NEW."cancelledAt" := authored_at;
    ELSE
        RAISE EXCEPTION 'rental maintenance lifecycle transition is invalid'
            USING ERRCODE = '23514';
    END IF;

    NEW."updatedAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_maintenance_work_orders_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_maintenance_work_orders"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_maintenance_work_order();

CREATE FUNCTION sf_guard_rental_unit_available_with_active_maintenance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'AVAILABLE' AND OLD."status" IS DISTINCT FROM NEW."status" AND EXISTS (
        SELECT 1
          FROM "rental_maintenance_work_orders" work_order
         WHERE work_order."organizationId" = NEW."organizationId"
           AND work_order."unitId" = NEW."unitId"
           AND work_order."status" IN ('OPEN', 'IN_PROGRESS')
    ) THEN
        RAISE EXCEPTION 'rental unit has active maintenance work'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_unit_operational_states_active_maintenance_guard
BEFORE UPDATE OF "status" ON "rental_unit_operational_states"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_available_with_active_maintenance();

CREATE FUNCTION sf_guard_rental_unit_archive_with_active_maintenance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'ARCHIVED' AND OLD."status" IS DISTINCT FROM NEW."status" AND EXISTS (
        SELECT 1
          FROM "rental_maintenance_work_orders" work_order
         WHERE work_order."organizationId" = NEW."organizationId"
           AND work_order."unitId" = NEW."id"
           AND work_order."status" IN ('OPEN', 'IN_PROGRESS')
    ) THEN
        RAISE EXCEPTION 'rental unit has active maintenance work and cannot be archived'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_units_active_maintenance_archive_guard
BEFORE UPDATE OF "status" ON "rental_units"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_archive_with_active_maintenance();
