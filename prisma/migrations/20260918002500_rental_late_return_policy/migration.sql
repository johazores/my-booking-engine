CREATE TABLE "rental_late_return_policy_revisions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "unitTypeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "dailyFeeMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rental_late_return_policy_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rental_late_return_policy_revisions_version_check" CHECK ("version" >= 1),
    CONSTRAINT "rental_late_return_policy_revisions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "rental_late_return_policy_revisions_grace_check" CHECK ("graceDays" BETWEEN 0 AND 30),
    CONSTRAINT "rental_late_return_policy_revisions_reason_check" CHECK (btrim("reason") <> ''),
    CONSTRAINT "rental_late_return_policy_revisions_enabled_check" CHECK (
        ("enabled" = TRUE AND "dailyFeeMinor" IS NOT NULL AND "dailyFeeMinor" > 0 AND "dailyFeeMinor" <= 9000000000000000)
        OR ("enabled" = FALSE AND "graceDays" = 0 AND "dailyFeeMinor" IS NULL)
    )
);

CREATE UNIQUE INDEX "rental_late_return_policy_revisions_id_org_key"
ON "rental_late_return_policy_revisions"("id", "organizationId");
CREATE UNIQUE INDEX "rental_late_return_policy_revisions_org_type_version_key"
ON "rental_late_return_policy_revisions"("organizationId", "unitTypeId", "version");
CREATE INDEX "rental_late_return_policy_revisions_org_type_effective_idx"
ON "rental_late_return_policy_revisions"("organizationId", "unitTypeId", "effectiveAt");

ALTER TABLE "rental_late_return_assessments"
ADD COLUMN "policyRevisionId" UUID,
ADD COLUMN "policyDailyFeeMinor" BIGINT;

ALTER TABLE "rental_late_return_assessments"
ADD CONSTRAINT "rental_late_return_assessments_policy_evidence_check" CHECK (
    ("policyRevisionId" IS NULL AND "policyDailyFeeMinor" IS NULL)
    OR ("policyRevisionId" IS NOT NULL AND "policyDailyFeeMinor" IS NOT NULL AND "policyDailyFeeMinor" > 0)
);

CREATE INDEX "rental_late_return_assessments_org_policy_revision_idx"
ON "rental_late_return_assessments"("organizationId", "policyRevisionId");

CREATE OR REPLACE FUNCTION sf_author_rental_late_return_policy_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    unit_type_currency CHAR(3);
    unit_type_status "InventoryLifecycleStatus";
    next_version INTEGER;
    authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental late-return policy revisions are append-only' USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'sf:rental-late-return-policy:' || NEW."organizationId"::text || ':unit-type:' || NEW."unitTypeId"::text,
        0
    ));

    SELECT unit_type."currency", unit_type."status"
      INTO unit_type_currency, unit_type_status
      FROM "rental_unit_types" unit_type
     WHERE unit_type."organizationId" = NEW."organizationId"
       AND unit_type."id" = NEW."unitTypeId";

    IF unit_type_currency IS NULL OR unit_type_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'late-return policy requires an active tenant rental unit type' USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(MAX(policy."version"), 0) + 1
      INTO next_version
      FROM "rental_late_return_policy_revisions" policy
     WHERE policy."organizationId" = NEW."organizationId"
       AND policy."unitTypeId" = NEW."unitTypeId";

    IF NEW."version" <> next_version THEN
        RAISE EXCEPTION 'late-return policy revision version is stale' USING ERRCODE = '23514';
    END IF;
    IF NEW."currency" <> unit_type_currency THEN
        RAISE EXCEPTION 'late-return policy currency does not match unit-type currency' USING ERRCODE = '23514';
    END IF;
    IF NEW."graceDays" < 0 OR NEW."graceDays" > 30 THEN
        RAISE EXCEPTION 'late-return policy grace is outside the supported range' USING ERRCODE = '23514';
    END IF;
    IF NEW."enabled" AND (NEW."dailyFeeMinor" IS NULL OR NEW."dailyFeeMinor" <= 0 OR NEW."dailyFeeMinor" > 9000000000000000) THEN
        RAISE EXCEPTION 'enabled late-return policy requires a supported positive daily fee' USING ERRCODE = '23514';
    ELSIF NOT NEW."enabled" AND (NEW."graceDays" <> 0 OR NEW."dailyFeeMinor" IS NOT NULL) THEN
        RAISE EXCEPTION 'disabled late-return policy cannot retain fee authority' USING ERRCODE = '23514';
    END IF;

    authored_at := clock_timestamp();
    NEW."effectiveAt" := authored_at;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;

CREATE TRIGGER rental_late_return_policy_revisions_authority_guard
BEFORE INSERT OR UPDATE OR DELETE ON "rental_late_return_policy_revisions"
FOR EACH ROW EXECUTE FUNCTION sf_author_rental_late_return_policy_revision();

CREATE OR REPLACE FUNCTION sf_author_rental_late_return_assessment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    booking_currency CHAR(3);
    booking_timezone VARCHAR(80);
    booking_unit_type_id UUID;
    return_kind "RentalBookingFulfillmentEventKind";
    return_booking_id UUID;
    return_unit_id UUID;
    return_starts_on DATE;
    return_ends_on DATE;
    return_occurred_at TIMESTAMPTZ;
    pickup_starts_on DATE;
    pickup_ends_on DATE;
    pickup_occurred_at TIMESTAMPTZ;
    actual_late_days INTEGER;
    latest_policy_id UUID;
    latest_policy_enabled BOOLEAN;
    latest_policy_grace_days INTEGER;
    latest_policy_daily_fee_minor BIGINT;
    latest_policy_currency CHAR(3);
    authored_at TIMESTAMPTZ;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'rental late-return assessments are append-only' USING ERRCODE = '23514';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'sf:rental-booking:' || NEW."organizationId"::text || ':booking:' || NEW."bookingId"::text, 0
    ));

    SELECT booking."currency", location."timeZone", booking."unitTypeId"
      INTO booking_currency, booking_timezone, booking_unit_type_id
      FROM "rental_bookings" booking
      JOIN "rental_locations" location
        ON location."organizationId" = booking."organizationId"
       AND location."id" = booking."locationId"
     WHERE booking."organizationId" = NEW."organizationId"
       AND booking."id" = NEW."bookingId"
       AND booking."status" = 'CONFIRMED';
    IF booking_currency IS NULL OR booking_timezone IS NULL OR booking_unit_type_id IS NULL THEN
        RAISE EXCEPTION 'late-return assessment requires a confirmed tenant booking' USING ERRCODE = '23514';
    END IF;

    SELECT event."kind", event."bookingId", event."unitId", event."startsOn", event."endsOn", event."occurredAt"
      INTO return_kind, return_booking_id, return_unit_id, return_starts_on, return_ends_on, return_occurred_at
      FROM "rental_booking_fulfillment_events" event
     WHERE event."organizationId" = NEW."organizationId"
       AND event."id" = NEW."returnEventId";
    IF return_kind IS NULL OR return_kind <> 'RETURNED' OR return_booking_id <> NEW."bookingId" OR return_unit_id <> NEW."unitId" THEN
        RAISE EXCEPTION 'late-return assessment requires exact retained return evidence' USING ERRCODE = '23514';
    END IF;

    SELECT event."startsOn", event."endsOn", event."occurredAt"
      INTO pickup_starts_on, pickup_ends_on, pickup_occurred_at
      FROM "rental_booking_fulfillment_events" event
     WHERE event."organizationId" = NEW."organizationId"
       AND event."bookingId" = NEW."bookingId"
       AND event."kind" = 'PICKED_UP'
       AND event."unitId" = NEW."unitId";
    IF pickup_occurred_at IS NULL
       OR pickup_starts_on <> return_starts_on
       OR pickup_ends_on > return_ends_on
       OR return_occurred_at < pickup_occurred_at THEN
        RAISE EXCEPTION 'late-return assessment requires consistent pickup and return custody evidence' USING ERRCODE = '23514';
    END IF;

    actual_late_days := ((return_occurred_at AT TIME ZONE booking_timezone)::date - return_ends_on) + 1;
    IF actual_late_days < 1 THEN
        RAISE EXCEPTION 'late-return assessment requires a return after the committed rental period' USING ERRCODE = '23514';
    END IF;
    IF NEW."committedEndsOn" <> return_ends_on
       OR NEW."returnedAt" <> return_occurred_at
       OR NEW."lateDays" <> actual_late_days
       OR NEW."chargeableDays" <> GREATEST(0, actual_late_days - NEW."graceDays")
       OR NEW."currency" <> booking_currency
       OR NEW."idempotencyKey" <> ('rental-late-return-assessment:' || NEW."bookingId"::text) THEN
        RAISE EXCEPTION 'late-return assessment does not match retained booking and custody authority' USING ERRCODE = '23514';
    END IF;

    SELECT policy."id", policy."enabled", policy."graceDays", policy."dailyFeeMinor", policy."currency"
      INTO latest_policy_id, latest_policy_enabled, latest_policy_grace_days, latest_policy_daily_fee_minor, latest_policy_currency
      FROM "rental_late_return_policy_revisions" policy
     WHERE policy."organizationId" = NEW."organizationId"
       AND policy."unitTypeId" = booking_unit_type_id
       AND policy."effectiveAt" <= return_occurred_at
     ORDER BY policy."effectiveAt" DESC, policy."version" DESC, policy."id" DESC
     LIMIT 1;

    IF latest_policy_id IS NOT NULL AND latest_policy_enabled = TRUE THEN
        IF latest_policy_daily_fee_minor IS NULL
           OR latest_policy_daily_fee_minor <= 0
           OR latest_policy_currency <> booking_currency
           OR NEW."policyRevisionId" IS DISTINCT FROM latest_policy_id
           OR NEW."policyDailyFeeMinor" IS DISTINCT FROM latest_policy_daily_fee_minor
           OR NEW."graceDays" <> latest_policy_grace_days THEN
            RAISE EXCEPTION 'late-return assessment does not match policy authority effective at return' USING ERRCODE = '23514';
        END IF;

        IF NEW."outcome" = 'FEE_ASSESSED' THEN
            IF NEW."chargeableDays" <= 0
               OR NEW."feeMinor" IS NULL
               OR (NEW."chargeableDays"::NUMERIC * latest_policy_daily_fee_minor::NUMERIC) > 9000000000000000
               OR NEW."feeMinor"::NUMERIC <> (NEW."chargeableDays"::NUMERIC * latest_policy_daily_fee_minor::NUMERIC) THEN
                RAISE EXCEPTION 'late-return fee does not match automatic policy amount or supported money range' USING ERRCODE = '23514';
            END IF;
        ELSIF NEW."outcome" = 'WAIVED' THEN
            IF NEW."feeMinor" IS NOT NULL THEN
                RAISE EXCEPTION 'waived policy late-return assessment cannot retain a fee amount' USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSE
        IF NEW."policyRevisionId" IS NOT NULL OR NEW."policyDailyFeeMinor" IS NOT NULL THEN
            RAISE EXCEPTION 'manual late-return assessment cannot claim inactive policy authority' USING ERRCODE = '23514';
        END IF;
        IF NEW."outcome" = 'FEE_ASSESSED' AND (NEW."chargeableDays" <= 0 OR NEW."feeMinor" IS NULL OR NEW."feeMinor" <= 0 OR NEW."feeMinor" > 9000000000000000) THEN
            RAISE EXCEPTION 'manual late-return fee requires chargeable days and a positive amount' USING ERRCODE = '23514';
        ELSIF NEW."outcome" = 'WAIVED' AND NEW."feeMinor" IS NOT NULL THEN
            RAISE EXCEPTION 'waived late-return assessment cannot retain a fee amount' USING ERRCODE = '23514';
        END IF;
    END IF;

    authored_at := clock_timestamp();
    NEW."assessedAt" := authored_at;
    NEW."createdAt" := authored_at;
    RETURN NEW;
END;
$$;
