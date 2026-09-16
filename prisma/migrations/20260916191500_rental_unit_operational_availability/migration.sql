CREATE TYPE "RentalUnitOperationalStatus" AS ENUM ('AVAILABLE', 'OUT_OF_SERVICE');

CREATE TABLE "rental_unit_operational_states" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "status" "RentalUnitOperationalStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reason" VARCHAR(500),
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_unit_operational_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_unit_operational_states_reason_check" CHECK (
        ("status" = 'AVAILABLE' AND "reason" IS NULL)
        OR (
            "status" = 'OUT_OF_SERVICE'
            AND "reason" IS NOT NULL
            AND btrim("reason") <> ''
        )
    )
);

CREATE UNIQUE INDEX "rental_unit_operational_states_id_organizationId_key"
ON "rental_unit_operational_states"("id", "organizationId");

CREATE UNIQUE INDEX "rental_unit_operational_states_organizationId_unitId_key"
ON "rental_unit_operational_states"("organizationId", "unitId");

CREATE INDEX "rental_unit_operational_states_organizationId_status_unitId_idx"
ON "rental_unit_operational_states"("organizationId", "status", "unitId");

ALTER TABLE "rental_unit_operational_states"
ADD CONSTRAINT "rental_unit_operational_states_unitId_organizationId_fkey"
FOREIGN KEY ("unitId", "organizationId")
REFERENCES "rental_units"("id", "organizationId")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION sf_author_rental_unit_operational_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'rental unit operational-state rows cannot be deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND (
        NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
        OR NEW."unitId" IS DISTINCT FROM OLD."unitId"
    ) THEN
        RAISE EXCEPTION 'rental unit operational-state identity is immutable'
            USING ERRCODE = '23514';
    END IF;

    NEW."changedAt" := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        NEW."createdAt" := NEW."changedAt";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_unit_operational_states_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_unit_operational_states"
FOR EACH ROW
EXECUTE FUNCTION sf_author_rental_unit_operational_state();

CREATE FUNCTION sf_assert_rental_unit_operationally_available(
    p_organization_id UUID,
    p_unit_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM "rental_unit_operational_states" operational_state
         WHERE operational_state."organizationId" = p_organization_id
           AND operational_state."unitId" = p_unit_id
           AND operational_state."status" = 'OUT_OF_SERVICE'
    ) THEN
        RAISE EXCEPTION 'rental unit is out of service'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION sf_guard_rental_hold_operational_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'ACTIVE' THEN
        PERFORM sf_assert_rental_unit_operationally_available(
            NEW."organizationId",
            NEW."unitId"
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_availability_holds_operational_availability_guard
BEFORE INSERT OR UPDATE OF "status", "unitId" ON "rental_availability_holds"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_hold_operational_availability();

CREATE FUNCTION sf_guard_rental_booking_operational_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM sf_assert_rental_unit_operationally_available(
        NEW."organizationId",
        NEW."unitId"
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_bookings_operational_availability_guard
BEFORE INSERT ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_operational_availability();

CREATE FUNCTION sf_guard_rental_allocation_operational_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM sf_assert_rental_unit_operationally_available(
        NEW."organizationId",
        NEW."unitId"
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_allocations_operational_availability_guard
BEFORE INSERT OR UPDATE OF "unitId" ON "rental_booking_allocations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_allocation_operational_availability();

CREATE FUNCTION sf_guard_rental_substitution_operational_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM sf_assert_rental_unit_operationally_available(
        NEW."organizationId",
        NEW."targetUnitId"
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_unit_substitutions_operational_availability_guard
BEFORE INSERT ON "rental_booking_unit_substitutions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_substitution_operational_availability();

CREATE FUNCTION sf_guard_rental_reschedule_operational_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    effective_unit_id UUID;
BEGIN
    SELECT allocation."unitId"
      INTO effective_unit_id
      FROM "rental_booking_allocations" allocation
     WHERE allocation."organizationId" = NEW."organizationId"
       AND allocation."bookingId" = NEW."bookingId";

    IF effective_unit_id IS NULL THEN
        RAISE EXCEPTION 'rental reschedule requires an effective allocation'
            USING ERRCODE = '23514';
    END IF;

    PERFORM sf_assert_rental_unit_operationally_available(
        NEW."organizationId",
        effective_unit_id
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_reschedules_operational_availability_guard
BEFORE INSERT ON "rental_booking_reschedules"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_reschedule_operational_availability();

CREATE FUNCTION sf_guard_rental_pickup_operational_availability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."kind" = 'PICKED_UP' THEN
        PERFORM sf_assert_rental_unit_operationally_available(
            NEW."organizationId",
            NEW."unitId"
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_fulfillment_operational_availability_guard
BEFORE INSERT ON "rental_booking_fulfillment_events"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_pickup_operational_availability();
