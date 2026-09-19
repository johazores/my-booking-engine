-- Keep returned-condition evidence recordable before a physical rental unit leaves
-- active inventory. Return inspections require the retained unit to remain ACTIVE,
-- so archival must not win the shared unit lock while a returned custody event still
-- has no inspection evidence.

CREATE FUNCTION sf_guard_rental_unit_archive_with_pending_return_inspection()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."status" = 'ARCHIVED'
       AND OLD."status" IS DISTINCT FROM NEW."status"
       AND EXISTS (
           SELECT 1
             FROM "rental_booking_fulfillment_events" return_event
            WHERE return_event."organizationId" = NEW."organizationId"
              AND return_event."unitId" = NEW."id"
              AND return_event."kind" = 'RETURNED'
              AND NOT EXISTS (
                  SELECT 1
                    FROM "rental_return_inspections" inspection
                   WHERE inspection."organizationId" = return_event."organizationId"
                     AND inspection."returnEventId" = return_event."id"
                     AND inspection."unitId" = return_event."unitId"
              )
       ) THEN
        RAISE EXCEPTION 'rental unit has returned custody awaiting return inspection and cannot be archived'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_units_pending_return_inspection_archive_guard
BEFORE UPDATE OF "status" ON "rental_units"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_archive_with_pending_return_inspection();
