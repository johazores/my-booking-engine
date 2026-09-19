DO $$
BEGIN
    IF EXISTS (
      SELECT 1
        FROM "rental_booking_unit_substitutions" substitution
        JOIN "rental_booking_commercial_amendments" amendment
          ON amendment."organizationId" = substitution."organizationId"
         AND amendment."bookingId" = substitution."bookingId"
       WHERE amendment."status" = 'APPLIED'
         AND amendment."appliedAt" IS NOT NULL
         AND substitution."appliedAt" > amendment."appliedAt"
    ) THEN
      RAISE EXCEPTION 'cannot install post-commercial mutation guards while a rental has post-amendment unit-substitution evidence';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_reschedule_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_booking RECORD;
    current_allocation RECORD;
    previous_reschedule RECORD;
    commercial_amendment RECORD;
    expected_unit_id UUID;
    expected_source_pricing_fingerprint CHAR(64);
    source_currency CHAR(3);
    source_total_minor BIGINT;
    effective_currency CHAR(3);
    effective_total_minor BIGINT;
    applying_prepared_commercial BOOLEAN := FALSE;
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
        RAISE EXCEPTION 'rental reschedule requires a confirmed tenant booking'
            USING ERRCODE = '23514';
    END IF;

    SELECT amendment.*
      INTO commercial_amendment
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."organizationId" = NEW."organizationId"
       AND amendment."bookingId" = NEW."bookingId"
       AND amendment."status" IN ('PREPARED', 'APPLIED')
     ORDER BY amendment."createdAt" DESC, amendment."id" DESC
     LIMIT 1;

    source_currency := parent_booking."currency";
    source_total_minor := parent_booking."totalMinor";
    effective_currency := parent_booking."currency";
    effective_total_minor := parent_booking."totalMinor";

    IF FOUND AND commercial_amendment."status" = 'PREPARED' THEN
        IF commercial_amendment."expiresAt" <= clock_timestamp()
           OR NEW."sourceStartsOn" <> commercial_amendment."sourceStartsOn"
           OR NEW."sourceEndsOn" <> commercial_amendment."sourceEndsOn"
           OR NEW."targetStartsOn" <> commercial_amendment."targetStartsOn"
           OR NEW."targetEndsOn" <> commercial_amendment."targetEndsOn"
           OR NEW."currency" <> commercial_amendment."currency"
           OR NEW."totalMinor" <> commercial_amendment."afterTotalMinor"
           OR NEW."sourcePricingFingerprint" <> commercial_amendment."sourcePricingFingerprint"
           OR NEW."targetPricingFingerprint" <> commercial_amendment."targetPricingFingerprint"
           OR NEW."authorityFingerprint" <> commercial_amendment."reviewFingerprint" THEN
            RAISE EXCEPTION 'rental reschedule cannot bypass prepared commercial amendment authority'
                USING ERRCODE = '23514';
        END IF;
        applying_prepared_commercial := TRUE;
        effective_currency := commercial_amendment."currency";
        effective_total_minor := commercial_amendment."afterTotalMinor";
    ELSIF FOUND AND commercial_amendment."status" = 'APPLIED' THEN
        IF commercial_amendment."currency" <> parent_booking."currency"
           OR commercial_amendment."beforeTotalMinor" <> parent_booking."totalMinor"
           OR commercial_amendment."afterTotalMinor" <= 0
           OR commercial_amendment."appliedRescheduleId" IS NULL
           OR commercial_amendment."appliedAt" IS NULL THEN
            RAISE EXCEPTION 'applied rental commercial amendment does not reconcile to immutable booking money'
                USING ERRCODE = '23514';
        END IF;
        source_currency := commercial_amendment."currency";
        source_total_minor := commercial_amendment."afterTotalMinor";
        effective_currency := commercial_amendment."currency";
        effective_total_minor := commercial_amendment."afterTotalMinor";
    END IF;

    expected_unit_id := sf_rental_booking_effective_unit_id(NEW."organizationId", NEW."bookingId");
    IF expected_unit_id IS NULL THEN
        RAISE EXCEPTION 'rental reschedule effective unit is unavailable'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'sf:rental-unit:' || NEW."organizationId"::text || ':' || expected_unit_id::text,
            0
        )
    );

    SELECT allocation.*
      INTO current_allocation
      FROM "rental_booking_allocations" allocation
     WHERE allocation."organizationId" = NEW."organizationId"
       AND allocation."bookingId" = NEW."bookingId"
       AND allocation."unitId" = expected_unit_id;

    IF NOT FOUND
       OR current_allocation."startsOn" <> NEW."sourceStartsOn"
       OR current_allocation."endsOn" <> NEW."sourceEndsOn" THEN
        RAISE EXCEPTION 'rental reschedule source allocation is stale'
            USING ERRCODE = '23514';
    END IF;

    SELECT reschedule."targetPricingFingerprint", reschedule."currency", reschedule."totalMinor", reschedule."appliedAt"
      INTO previous_reschedule
      FROM "rental_booking_reschedules" reschedule
     WHERE reschedule."organizationId" = NEW."organizationId"
       AND reschedule."bookingId" = NEW."bookingId"
     ORDER BY reschedule."appliedAt" DESC, reschedule."createdAt" DESC, reschedule."id" DESC
     LIMIT 1;

    expected_source_pricing_fingerprint :=
        COALESCE(previous_reschedule."targetPricingFingerprint", parent_booking."pricingFingerprint");

    IF previous_reschedule."targetPricingFingerprint" IS NOT NULL
       AND (
         previous_reschedule."currency" <> source_currency
         OR previous_reschedule."totalMinor" <> source_total_minor
       ) THEN
        RAISE EXCEPTION 'rental reschedule chain does not reconcile to the effective commercial source baseline'
            USING ERRCODE = '23514';
    END IF;

    IF commercial_amendment."status" = 'APPLIED'
       AND previous_reschedule."appliedAt" < commercial_amendment."appliedAt" THEN
        RAISE EXCEPTION 'rental reschedule chain predates the applied commercial amendment baseline'
            USING ERRCODE = '23514';
    END IF;

    IF applying_prepared_commercial
       AND expected_source_pricing_fingerprint <> commercial_amendment."sourcePricingFingerprint" THEN
        RAISE EXCEPTION 'prepared commercial amendment source pricing evidence is stale'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."currency" <> effective_currency
       OR NEW."totalMinor" <> effective_total_minor
       OR NEW."sourcePricingFingerprint" <> expected_source_pricing_fingerprint
       OR NEW."appliedAt" < parent_booking."confirmedAt" THEN
        RAISE EXCEPTION 'rental reschedule commercial evidence is stale or inconsistent'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_reschedule_after_commercial_amendment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    commercial_amendment RECORD;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
      0
    ));

    SELECT amendment.*
      INTO commercial_amendment
      FROM "rental_booking_commercial_amendments" amendment
     WHERE amendment."organizationId" = NEW."organizationId"
       AND amendment."bookingId" = NEW."bookingId"
       AND amendment."status" IN ('PREPARED', 'APPLIED')
     ORDER BY amendment."createdAt" DESC, amendment."id" DESC
     LIMIT 1;

    IF FOUND AND commercial_amendment."status" = 'PREPARED' THEN
      IF commercial_amendment."expiresAt" <= clock_timestamp()
         OR NEW."sourceStartsOn" <> commercial_amendment."sourceStartsOn"
         OR NEW."sourceEndsOn" <> commercial_amendment."sourceEndsOn"
         OR NEW."targetStartsOn" <> commercial_amendment."targetStartsOn"
         OR NEW."targetEndsOn" <> commercial_amendment."targetEndsOn"
         OR NEW."currency" <> commercial_amendment."currency"
         OR NEW."totalMinor" <> commercial_amendment."afterTotalMinor"
         OR NEW."sourcePricingFingerprint" <> commercial_amendment."sourcePricingFingerprint"
         OR NEW."targetPricingFingerprint" <> commercial_amendment."targetPricingFingerprint"
         OR NEW."authorityFingerprint" <> commercial_amendment."reviewFingerprint" THEN
        RAISE EXCEPTION 'rental rescheduling is blocked while a commercial amendment is prepared'
          USING ERRCODE = '23514';
      END IF;
    ELSIF FOUND
       AND commercial_amendment."status" = 'APPLIED'
       AND (
         NEW."currency" <> commercial_amendment."currency"
         OR NEW."totalMinor" <> commercial_amendment."afterTotalMinor"
       ) THEN
      RAISE EXCEPTION 'post-amendment rental reschedule must preserve the accepted effective commercial total'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_prepared_commercial_reschedule_terminal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    amendment RECORD;
BEGIN
    SELECT candidate.*
      INTO amendment
      FROM "rental_booking_commercial_amendments" candidate
     WHERE candidate."organizationId" = NEW."organizationId"
       AND candidate."bookingId" = NEW."bookingId"
       AND candidate."reviewFingerprint" = NEW."authorityFingerprint"
       AND candidate."sourceStartsOn" = NEW."sourceStartsOn"
       AND candidate."sourceEndsOn" = NEW."sourceEndsOn"
       AND candidate."targetStartsOn" = NEW."targetStartsOn"
       AND candidate."targetEndsOn" = NEW."targetEndsOn"
       AND candidate."currency" = NEW."currency"
       AND candidate."afterTotalMinor" = NEW."totalMinor"
       AND candidate."sourcePricingFingerprint" = NEW."sourcePricingFingerprint"
       AND candidate."targetPricingFingerprint" = NEW."targetPricingFingerprint"
     ORDER BY candidate."createdAt" DESC, candidate."id" DESC
     LIMIT 1;

    IF FOUND
       AND (
         amendment."status" <> 'APPLIED'
         OR amendment."appliedRescheduleId" <> NEW."id"
         OR amendment."appliedAt" IS NULL
       ) THEN
      RAISE EXCEPTION 'prepared commercial reschedule must terminalize the linked amendment in the same transaction'
        USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rental_booking_reschedules_prepared_commercial_terminal_guard
ON "rental_booking_reschedules";

CREATE CONSTRAINT TRIGGER rental_booking_reschedules_prepared_commercial_terminal_guard
AFTER INSERT ON "rental_booking_reschedules"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_prepared_commercial_reschedule_terminal();

CREATE OR REPLACE FUNCTION sf_guard_rental_unit_substitution_during_commercial_amendment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text,
      0
    ));

    IF EXISTS (
      SELECT 1
        FROM "rental_booking_commercial_amendments" amendment
       WHERE amendment."organizationId" = NEW."organizationId"
         AND amendment."bookingId" = NEW."bookingId"
         AND amendment."status" IN ('PREPARED', 'APPLIED')
    ) THEN
      RAISE EXCEPTION 'rental unit substitution requires a separate effective-commercial-baseline contract while an amendment is prepared or applied'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rental_booking_unit_substitutions_commercial_amendment_guard
ON "rental_booking_unit_substitutions";

CREATE TRIGGER rental_booking_unit_substitutions_commercial_amendment_guard
BEFORE INSERT ON "rental_booking_unit_substitutions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_unit_substitution_during_commercial_amendment();
