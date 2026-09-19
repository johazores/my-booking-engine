-- Non-clear returned-condition evidence remains an operational safety boundary until
-- its damage workflow reaches a terminal disposition. A return inspection closes the
-- pending-inspection gap, but DAMAGE_REPORTED / UNSAFE must not become sellable during
-- the interval before a damage case is opened or while that case remains unresolved.
--
-- Reuse the existing physical-unit lock and trigger binding so supported writes, direct
-- SQL, return inspection, damage-case authoring, and fresh rental authority serialize
-- on the same tenant/unit boundary.

CREATE OR REPLACE FUNCTION sf_assert_rental_unit_operationally_available(
    p_organization_id UUID,
    p_unit_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || p_organization_id::text || ':' || p_unit_id::text,
            0
        )
    );

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

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" return_event
         WHERE return_event."organizationId" = p_organization_id
           AND return_event."unitId" = p_unit_id
           AND return_event."kind" = 'RETURNED'
           AND NOT EXISTS (
               SELECT 1
                 FROM "rental_return_inspections" inspection
                WHERE inspection."organizationId" = return_event."organizationId"
                  AND inspection."returnEventId" = return_event."id"
                  AND inspection."unitId" = return_event."unitId"
           )
    ) THEN
        RAISE EXCEPTION 'rental unit has pending return inspection evidence'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_return_inspections" inspection
         WHERE inspection."organizationId" = p_organization_id
           AND inspection."unitId" = p_unit_id
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
        RAISE EXCEPTION 'rental unit has unresolved non-clear return inspection evidence'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_unit_available_with_pending_return_inspection()
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
          FROM "rental_booking_fulfillment_events" return_event
         WHERE return_event."organizationId" = NEW."organizationId"
           AND return_event."unitId" = NEW."unitId"
           AND return_event."kind" = 'RETURNED'
           AND NOT EXISTS (
               SELECT 1
                 FROM "rental_return_inspections" inspection
                WHERE inspection."organizationId" = return_event."organizationId"
                  AND inspection."returnEventId" = return_event."id"
                  AND inspection."unitId" = return_event."unitId"
           )
    ) THEN
        RAISE EXCEPTION 'rental unit cannot return to service before return inspection is recorded'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_return_inspections" inspection
         WHERE inspection."organizationId" = NEW."organizationId"
           AND inspection."unitId" = NEW."unitId"
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
        RAISE EXCEPTION 'rental unit cannot return to service while non-clear return inspection evidence is unresolved'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;
