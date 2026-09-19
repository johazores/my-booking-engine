-- Serialize fresh late-return policy authority with rental unit-type archival.
--
-- The original policy trigger owns append-only versioning, currency, fee bounds,
-- and database-authored timestamps. This earlier INSERT guard only adds the shared
-- parent lifecycle boundary introduced after the policy table existed, so direct
-- SQL cannot author a fresh revision against a concurrently archived unit type.

CREATE FUNCTION sf_guard_rental_late_return_policy_parent_lifecycle()
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
     WHERE unit_type."organizationId" = NEW."organizationId"
       AND unit_type."id" = NEW."unitTypeId";

    IF NOT FOUND OR parent_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'rental late-return policy requires an active tenant unit type'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

-- PostgreSQL runs triggers for the same timing/event alphabetically. The `a_`
-- prefix makes the shared parent lifecycle lock precede the existing policy
-- authority trigger, whose dedicated policy lock still serializes versions.
CREATE TRIGGER a_rental_late_return_policy_parent_lifecycle_guard
BEFORE INSERT ON "rental_late_return_policy_revisions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_late_return_policy_parent_lifecycle();
