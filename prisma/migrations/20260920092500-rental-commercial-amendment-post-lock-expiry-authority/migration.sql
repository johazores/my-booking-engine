-- Commercial-amendment expiry is time-sensitive fresh authority. Every durable boundary
-- that waits for the shared physical-unit advisory lock must re-read PostgreSQL wall-clock
-- time after that lock has been acquired. Otherwise an amendment can be live when a write
-- starts, wait behind another unit mutation, and cross its expiry before fresh authority is
-- actually retained. Compensation remains outside the fresh-authority expiry gate so real
-- adjustment money can always be unwound.

CREATE OR REPLACE FUNCTION sf_guard_rental_commercial_amendment_prepared_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    booking_status "BookingStatus";
    booking_cancelled_at TIMESTAMPTZ;
    booking_updated_at TIMESTAMPTZ;
    booking_unit_type_id UUID;
    booking_location_id UUID;
    allocation_unit_id UUID;
    allocation_starts_on DATE;
    allocation_ends_on DATE;
BEGIN
    IF NEW."status" <> 'PREPARED' THEN
        RAISE EXCEPTION 'rental commercial amendment must be authored in prepared state'
            USING ERRCODE = '23514';
    END IF;
    IF NEW."expiresAt" <= clock_timestamp() THEN
        RAISE EXCEPTION 'already-expired rental commercial amendment authority cannot be prepared'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
        0
    ));

    SELECT
        booking."status",
        booking."cancelledAt",
        booking."updatedAt",
        booking."unitTypeId",
        booking."locationId",
        allocation."unitId",
        allocation."startsOn",
        allocation."endsOn"
      INTO
        booking_status,
        booking_cancelled_at,
        booking_updated_at,
        booking_unit_type_id,
        booking_location_id,
        allocation_unit_id,
        allocation_starts_on,
        allocation_ends_on
      FROM "rental_bookings" booking
      JOIN "rental_booking_allocations" allocation
        ON allocation."bookingId" = booking."id"
       AND allocation."organizationId" = booking."organizationId"
     WHERE booking."id" = NEW."bookingId"
       AND booking."organizationId" = NEW."organizationId"
     FOR UPDATE OF booking, allocation;

    IF booking_status IS NULL
       OR booking_status <> 'CONFIRMED'
       OR booking_cancelled_at IS NOT NULL
    THEN
        RAISE EXCEPTION 'rental commercial amendment preparation requires a confirmed tenant booking with retained allocation'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."bookingVersion" IS DISTINCT FROM booking_updated_at
       OR NEW."unitId" IS DISTINCT FROM allocation_unit_id
       OR NEW."unitTypeId" IS DISTINCT FROM booking_unit_type_id
       OR NEW."locationId" IS DISTINCT FROM booking_location_id
       OR NEW."sourceStartsOn" IS DISTINCT FROM allocation_starts_on
       OR NEW."sourceEndsOn" IS DISTINCT FROM allocation_ends_on
    THEN
        RAISE EXCEPTION 'rental commercial amendment preparation does not match current tenant booking authority'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM "rental_units" unit
          JOIN "rental_unit_types" unit_type
            ON unit_type."id" = unit."unitTypeId"
           AND unit_type."organizationId" = unit."organizationId"
          JOIN "rental_locations" location
            ON location."id" = unit."locationId"
           AND location."organizationId" = unit."organizationId"
         WHERE unit."id" = NEW."unitId"
           AND unit."organizationId" = NEW."organizationId"
           AND unit."status" = 'ACTIVE'
           AND unit_type."id" = NEW."unitTypeId"
           AND unit_type."status" = 'ACTIVE'
           AND location."id" = NEW."locationId"
           AND location."status" = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'rental commercial amendment preparation requires the active tenant-owned physical assignment'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_fulfillment_events" event
         WHERE event."organizationId" = NEW."organizationId"
           AND event."bookingId" = NEW."bookingId"
           AND event."kind" = 'RETURNED'
    ) THEN
        RAISE EXCEPTION 'returned rental cannot receive new commercial amendment authority'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."mode" = 'PRE_PICKUP_RESCHEDULE' THEN
        IF EXISTS (
            SELECT 1
              FROM "rental_booking_fulfillment_events" event
             WHERE event."organizationId" = NEW."organizationId"
               AND event."bookingId" = NEW."bookingId"
               AND event."kind" = 'PICKED_UP'
        ) THEN
            RAISE EXCEPTION 'pre-pickup commercial amendment cannot be authored after custody begins'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1
              FROM "rental_booking_fulfillment_events" event
             WHERE event."id" = NEW."pickupEventId"
               AND event."organizationId" = NEW."organizationId"
               AND event."bookingId" = NEW."bookingId"
               AND event."unitId" = NEW."unitId"
               AND event."kind" = 'PICKED_UP'
        ) THEN
            RAISE EXCEPTION 'custody-extension commercial amendment requires matching retained pickup authority'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- This call acquires the shared physical-unit advisory lock before evaluating live
    -- operational readiness. Expiry must be checked again only after that wait is over.
    PERFORM sf_assert_rental_unit_operationally_available(
        NEW."organizationId",
        NEW."unitId"
    );

    IF NEW."expiresAt" <= clock_timestamp() THEN
        RAISE EXCEPTION 'rental commercial amendment authority expired while waiting for physical-unit authority'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_commercial_amendment_adjustment_readiness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    amendment_unit_id UUID;
    amendment_expires_at TIMESTAMPTZ;
BEGIN
    IF NEW."purpose" <> 'ADJUSTMENT' THEN
        RETURN NEW;
    END IF;

    SELECT amendment."unitId", amendment."expiresAt"
      INTO amendment_unit_id, amendment_expires_at
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."id" = NEW."amendmentId"
       AND amendment."bookingId" = NEW."bookingId"
       AND amendment."organizationId" = NEW."organizationId"
       AND amendment."status" = 'PREPARED';

    IF amendment_unit_id IS NULL OR amendment_expires_at IS NULL THEN
        RAISE EXCEPTION 'rental commercial amendment adjustment requires tenant-owned prepared authority'
            USING ERRCODE = '23514';
    END IF;

    PERFORM sf_assert_rental_unit_operationally_available(
        NEW."organizationId",
        amendment_unit_id
    );

    IF clock_timestamp() >= amendment_expires_at THEN
        RAISE EXCEPTION 'rental commercial amendment authority expired while adjustment waited for physical-unit authority'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_commercial_amendment_apply_readiness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."status" = 'PREPARED' AND NEW."status" = 'APPLIED' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(
            'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
            0
        ));

        -- Fast rejection before waiting for the unit lock remains useful, but is not the
        -- final time authority because the wait itself can cross expiresAt.
        IF clock_timestamp() >= OLD."expiresAt" THEN
            RAISE EXCEPTION 'expired rental commercial amendment authority cannot be applied'
                USING ERRCODE = '23514';
        END IF;

        PERFORM sf_assert_rental_unit_operationally_available(
            NEW."organizationId",
            NEW."unitId"
        );

        IF clock_timestamp() >= OLD."expiresAt" THEN
            RAISE EXCEPTION 'rental commercial amendment authority expired while apply waited for physical-unit authority'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
