DROP TRIGGER IF EXISTS rental_booking_unit_substitutions_commercial_amendment_guard
ON "rental_booking_unit_substitutions";

DROP FUNCTION IF EXISTS sf_guard_rental_unit_substitution_during_commercial_amendment();

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_unit_substitution_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    current_allocation RECORD;
    latest_reschedule RECORD;
    commercial_amendment RECORD;
    source_unit RECORD;
    target_unit RECORD;
    expected_source_unit_id UUID;
    expected_starts_on DATE;
    expected_ends_on DATE;
    expected_pricing_fingerprint CHAR(64);
    effective_currency CHAR(3);
    effective_total_minor BIGINT;
    active_amendment_count INTEGER;
    has_latest_reschedule BOOLEAN := FALSE;
    locked_unit_id UUID;
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
        RAISE EXCEPTION 'rental unit substitution requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    SELECT COUNT(*)
      INTO active_amendment_count
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."organizationId" = NEW."organizationId"
       AND amendment."bookingId" = NEW."bookingId"
       AND amendment."status" IN ('PREPARED', 'APPLIED');

    IF active_amendment_count > 1 THEN
        RAISE EXCEPTION 'rental unit substitution found conflicting active commercial amendment authority'
            USING ERRCODE = '23514';
    END IF;

    effective_currency := parent_booking."currency";
    effective_total_minor := parent_booking."totalMinor";

    IF active_amendment_count = 1 THEN
        SELECT amendment.*
          INTO commercial_amendment
          FROM "rental_booking_commercial_amendments" amendment
         WHERE amendment."organizationId" = NEW."organizationId"
           AND amendment."bookingId" = NEW."bookingId"
           AND amendment."status" IN ('PREPARED', 'APPLIED')
         ORDER BY amendment."createdAt" DESC, amendment."id" DESC
         LIMIT 1;

        IF commercial_amendment."status" = 'PREPARED' THEN
            RAISE EXCEPTION 'rental unit substitution is blocked while a commercial amendment is prepared'
                USING ERRCODE = '23514';
        END IF;

        IF commercial_amendment."status" <> 'APPLIED'
           OR commercial_amendment."currency" <> parent_booking."currency"
           OR commercial_amendment."beforeTotalMinor" <> parent_booking."totalMinor"
           OR commercial_amendment."afterTotalMinor" <= 0
           OR commercial_amendment."appliedRescheduleId" IS NULL
           OR commercial_amendment."appliedAt" IS NULL THEN
            RAISE EXCEPTION 'applied rental commercial amendment does not reconcile to immutable booking money for unit substitution'
                USING ERRCODE = '23514';
        END IF;

        effective_currency := commercial_amendment."currency";
        effective_total_minor := commercial_amendment."afterTotalMinor";
    END IF;

    expected_source_unit_id := sf_rental_booking_effective_unit_id(
        NEW."organizationId",
        NEW."bookingId"
    );

    IF expected_source_unit_id IS NULL
       OR NEW."sourceUnitId" <> expected_source_unit_id
       OR NEW."targetUnitId" = expected_source_unit_id THEN
        RAISE EXCEPTION 'rental unit substitution source or target unit is stale'
            USING ERRCODE = '23514';
    END IF;

    FOR locked_unit_id IN
        SELECT unit_id
          FROM (
              VALUES (NEW."sourceUnitId"), (NEW."targetUnitId")
          ) AS locked_units(unit_id)
         ORDER BY unit_id::text
    LOOP
        PERFORM pg_advisory_xact_lock(
            hashtextextended(
                'sf:rental-unit:' || NEW."organizationId"::text || ':' || locked_unit_id::text,
                0
            )
        );
    END LOOP;

    SELECT reschedule."id", reschedule."targetStartsOn", reschedule."targetEndsOn",
           reschedule."targetPricingFingerprint", reschedule."currency", reschedule."totalMinor",
           reschedule."appliedAt"
      INTO latest_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;
    has_latest_reschedule := FOUND;

    expected_starts_on := CASE
        WHEN has_latest_reschedule THEN latest_reschedule."targetStartsOn"
        ELSE parent_booking."startsOn"
    END;
    expected_ends_on := CASE
        WHEN has_latest_reschedule THEN latest_reschedule."targetEndsOn"
        ELSE parent_booking."endsOn"
    END;
    expected_pricing_fingerprint := CASE
        WHEN has_latest_reschedule THEN latest_reschedule."targetPricingFingerprint"
        ELSE parent_booking."pricingFingerprint"
    END;

    IF active_amendment_count = 1 THEN
        IF NOT has_latest_reschedule
           OR latest_reschedule."currency" <> effective_currency
           OR latest_reschedule."totalMinor" <> effective_total_minor
           OR latest_reschedule."appliedAt" < commercial_amendment."appliedAt" THEN
            RAISE EXCEPTION 'rental reschedule chain does not reconcile to the applied commercial baseline for unit substitution'
                USING ERRCODE = '23514';
        END IF;
    ELSIF has_latest_reschedule
       AND (
         latest_reschedule."currency" <> parent_booking."currency"
         OR latest_reschedule."totalMinor" <> parent_booking."totalMinor"
       ) THEN
        RAISE EXCEPTION 'rental reschedule chain does not reconcile to immutable booking money for unit substitution'
            USING ERRCODE = '23514';
    END IF;

    SELECT allocation.*
      INTO current_allocation
      FROM "rental_booking_allocations" allocation
     WHERE allocation."organizationId" = NEW."organizationId"
       AND allocation."bookingId" = NEW."bookingId"
       AND allocation."unitId" = expected_source_unit_id;

    IF NOT FOUND
       OR current_allocation."startsOn" <> expected_starts_on
       OR current_allocation."endsOn" <> expected_ends_on THEN
        RAISE EXCEPTION 'rental unit substitution source allocation is stale'
            USING ERRCODE = '23514';
    END IF;

    SELECT unit."id", unit."unitTypeId", unit."locationId", unit."status",
           unit_type."status" AS unit_type_status, location."status" AS location_status
      INTO source_unit
      FROM "rental_units" unit
      JOIN "rental_unit_types" unit_type
        ON unit_type."id" = unit."unitTypeId"
       AND unit_type."organizationId" = unit."organizationId"
      JOIN "rental_locations" location
        ON location."id" = unit."locationId"
       AND location."organizationId" = unit."organizationId"
     WHERE unit."id" = NEW."sourceUnitId"
       AND unit."organizationId" = NEW."organizationId";

    SELECT unit."id", unit."unitTypeId", unit."locationId", unit."status",
           unit_type."status" AS unit_type_status, location."status" AS location_status
      INTO target_unit
      FROM "rental_units" unit
      JOIN "rental_unit_types" unit_type
        ON unit_type."id" = unit."unitTypeId"
       AND unit_type."organizationId" = unit."organizationId"
      JOIN "rental_locations" location
        ON location."id" = unit."locationId"
       AND location."organizationId" = unit."organizationId"
     WHERE unit."id" = NEW."targetUnitId"
       AND unit."organizationId" = NEW."organizationId";

    IF source_unit."id" IS NULL
       OR target_unit."id" IS NULL
       OR source_unit."status" <> 'ACTIVE'
       OR target_unit."status" <> 'ACTIVE'
       OR source_unit.unit_type_status <> 'ACTIVE'
       OR target_unit.unit_type_status <> 'ACTIVE'
       OR source_unit.location_status <> 'ACTIVE'
       OR target_unit.location_status <> 'ACTIVE'
       OR source_unit."unitTypeId" <> parent_booking."unitTypeId"
       OR target_unit."unitTypeId" <> parent_booking."unitTypeId"
       OR source_unit."locationId" <> parent_booking."locationId"
       OR target_unit."locationId" <> parent_booking."locationId" THEN
        RAISE EXCEPTION 'rental unit substitution requires active same-type same-location units'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."startsOn" <> expected_starts_on
       OR NEW."endsOn" <> expected_ends_on
       OR NEW."currency" <> effective_currency
       OR NEW."totalMinor" <> effective_total_minor
       OR NEW."pricingFingerprint" <> expected_pricing_fingerprint
       OR NEW."appliedAt" < parent_booking."confirmedAt"
       OR (
         active_amendment_count = 1
         AND NEW."appliedAt" < commercial_amendment."appliedAt"
       ) THEN
        RAISE EXCEPTION 'rental unit substitution commercial or effective-period evidence is stale'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_availability_blocks" block
         WHERE block."organizationId" = NEW."organizationId"
           AND block."unitId" = NEW."targetUnitId"
           AND block."startsOn" < NEW."endsOn"
           AND block."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution target overlaps an unavailable-date block'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_availability_holds" hold
         WHERE hold."organizationId" = NEW."organizationId"
           AND hold."unitId" = NEW."targetUnitId"
           AND hold."status" = 'ACTIVE'
           AND hold."expiresAt" > clock_timestamp()
           AND hold."startsOn" < NEW."endsOn"
           AND hold."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution target overlaps an active availability hold'
            USING ERRCODE = '23P01';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM "rental_booking_allocations" allocation
          JOIN "rental_bookings" booking
            ON booking."id" = allocation."bookingId"
           AND booking."organizationId" = allocation."organizationId"
         WHERE allocation."organizationId" = NEW."organizationId"
           AND allocation."unitId" = NEW."targetUnitId"
           AND allocation."bookingId" <> NEW."bookingId"
           AND booking."status" <> 'CANCELLED'
           AND allocation."startsOn" < NEW."endsOn"
           AND allocation."endsOn" > NEW."startsOn"
    ) THEN
        RAISE EXCEPTION 'rental unit substitution target overlaps another active booking'
            USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
END;
$$;
