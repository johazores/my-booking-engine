-- Keep fresh unit-scoped rental authority attached only to active physical inventory.
--
-- Application services already serialize on the tenant/unit advisory lock and re-read
-- ACTIVE units before authoring availability or operational state. Composite foreign
-- keys alone, however, still allow direct SQL to attach new child authority to a
-- retained ARCHIVED unit. This guard shares the physical-unit lock with archival so
-- the winner is deterministic and the later transaction revalidates lifecycle state.

CREATE FUNCTION sf_assert_active_rental_unit_child_authority(
    p_organization_id UUID,
    p_unit_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    unit_status "InventoryLifecycleStatus";
    unit_type_status "InventoryLifecycleStatus";
    location_status "InventoryLifecycleStatus";
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || p_organization_id::text || ':' || p_unit_id::text,
            0
        )
    );

    SELECT unit."status", unit_type."status", location."status"
      INTO unit_status, unit_type_status, location_status
      FROM "rental_units" unit
      JOIN "rental_unit_types" unit_type
        ON unit_type."id" = unit."unitTypeId"
       AND unit_type."organizationId" = unit."organizationId"
      JOIN "rental_locations" location
        ON location."id" = unit."locationId"
       AND location."organizationId" = unit."organizationId"
     WHERE unit."id" = p_unit_id
       AND unit."organizationId" = p_organization_id;

    IF NOT FOUND
       OR unit_status <> 'ACTIVE'
       OR unit_type_status <> 'ACTIVE'
       OR location_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'fresh rental unit child authority requires active tenant inventory'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE FUNCTION sf_guard_rental_availability_block_unit_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM sf_assert_active_rental_unit_child_authority(
        NEW."organizationId",
        NEW."unitId"
    );
    RETURN NEW;
END;
$$;

-- Alphabetically early so lifecycle serialization happens before the existing
-- hold/booking overlap guard evaluates the new availability restriction.
CREATE TRIGGER a_rental_availability_blocks_unit_lifecycle_guard
BEFORE INSERT OR UPDATE OF "organizationId", "unitId", "startsOn", "endsOn"
ON "rental_availability_blocks"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_availability_block_unit_lifecycle();

CREATE FUNCTION sf_guard_rental_availability_hold_unit_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Terminal/inactive transitions reduce live authority and must remain possible
    -- after an expired hold no longer prevents physical-unit archival.
    IF NEW."status" <> 'ACTIVE' THEN
        RETURN NEW;
    END IF;

    PERFORM sf_assert_active_rental_unit_child_authority(
        NEW."organizationId",
        NEW."unitId"
    );
    RETURN NEW;
END;
$$;

-- This runs before the existing operational-availability and overlap guards. An
-- ACTIVE hold therefore cannot be inserted, re-parented, reactivated, re-dated, or
-- extended against inventory that archival has already retired.
CREATE TRIGGER a_rental_availability_holds_unit_lifecycle_guard
BEFORE INSERT OR UPDATE OF "organizationId", "unitId", "startsOn", "endsOn", "status", "expiresAt"
ON "rental_availability_holds"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_availability_hold_unit_lifecycle();

CREATE FUNCTION sf_guard_rental_unit_operational_state_unit_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM sf_assert_active_rental_unit_child_authority(
        NEW."organizationId",
        NEW."unitId"
    );
    RETURN NEW;
END;
$$;

-- Operational state is current live inventory authority. Existing rows are retained
-- after archival, but fresh inserts or later state mutations are no longer allowed.
CREATE TRIGGER a_rental_unit_operational_states_unit_lifecycle_guard
BEFORE INSERT OR UPDATE ON "rental_unit_operational_states"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_operational_state_unit_lifecycle();
