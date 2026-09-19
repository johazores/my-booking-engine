-- Serialize rental parent lifecycle changes with fresh child authority.
--
-- Composite foreign keys protect tenant ownership, but they cannot express that a
-- newly active physical unit or pricing period may only depend on ACTIVE parent
-- inventory. Shared advisory locks close the archive-vs-child-write race for both
-- supported application writes and direct SQL.

CREATE FUNCTION sf_lock_rental_location_lifecycle(p_organization_id UUID, p_location_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-location-lifecycle:' || p_organization_id::text || ':' || p_location_id::text,
            0
        )
    );
END;
$$;

CREATE FUNCTION sf_lock_rental_unit_type_lifecycle(p_organization_id UUID, p_unit_type_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit-type-lifecycle:' || p_organization_id::text || ':' || p_unit_type_id::text,
            0
        )
    );
END;
$$;

CREATE FUNCTION sf_guard_rental_unit_parent_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status "InventoryLifecycleStatus";
BEGIN
    -- Unit-type lock always precedes location lock when both are required.
    PERFORM sf_lock_rental_unit_type_lifecycle(NEW."organizationId", NEW."unitTypeId");

    SELECT unit_type."status"
      INTO parent_status
      FROM "rental_unit_types" unit_type
     WHERE unit_type."id" = NEW."unitTypeId"
       AND unit_type."organizationId" = NEW."organizationId";

    IF NOT FOUND OR parent_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'active rental unit requires an active tenant unit type'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."locationId" IS NULL THEN
        RAISE EXCEPTION 'active rental unit requires an active tenant location'
            USING ERRCODE = '23514';
    END IF;

    PERFORM sf_lock_rental_location_lifecycle(NEW."organizationId", NEW."locationId");

    SELECT location."status"
      INTO parent_status
      FROM "rental_locations" location
     WHERE location."id" = NEW."locationId"
       AND location."organizationId" = NEW."organizationId";

    IF NOT FOUND OR parent_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'active rental unit requires an active tenant location'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- The existing alphabetically-early `a_` unit trigger first takes the physical-unit
-- lock for UPDATE mutations. This `b_` guard then takes parent locks in deterministic
-- type -> location order before lifecycle validation.
CREATE TRIGGER b_rental_units_parent_lifecycle_guard
BEFORE INSERT OR UPDATE OF "unitTypeId", "locationId", "status" ON "rental_units"
FOR EACH ROW
WHEN (NEW."status" = 'ACTIVE')
EXECUTE FUNCTION sf_guard_rental_unit_parent_lifecycle();

CREATE FUNCTION sf_guard_rental_rate_period_parent_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status "InventoryLifecycleStatus";
BEGIN
    PERFORM sf_lock_rental_unit_type_lifecycle(NEW."organizationId", NEW."unitTypeId");

    SELECT unit_type."status"
      INTO parent_status
      FROM "rental_unit_types" unit_type
     WHERE unit_type."id" = NEW."unitTypeId"
       AND unit_type."organizationId" = NEW."organizationId";

    IF NOT FOUND OR parent_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'rental rate period requires an active tenant unit type'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_rate_periods_parent_lifecycle_guard
BEFORE INSERT OR UPDATE OF "unitTypeId" ON "rental_rate_periods"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_rate_period_parent_lifecycle();

CREATE FUNCTION sf_guard_rental_location_archive_dependencies()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'ARCHIVED' AND OLD."status" IS DISTINCT FROM NEW."status" THEN
        PERFORM sf_lock_rental_location_lifecycle(NEW."organizationId", NEW."id");

        IF EXISTS (
            SELECT 1
              FROM "rental_units" unit
             WHERE unit."organizationId" = NEW."organizationId"
               AND unit."locationId" = NEW."id"
               AND unit."status" = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'rental location with active units cannot be archived'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_locations_active_unit_archive_guard
BEFORE UPDATE OF "status" ON "rental_locations"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_location_archive_dependencies();

CREATE FUNCTION sf_guard_rental_unit_type_archive_dependencies()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'ARCHIVED' AND OLD."status" IS DISTINCT FROM NEW."status" THEN
        PERFORM sf_lock_rental_unit_type_lifecycle(NEW."organizationId", NEW."id");

        IF EXISTS (
            SELECT 1
              FROM "rental_units" unit
             WHERE unit."organizationId" = NEW."organizationId"
               AND unit."unitTypeId" = NEW."id"
               AND unit."status" = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'rental unit type with active units cannot be archived'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_unit_types_active_unit_archive_guard
BEFORE UPDATE OF "status" ON "rental_unit_types"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_type_archive_dependencies();
