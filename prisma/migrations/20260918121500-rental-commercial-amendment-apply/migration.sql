ALTER TYPE "RentalBookingCommercialAmendmentStatus" ADD VALUE 'APPLIED';

ALTER TABLE "rental_booking_commercial_amendments"
  ADD COLUMN "appliedRescheduleId" UUID,
  ADD COLUMN "appliedAt" TIMESTAMPTZ(6);

ALTER TABLE "rental_booking_commercial_amendments"
  DROP CONSTRAINT "rental_booking_commercial_amendments_lifecycle_check";

ALTER TABLE "rental_booking_commercial_amendments"
  ADD CONSTRAINT "rental_booking_commercial_amendments_lifecycle_check" CHECK (
    (
      "status" = 'PREPARED'
      AND "endedAt" IS NULL
      AND "appliedRescheduleId" IS NULL
      AND "appliedAt" IS NULL
    )
    OR (
      "status" IN ('CANCELLED', 'EXPIRED')
      AND "endedAt" IS NOT NULL
      AND "appliedRescheduleId" IS NULL
      AND "appliedAt" IS NULL
    )
    OR (
      "status" = 'APPLIED'
      AND "endedAt" IS NOT NULL
      AND "appliedRescheduleId" IS NOT NULL
      AND "appliedAt" IS NOT NULL
      AND "endedAt" = "appliedAt"
      AND "appliedAt" < "expiresAt"
    )
  );

CREATE UNIQUE INDEX "rental_booking_commercial_amendments_org_applied_reschedule_key"
  ON "rental_booking_commercial_amendments"("organizationId", "appliedRescheduleId");

CREATE UNIQUE INDEX "rental_booking_commercial_amendments_org_booking_applied_key"
  ON "rental_booking_commercial_amendments"("organizationId", "bookingId")
  WHERE "status" = 'APPLIED';

ALTER TABLE "rental_booking_commercial_amendments"
  ADD CONSTRAINT "rental_booking_commercial_amendments_applied_reschedule_fkey"
  FOREIGN KEY ("appliedRescheduleId", "organizationId")
  REFERENCES "rental_booking_reschedules"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_commercial_amendment_terms()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR OLD."bookingId" IS DISTINCT FROM NEW."bookingId"
    OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
    OR OLD."direction" IS DISTINCT FROM NEW."direction"
    OR OLD."mode" IS DISTINCT FROM NEW."mode"
    OR OLD."bookingVersion" IS DISTINCT FROM NEW."bookingVersion"
    OR OLD."unitId" IS DISTINCT FROM NEW."unitId"
    OR OLD."unitTypeId" IS DISTINCT FROM NEW."unitTypeId"
    OR OLD."locationId" IS DISTINCT FROM NEW."locationId"
    OR OLD."pickupEventId" IS DISTINCT FROM NEW."pickupEventId"
    OR OLD."sourceStartsOn" IS DISTINCT FROM NEW."sourceStartsOn"
    OR OLD."sourceEndsOn" IS DISTINCT FROM NEW."sourceEndsOn"
    OR OLD."targetStartsOn" IS DISTINCT FROM NEW."targetStartsOn"
    OR OLD."targetEndsOn" IS DISTINCT FROM NEW."targetEndsOn"
    OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR OLD."beforeTotalMinor" IS DISTINCT FROM NEW."beforeTotalMinor"
    OR OLD."afterTotalMinor" IS DISTINCT FROM NEW."afterTotalMinor"
    OR OLD."deltaMinor" IS DISTINCT FROM NEW."deltaMinor"
    OR OLD."sourcePricingFingerprint" IS DISTINCT FROM NEW."sourcePricingFingerprint"
    OR OLD."targetPricingFingerprint" IS DISTINCT FROM NEW."targetPricingFingerprint"
    OR OLD."targetPricingSnapshot" IS DISTINCT FROM NEW."targetPricingSnapshot"
    OR OLD."reviewFingerprint" IS DISTINCT FROM NEW."reviewFingerprint"
    OR OLD."expiresAt" IS DISTINCT FROM NEW."expiresAt"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  THEN
    RAISE EXCEPTION 'rental booking commercial amendment terms are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'PREPARED'
    AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."endedAt" IS DISTINCT FROM OLD."endedAt"
      OR NEW."appliedRescheduleId" IS DISTINCT FROM OLD."appliedRescheduleId"
      OR NEW."appliedAt" IS DISTINCT FROM OLD."appliedAt"
    )
  THEN
    RAISE EXCEPTION 'terminal rental booking commercial amendment lifecycle evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'PREPARED'
    AND NEW."status" NOT IN ('PREPARED', 'CANCELLED', 'EXPIRED', 'APPLIED')
  THEN
    RAISE EXCEPTION 'invalid rental booking commercial amendment lifecycle transition'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_commercial_amendment_terminal_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    adjustment_count INTEGER;
    compensation_count INTEGER;
    applied_reschedule RECORD;
BEGIN
    IF OLD."status" = 'PREPARED' AND NEW."status" IN ('CANCELLED', 'EXPIRED', 'APPLIED') THEN
        SELECT
          count(*) FILTER (WHERE row."purpose" = 'ADJUSTMENT' AND row."status" = 'SUCCEEDED'),
          count(*) FILTER (WHERE row."purpose" = 'COMPENSATION' AND row."status" = 'SUCCEEDED')
          INTO adjustment_count, compensation_count
          FROM "rental_booking_commercial_amendment_settlement_transactions" row
         WHERE row."organizationId" = OLD."organizationId"
           AND row."bookingId" = OLD."bookingId"
           AND row."amendmentId" = OLD."id";

        IF NEW."status" IN ('CANCELLED', 'EXPIRED')
           AND adjustment_count > 0
           AND compensation_count = 0
        THEN
            RAISE EXCEPTION 'rental commercial amendment with uncompensated adjustment money cannot terminate'
                USING ERRCODE = '23514';
        END IF;

        IF NEW."status" = 'APPLIED' THEN
            IF adjustment_count <> 1 OR compensation_count <> 0 THEN
                RAISE EXCEPTION 'rental commercial amendment apply requires exactly one uncompensated successful adjustment'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW."appliedRescheduleId" IS NULL OR NEW."appliedAt" IS NULL THEN
                RAISE EXCEPTION 'rental commercial amendment apply requires linked reschedule evidence'
                    USING ERRCODE = '23514';
            END IF;

            SELECT row.* INTO applied_reschedule
              FROM "rental_booking_reschedules" row
             WHERE row."id" = NEW."appliedRescheduleId"
               AND row."organizationId" = NEW."organizationId"
               AND row."bookingId" = NEW."bookingId";
            IF NOT FOUND
               OR applied_reschedule."sourceStartsOn" IS DISTINCT FROM NEW."sourceStartsOn"
               OR applied_reschedule."sourceEndsOn" IS DISTINCT FROM NEW."sourceEndsOn"
               OR applied_reschedule."targetStartsOn" IS DISTINCT FROM NEW."targetStartsOn"
               OR applied_reschedule."targetEndsOn" IS DISTINCT FROM NEW."targetEndsOn"
               OR applied_reschedule."currency" IS DISTINCT FROM NEW."currency"
               OR applied_reschedule."totalMinor" IS DISTINCT FROM NEW."afterTotalMinor"
               OR applied_reschedule."sourcePricingFingerprint" IS DISTINCT FROM NEW."sourcePricingFingerprint"
               OR applied_reschedule."targetPricingFingerprint" IS DISTINCT FROM NEW."targetPricingFingerprint"
               OR applied_reschedule."authorityFingerprint" IS DISTINCT FROM NEW."reviewFingerprint"
               OR applied_reschedule."appliedAt" IS DISTINCT FROM NEW."appliedAt"
            THEN
                RAISE EXCEPTION 'rental commercial amendment apply reschedule evidence does not match retained authority'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sf_guard_rental_commercial_amendment_chain()
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
         AND amendment."status" = 'APPLIED'
    ) THEN
      RAISE EXCEPTION 'additional rental commercial amendments are not supported after an applied commercial change'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_commercial_amendments_chain_guard
BEFORE INSERT ON "rental_booking_commercial_amendments"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_commercial_amendment_chain();

CREATE OR REPLACE FUNCTION sf_guard_rental_reschedule_after_commercial_amendment()
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
         AND amendment."status" = 'APPLIED'
    ) THEN
      RAISE EXCEPTION 'rental rescheduling after an applied commercial amendment requires chained commercial settlement support'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_booking_reschedules_post_commercial_apply_guard
BEFORE INSERT ON "rental_booking_reschedules"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_reschedule_after_commercial_amendment();

CREATE OR REPLACE FUNCTION sf_guard_rental_booking_cancellation_after_commercial_amendment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD."status" <> 'CANCELLED' AND NEW."status" = 'CANCELLED' AND EXISTS (
      SELECT 1
        FROM "rental_booking_commercial_amendments" amendment
       WHERE amendment."organizationId" = NEW."organizationId"
         AND amendment."bookingId" = NEW."id"
         AND amendment."status" = 'APPLIED'
    ) THEN
      RAISE EXCEPTION 'rental cancellation after an applied commercial amendment requires adjustment-aware refund settlement'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_bookings_post_commercial_apply_cancellation_guard
BEFORE UPDATE OF "status" ON "rental_bookings"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_booking_cancellation_after_commercial_amendment();

CREATE OR REPLACE FUNCTION sf_guard_rental_payment_after_commercial_amendment()
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
         AND amendment."status" = 'APPLIED'
    ) THEN
      RAISE EXCEPTION 'booking-price settlement after an applied rental commercial amendment requires effective-total settlement support'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_payment_transactions_post_commercial_apply_guard
BEFORE INSERT ON "rental_payment_transactions"
FOR EACH ROW
EXECUTE FUNCTION sf_guard_rental_payment_after_commercial_amendment();
