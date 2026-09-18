DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "audit_events"
    WHERE "action" = 'booking.rental.cancelled'
      AND "resourceType" = 'rental-booking'
    GROUP BY "organizationId", "resourceId", "action", "resourceType"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate rental booking cancellation audit evidence prevents uniqueness enforcement';
  END IF;
END
$$;

CREATE UNIQUE INDEX "audit_events_rental_booking_cancellation_once_idx"
ON "audit_events" ("organizationId", "resourceId", "action", "resourceType")
WHERE "action" = 'booking.rental.cancelled'
  AND "resourceType" = 'rental-booking';
