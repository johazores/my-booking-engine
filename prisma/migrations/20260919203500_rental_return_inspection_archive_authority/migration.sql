-- Keep non-clear returned-condition evidence actionable before a physical unit can
-- leave the active rental inventory lifecycle.
--
-- A DAMAGE_REPORTED or UNSAFE inspection is not itself a resolved damage workflow.
-- Archival is allowed only after the inspection's damage case reaches WAIVED or CLOSED.

CREATE TRIGGER a_rental_return_inspections_unit_lock_guard
BEFORE INSERT ON "rental_return_inspections"
FOR EACH ROW
EXECUTE FUNCTION sf_lock_rental_unit_before_operational_evidence_insert();

CREATE FUNCTION sf_guard_rental_unit_archive_with_unresolved_return_inspection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'ARCHIVED'
       AND OLD."status" IS DISTINCT FROM NEW."status"
       AND EXISTS (
           SELECT 1
             FROM "rental_return_inspections" inspection
            WHERE inspection."organizationId" = NEW."organizationId"
              AND inspection."unitId" = NEW."id"
              AND inspection."outcome" IN ('DAMAGE_REPORTED', 'UNSAFE')
              AND NOT EXISTS (
                  SELECT 1
                    FROM "rental_damage_cases" damage_case
                   WHERE damage_case."organizationId" = inspection."organizationId"
                     AND damage_case."inspectionId" = inspection."id"
                     AND damage_case."unitId" = inspection."unitId"
                     AND damage_case."status" IN ('WAIVED', 'CLOSED')
              )
       ) THEN
        RAISE EXCEPTION 'rental unit has unresolved non-clear return inspection evidence and cannot be archived'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_units_unresolved_return_inspection_archive_guard
BEFORE UPDATE OF "status" ON "rental_units"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_archive_with_unresolved_return_inspection();
