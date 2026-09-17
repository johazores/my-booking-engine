DROP TRIGGER IF EXISTS rental_booking_reschedules_pre_fulfillment_guard
ON "rental_booking_reschedules";

CREATE FUNCTION sf_guard_rental_booking_reschedule_custody_boundary()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    pickup_event RECORD;
    current_reschedule RECORD;
    current_starts_on DATE;
    current_ends_on DATE;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        )
    );

    SELECT booking.*
      INTO parent_booking
      FROM "rental_bookings" booking
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId";

    IF NOT FOUND
       OR parent_booking."status" <> 'CONFIRMED'
       OR parent_booking."cancelledAt" IS NOT NULL THEN
        RAISE EXCEPTION 'rental date change requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" event
         WHERE event."organizationId" = NEW."organizationId"
           AND event."bookingId" = NEW."bookingId"
           AND event."kind" = 'RETURNED'
    ) THEN
        RAISE EXCEPTION 'returned rental bookings cannot be rescheduled or extended'
            USING ERRCODE = '23514';
    END IF;

    SELECT event.*
      INTO pickup_event
      FROM "rental_booking_fulfillment_events" event
     WHERE event."organizationId" = NEW."organizationId"
       AND event."bookingId" = NEW."bookingId"
       AND event."kind" = 'PICKED_UP'
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT reschedule."targetStartsOn", reschedule."targetEndsOn"
      INTO current_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    current_starts_on := COALESCE(current_reschedule."targetStartsOn", parent_booking."startsOn");
    current_ends_on := COALESCE(current_reschedule."targetEndsOn", parent_booking."endsOn");

    IF NEW."sourceStartsOn" <> current_starts_on
       OR NEW."sourceEndsOn" <> current_ends_on
       OR NEW."targetStartsOn" <> current_starts_on
       OR NEW."targetEndsOn" <= current_ends_on THEN
        RAISE EXCEPTION 'picked-up rental bookings may only extend the current committed end date'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."appliedAt" < pickup_event."occurredAt" THEN
        RAISE EXCEPTION 'rental custody extension cannot predate pickup evidence'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_reschedules_pre_fulfillment_guard
BEFORE INSERT ON "rental_booking_reschedules"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_reschedule_custody_boundary();
