-- Serialize direct physical-unit identity mutations with the operational evidence
-- that independently prevents unsafe rental-unit archival.
--
-- Application writers already use the shared tenant/unit advisory lock. These
-- triggers extend the same lock namespace to direct SQL so archive/mutation and
-- fresh maintenance/damage evidence cannot pass each other's guards concurrently.

CREATE FUNCTION sf_lock_rental_unit_before_identity_mutation()
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

    RETURN NEW;
END;
$$;

-- PostgreSQL runs triggers of the same timing/event in name order. The `a_`
-- prefix deliberately makes this lock execute before the existing rental-unit
-- hold/booking/custody, maintenance, and damage archive guards.
CREATE TRIGGER a_rental_units_identity_mutation_lock_guard
BEFORE UPDATE OF "locationId", "unitTypeId", "status" ON "rental_units"
FOR EACH ROW
EXECUTE FUNCTION sf_lock_rental_unit_before_identity_mutation();

CREATE FUNCTION sf_lock_rental_unit_before_operational_evidence_insert()
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

    RETURN NEW;
END;
$$;

-- These `a_` triggers execute before each table's existing authoring guard. A
-- direct INSERT that waited behind a concurrent archive therefore re-checks the
-- active-unit requirement only after the archive transaction releases the unit
-- lock, and cannot retain fresh active operational evidence for an archived unit.
CREATE TRIGGER a_rental_maintenance_work_orders_unit_lock_guard
BEFORE INSERT ON "rental_maintenance_work_orders"
FOR EACH ROW
EXECUTE FUNCTION sf_lock_rental_unit_before_operational_evidence_insert();

CREATE TRIGGER a_rental_damage_cases_unit_lock_guard
BEFORE INSERT ON "rental_damage_cases"
FOR EACH ROW
EXECUTE FUNCTION sf_lock_rental_unit_before_operational_evidence_insert();
