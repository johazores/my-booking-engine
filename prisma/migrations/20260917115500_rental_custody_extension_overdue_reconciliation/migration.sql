CREATE OR REPLACE FUNCTION sf_rental_unit_has_overdue_custody(
    organization_id UUID,
    unit_id UUID,
    observed_at TIMESTAMPTZ,
    excluded_booking_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" pickup
          JOIN "rental_bookings" booking
            ON booking."id" = pickup."bookingId"
           AND booking."organizationId" = pickup."organizationId"
          JOIN "rental_locations" location
            ON location."id" = booking."locationId"
           AND location."organizationId" = booking."organizationId"
         WHERE pickup."organizationId" = organization_id
           AND pickup."unitId" = unit_id
           AND pickup."kind" = 'PICKED_UP'
           AND booking."status" = 'CONFIRMED'
           AND (excluded_booking_id IS NULL OR booking."id" <> excluded_booking_id)
           AND NOT EXISTS (
                SELECT 1
                  FROM "rental_booking_fulfillment_events" returned
                 WHERE returned."organizationId" = pickup."organizationId"
                   AND returned."bookingId" = pickup."bookingId"
                   AND returned."kind" = 'RETURNED'
           )
           AND (observed_at AT TIME ZONE location."timeZone")::date >= COALESCE(
                (
                    SELECT reschedule."targetEndsOn"
                      FROM "rental_booking_reschedules" reschedule
                     WHERE reschedule."organizationId" = pickup."organizationId"
                       AND reschedule."bookingId" = pickup."bookingId"
                     ORDER BY reschedule."appliedAt" DESC,
                              reschedule."createdAt" DESC,
                              reschedule."id" DESC
                     LIMIT 1
                ),
                pickup."endsOn"
           )
    );
$$;
